package meme

// power_flow.go folds a pypsapass.PowerFlow (the isolated PyPSA leg's electrical
// network + fixed injections, built from the parsed Calliope results) into the
// T1K-translated MEME job as the CANONICAL mode power_flow payload (ADR-0008):
// experiment.mode="power_flow" + experiment.power_flow, node.electrical.v_nom,
// transmission.electrical on every arc, and technology.dispatch /
// demand_profile for every injection the pass carries. It replaces the
// rejected top-level "power_flow" side-channel block (the old fork design) with
// the fields MEME main validates, and strips the decision variables the
// power_flow mode gate rejects (expandable capacities, trade, constraints,
// emission limits, scenarios).
//
// The pass is the single source of truth for the electrical network: buses,
// lines, transformers, and the per-timestep MW injections. The canonical job
// contributes the rest (metadata, time, carriers, non-electrical demand), so
// the result validates as a whole without running MEME.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	pypsapass "spatialhub_backend/internal/meme/pypsapass"
)

// ApplyPowerFlow overlays pf onto the canonical MEME job and returns the new
// job bytes. The input job is the T1K-translated payload (TranslatePayload);
// the output keeps every non-electrical part of it intact.
func ApplyPowerFlow(job []byte, pf *pypsapass.PowerFlow) ([]byte, error) {
	if pf == nil {
		return nil, fmt.Errorf("meme: apply power flow: nil pass")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(job, &top); err != nil {
		return nil, fmt.Errorf("meme: decode T1K job: %w", err)
	}
	modelRaw, ok := top["model"]
	if !ok {
		return nil, fmt.Errorf("meme: apply power flow: T1K job has no model")
	}
	expRaw, ok := top["experiment"]
	if !ok {
		return nil, fmt.Errorf("meme: apply power flow: T1K job has no experiment")
	}
	var model map[string]json.RawMessage
	if err := json.Unmarshal(modelRaw, &model); err != nil {
		return nil, fmt.Errorf("meme: decode job model: %w", err)
	}
	var experiment map[string]json.RawMessage
	if err := json.Unmarshal(expRaw, &experiment); err != nil {
		return nil, fmt.Errorf("meme: decode job experiment: %w", err)
	}

	// resolveSlack picks the pass's single slack from its control=Slack
	// generators (the strongest grid/trafo MV connection; a model can span
	// several, see resolveSlack); it becomes experiment.power_flow.slack, a
	// supply technology on the electricity network. distribute_slack=false so
	// ONLY that slack balances; every other injection — including the other
	// grid imports — needs its own fixed dispatch.
	slackName, slackNode, slackTech, err := resolveSlack(pf)
	if err != nil {
		return nil, fmt.Errorf("meme: apply power flow: %w", err)
	}

	// 1. Every pass bus is a canonical node with electrical.v_nom. The
	// transformer MV-side buses the pass invents (ntrafo_82_mv) do not exist in
	// the translated model yet — create them; the transformer arcs attach to
	// them below.
	nodes, err := objectMap(model, "nodes")
	if err != nil {
		return nil, err
	}
	for _, b := range pf.Buses {
		n := map[string]json.RawMessage{}
		if raw, ok := nodes[b.Name]; ok {
			if err := json.Unmarshal(raw, &n); err != nil {
				return nil, fmt.Errorf("meme: decode node %q: %w", b.Name, err)
			}
		}
		n["electrical"] = mustJSON(map[string]json.RawMessage{"v_nom": mustJSON(b.VNom)})
		nodes[b.Name] = mustJSON(n)
	}
	model["nodes"] = mustJSON(nodes)

	// 2. The electrical arcs: pass lines land on the translated arcs with the
	// same from/to (both derive from the topology in the same order); pass
	// transformers have no translated twin (T1K emits one arc per topology
	// edge, and the transformer connects the MV bus to the edge node) — create
	// them. A line carries its resolved Ohms; a transformer gets the legacy c2p
	// zero-impedance auto-fix (x=0.04, r=0.01 per unit of s_nom), since the
	// pass carries no impedance for transformers and r=x=0 degenerates the
	// Newton-Raphson solve.
	transmissions, err := objectMap(model, "transmission")
	if err != nil {
		return nil, err
	}
	byPair := map[string]string{} // unordered node pair -> arc id (electricity arcs only)
	for _, id := range sortedKeys(transmissions) {
		var arc map[string]json.RawMessage
		if err := json.Unmarshal(transmissions[id], &arc); err != nil {
			return nil, fmt.Errorf("meme: decode transmission %q: %w", id, err)
		}
		if unquote(arc["carrier"]) != "electricity" {
			continue
		}
		byPair[pairKey(unquote(arc["from"]), unquote(arc["to"]))] = id
	}
	for _, l := range pf.Lines {
		elec, err := lineElectrical(l)
		if err != nil {
			return nil, err
		}
		if id, ok := byPair[pairKey(l.Bus0, l.Bus1)]; ok {
			if transmissions[id], err = withElectrical(transmissions[id], elec); err != nil {
				return nil, err
			}
		} else if err := addElectricalArc(transmissions, l.Name, l.Bus0, l.Bus1, elec); err != nil {
			return nil, err
		}
	}
	for _, t := range pf.Transformers {
		elec, err := transformerElectrical(t)
		if err != nil {
			return nil, err
		}
		if id, ok := byPair[pairKey(t.Bus0, t.Bus1)]; ok {
			if transmissions[id], err = withElectrical(transmissions[id], elec); err != nil {
				return nil, err
			}
		} else if err := addElectricalArc(transmissions, t.Name, t.Bus0, t.Bus1, elec); err != nil {
			return nil, err
		}
	}
	model["transmission"] = mustJSON(transmissions)

	// 3. Technologies: fixed injections from the pass. A generator is a supply
	// at its bus with technology.dispatch (MW per timestep); a load is a
	// demand at its bus with demand_profile (loads must NOT carry dispatch —
	// MEME rejects that). The tech id is the pass component's <node>_<tech>
	// suffix, which is the canonical technology id the Calliope leg emitted the
	// flow CSV from; a tech the translated model does not carry (the grid
	// import, which T1K models as trade) is created. The slack keeps no
	// dispatch — it balances.
	techs, err := objectMap(model, "technologies")
	if err != nil {
		return nil, err
	}
	// The power flow solves the electrical network only. Drop every non-demand
	// technology whose output carrier is not electricity (heat pumps, gas
	// boilers, gas imports): MEME's power_flow gate requires a fixed dispatch on
	// every non-demand technology, which the electrical pass cannot supply for a
	// heat or gas tech. A heat pump's electricity draw is carried by the pass as
	// a load (its flow_in), so the loads loop below re-creates it as a demand
	// technology — the correct electrical picture.
	if err := dropNonElectricalSupply(techs); err != nil {
		return nil, err
	}
	// NO technology in a power_flow job carries a physics performance model:
	// every one of them is a fixed injection or a fixed demand. MEME's pypsa
	// validator rejects a performance model without a precomputed profile
	// BEFORE it looks at the dispatch, and it checks EVERY technology — so a
	// tech the pass carries no series for (a PV on a building whose flow never
	// reached the pass, e.g. pv_supply_2) would still 422 the whole leg. Strip
	// centrally, before the loops below add dispatch/demand_profile (a tech
	// ensureTech creates fresh has no performance anyway).
	if err := stripPerformanceFromAll(techs); err != nil {
		return nil, err
	}
	for _, g := range pf.Generators {
		if g.Name == slackName {
			continue
		}
		techID := componentTechID(g.Name, pf.Buses)
		if techID == "" {
			return nil, fmt.Errorf("meme: cannot resolve the technology of generator %q (its name is not <node>_<tech> for any pass bus)", g.Name)
		}
		tech, err := ensureTech(techs, techID, g.Bus, "supply", "carrier_out")
		if err != nil {
			return nil, err
		}
		if err := setSeriesAt(techID, "dispatch", g.Bus, g.PSet, tech); err != nil {
			return nil, err
		}
		techs[techID] = mustJSON(tech)
	}
	for _, l := range pf.Loads {
		techID := componentTechID(l.Name, pf.Buses)
		if techID == "" {
			return nil, fmt.Errorf("meme: cannot resolve the technology of load %q (its name is not <node>_<tech> for any pass bus)", l.Name)
		}
		tech, err := ensureTech(techs, techID, l.Bus, "demand", "carrier_in")
		if err != nil {
			return nil, err
		}
		if err := setSeriesAt(techID, "demand_profile", l.Bus, l.PSet, tech); err != nil {
			return nil, err
		}
		techs[techID] = mustJSON(tech)
	}
	// Two more classes of thing MEME's pypsa target rejects, both fatal to the
	// whole leg:
	//   - a fixed purchase cost (no slot in PyPSA; power_flow has no objective);
	//   - a non-demand technology with no dispatch (only the slack balances), so
	//     a tech the model carries but the Calliope flow series do not — a PV
	//     base tech whose arrays the results name separately, say — must go: it
	//     contributes nothing electrical to the network the pass solves.
	if err := stripPurchaseCosts(techs); err != nil {
		return nil, err
	}
	if err := dropUndispatchedSupply(techs, slackTech); err != nil {
		return nil, err
	}
	// The slack must be a supply technology on the electricity network placed
	// at the transformer's MV bus, so MEME emits exactly the pass's Slack
	// generator there. Its id is the pass generator's tech suffix, so an
	// existing technology of the same name (the grid import the Calliope leg
	// ran) is reused; T1K itself models the grid connection as trade, which the
	// mode gate rejects and step 5 deletes. Placement is forced to the single
	// slack node: the power-flow mapper owns the electrical placement, and a
	// plain technology id then resolves to exactly the Slack generator.
	slack, err := ensureTech(techs, slackTech, slackNode, "supply", "carrier_out")
	if err != nil {
		return nil, err
	}
	slack["node"] = mustJSON([]string{slackNode})
	slack["role"] = mustJSON("supply")
	slack["carrier_out"] = mustJSON("electricity")
	techs[slackTech] = mustJSON(slack)
	model["technologies"] = mustJSON(techs)

	// 4. The experiment: mode power_flow with its typed block.
	experiment["mode"] = mustJSON("power_flow")
	experiment["power_flow"] = mustJSON(map[string]json.RawMessage{
		"method":           mustJSON("newton_raphson"),
		"slack":            mustJSON(slackTech),
		"distribute_slack": mustJSON(false),
		"tolerance":        mustJSON(1e-6),
	})

	// 5. Strip the decision variables the power_flow mode gate rejects
	// (expandable capacity on a technology, node override or arc; trade;
	// constraints; emission limits; scenarios), plus the rejected top-level
	// side-channel block if a stale job carries one.
	if err := unsetExpandable(model); err != nil {
		return nil, err
	}
	delete(model, "trade")
	delete(model, "constraints")
	delete(model, "emission_limits")
	delete(experiment, "scenarios")
	delete(top, "power_flow")

	top["model"] = mustJSON(model)
	top["experiment"] = mustJSON(experiment)
	return json.Marshal(top)
}

// resolveSlack finds the pass's control=Slack generators and picks the single
// one MEME balances on, mapping its name back to the canonical supply
// technology id (the <node>_<tech> suffix against the pass's own buses).
//
// A model can span several grid connections (one per transformer, joined into
// a single MV network), and the pass labels each as Slack; MEME's power_flow
// mode takes exactly one reference bus, so the strongest connection (largest
// total scheduled |MW|, tie-broken by name) is chosen as the slack and every
// other grid import keeps its scheduled dispatch as a fixed PQ injection
// (ApplyPowerFlow gives every non-slack generator its dispatch series).
func resolveSlack(pf *pypsapass.PowerFlow) (name, node, techID string, err error) {
	var slack *pypsapass.Generator
	for i := range pf.Generators {
		if pf.Generators[i].Control != "Slack" {
			continue
		}
		if slack == nil || strongerConnection(&pf.Generators[i], slack) {
			slack = &pf.Generators[i]
		}
	}
	if slack == nil {
		return "", "", "", fmt.Errorf("the pass labels no generator control=Slack (the grid/trafo MV connection that balances the network)")
	}
	techID = componentTechID(slack.Name, pf.Buses)
	if techID == "" {
		return "", "", "", fmt.Errorf("cannot resolve the supply technology of the slack generator %q (its name is not <node>_<tech> for any pass bus)", slack.Name)
	}
	return slack.Name, slack.Bus, techID, nil
}

// strongerConnection reports whether a is the better slack of two grid
// connections: the one with the larger total scheduled |MW| absorbs the
// network imbalance with the least relative disturbance; an equal total falls
// back to name order so the choice is deterministic.
func strongerConnection(a, b *pypsapass.Generator) bool {
	if sa, sb := totalAbsMW(a.PSet), totalAbsMW(b.PSet); sa != sb {
		return sa > sb
	}
	return a.Name < b.Name
}

// totalAbsMW sums a series' absolute values; a nil or empty series is 0.
func totalAbsMW(series []float64) float64 {
	var sum float64
	for _, v := range series {
		if v < 0 {
			v = -v
		}
		sum += v
	}
	return sum
}

// componentTechID splits a pass component name "<location>_<tech>" at the
// location boundary. The location is a flow-CSV node name, which is always one
// of the pass buses; a node id may itself contain underscores (ntrafo_82), so
// the LONGEST bus-name prefix wins: "ntrafo_82_grid_trafo_82_import" ->
// "grid_trafo_82_import", "nb1_pv_supply_1" -> "pv_supply_1". This is the
// canonical technology id (or its Calliope-emitted import suffix) the flow CSV
// was generated from.
func componentTechID(name string, buses []pypsapass.Bus) string {
	best := ""
	for _, b := range buses {
		if len(b.Name) <= len(best) {
			continue
		}
		if len(name) > len(b.Name) && strings.HasPrefix(name, b.Name) && name[len(b.Name)] == '_' {
			best = b.Name
		}
	}
	if best == "" {
		return ""
	}
	return name[len(best)+1:]
}

// stripPerformanceFromAll removes the physics performance model from EVERY
// technology of a power_flow job (tech-level and per-node override). The job has
// no decision variables and drives each tech with an explicit series, so no
// physics is ever needed — and MEME rejects a performance model without a
// precomputed profile on ANY tech, even one the pass carries no series for.
func stripPerformanceFromAll(techs map[string]json.RawMessage) error {
	for id, raw := range techs {
		var t map[string]json.RawMessage
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("meme: decode technology %q: %w", id, err)
		}
		if err := stripPerformance(t); err != nil {
			return fmt.Errorf("meme: strip performance of technology %q: %w", id, err)
		}
		techs[id] = mustJSON(t)
	}
	return nil
}

// transformTechFields applies fn to a technology's own field map and to the
// field map of every one of its node overrides.
func transformTechFields(t map[string]json.RawMessage, fn func(fields map[string]json.RawMessage) error) error {
	if err := fn(t); err != nil {
		return err
	}
	raw, ok := t["node_overrides"]
	if !ok {
		return nil
	}
	var overrides map[string]json.RawMessage
	if err := json.Unmarshal(raw, &overrides); err != nil {
		return fmt.Errorf("decode node_overrides: %w", err)
	}
	if len(overrides) == 0 {
		return nil
	}
	for node, ovRaw := range overrides {
		var ov map[string]json.RawMessage
		if err := json.Unmarshal(ovRaw, &ov); err != nil {
			return fmt.Errorf("decode node override %q: %w", node, err)
		}
		if err := fn(ov); err != nil {
			return err
		}
		overrides[node] = mustJSON(ov)
	}
	t["node_overrides"] = mustJSON(overrides)
	return nil
}

// stripPurchaseCosts removes costs.<class>.purchase from every technology and
// node override. MEME's pypsa target has no slot for a fixed purchase cost
// (Calliope's cost_purchase) and rejects the whole job for it; a power-flow job
// solves a fixed network with no objective, so the field is simply dropped.
func stripPurchaseCosts(techs map[string]json.RawMessage) error {
	for id, raw := range techs {
		var t map[string]json.RawMessage
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("meme: decode technology %q: %w", id, err)
		}
		if err := transformTechFields(t, dropPurchaseCost); err != nil {
			return fmt.Errorf("meme: strip purchase cost of technology %q: %w", id, err)
		}
		techs[id] = mustJSON(t)
	}
	return nil
}

// dropPurchaseCost deletes the purchase field of every cost class in fields,
// and the (now empty) class/costs wrappers with it.
func dropPurchaseCost(fields map[string]json.RawMessage) error {
	raw, ok := fields["costs"]
	if !ok {
		return nil
	}
	var costs map[string]json.RawMessage
	if err := json.Unmarshal(raw, &costs); err != nil {
		return fmt.Errorf("decode costs: %w", err)
	}
	changed := false
	for class, classRaw := range costs {
		var c map[string]json.RawMessage
		if err := json.Unmarshal(classRaw, &c); err != nil {
			return fmt.Errorf("decode costs.%s: %w", class, err)
		}
		if _, has := c["purchase"]; !has {
			continue
		}
		delete(c, "purchase")
		changed = true
		if len(c) == 0 {
			delete(costs, class)
		} else {
			costs[class] = mustJSON(c)
		}
	}
	if !changed {
		return nil
	}
	if len(costs) == 0 {
		delete(fields, "costs")
	} else {
		fields["costs"] = mustJSON(costs)
	}
	return nil
}

// dropUndispatchedSupply removes every non-demand technology the pass carries no
// fixed dispatch for (and that is not the slack). MEME's power_flow mode
// requires a dispatch on every non-slack, non-demand technology, so a tech the
// model carries but the Calliope flow series do not 422s the whole leg while
// contributing nothing electrical to the network being solved. Demand
// technologies ride demand_profile and stay; the slack balances and stays.
func dropUndispatchedSupply(techs map[string]json.RawMessage, slackTech string) error {
	for id, raw := range techs {
		if id == slackTech {
			continue
		}
		var t map[string]json.RawMessage
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("meme: decode technology %q: %w", id, err)
		}
		if unquote(t["role"]) == "demand" || hasDispatch(t) {
			continue
		}
		delete(techs, id)
	}
	return nil
}

// hasDispatch reports whether a technology carries a fixed dispatch series —
// on the technology itself or in any node override (where setSeriesAt puts it
// when the tech does not live at exactly that node).
func hasDispatch(t map[string]json.RawMessage) bool {
	if _, ok := t["dispatch"]; ok {
		return true
	}
	raw, ok := t["node_overrides"]
	if !ok {
		return false
	}
	var overrides map[string]json.RawMessage
	if err := json.Unmarshal(raw, &overrides); err != nil {
		return false
	}
	for _, ovRaw := range overrides {
		var ov map[string]json.RawMessage
		if err := json.Unmarshal(ovRaw, &ov); err != nil {
			continue
		}
		if _, ok := ov["dispatch"]; ok {
			return true
		}
	}
	return false
}

// stripPerformance removes the physics performance model from a technology and
// from every node override. A technology the power flow drives with a fixed
// dispatch (a generator's p_set series or the slack) is a plain fixed injection
// and carries no physics: MEME's pypsa validator rejects any performance model
// without a precomputed profile BEFORE it looks at the dispatch
// (meme internal/target/validate.go), so leaving performance.physics="pv" on a
// PV tech fails the whole leg.
func stripPerformance(tech map[string]json.RawMessage) error {
	delete(tech, "performance")
	raw, ok := tech["node_overrides"]
	if !ok {
		return nil
	}
	var overrides map[string]json.RawMessage
	if err := json.Unmarshal(raw, &overrides); err != nil {
		return fmt.Errorf("decode node_overrides: %w", err)
	}
	for node, ovRaw := range overrides {
		var ov map[string]json.RawMessage
		if err := json.Unmarshal(ovRaw, &ov); err != nil {
			return fmt.Errorf("decode node override %q: %w", node, err)
		}
		if _, has := ov["performance"]; !has {
			continue
		}
		delete(ov, "performance")
		overrides[node] = mustJSON(ov)
	}
	tech["node_overrides"] = mustJSON(overrides)
	return nil
}

// dropNonElectricalSupply removes every supply/storage/conversion technology
// whose output carrier is not electricity. The power flow solves the electrical
// network only, and MEME's power_flow gate requires a fixed dispatch on every
// non-demand technology — which the electrical pass cannot supply for a heat or
// gas tech. Demand technologies are kept (MEME skips them; they ride their own
// carrier's bus). A heat pump's electricity draw is carried by the pass as a
// load, so removing its heat-supply tech is correct: the loads loop re-creates
// it as a demand technology.
func dropNonElectricalSupply(techs map[string]json.RawMessage) error {
	for id, raw := range techs {
		var t map[string]json.RawMessage
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("meme: decode technology %q: %w", id, err)
		}
		if unquote(t["role"]) == "demand" {
			continue
		}
		if contains(decodeStringList(t["carrier_out"]), "electricity") {
			continue
		}
		delete(techs, id)
	}
	return nil
}

// ensureTech returns the technology with id, creating a fresh one at node when
// the model does not carry it: role supply with carrier_out
// ("supply","carrier_out") or role demand with carrier_in ("demand","carrier_in").
// An existing technology is preserved; only its placement is corrected when the
// pass's series lands on a node the tech does not sit at yet.
func ensureTech(techs map[string]json.RawMessage, id, node, role, carrierField string) (map[string]json.RawMessage, error) {
	tech := map[string]json.RawMessage{}
	if raw, ok := techs[id]; ok {
		if err := json.Unmarshal(raw, &tech); err != nil {
			return nil, fmt.Errorf("meme: decode technology %q: %w", id, err)
		}
	} else {
		tech["role"] = mustJSON(role)
		tech["node"] = mustJSON([]string{node})
		tech[carrierField] = mustJSON("electricity")
	}
	if len(decodeStringList(tech["node"])) == 0 {
		tech["node"] = mustJSON([]string{node})
	}
	return tech, nil
}

// setSeriesAt writes an inline per-timestep MW series into tech's field slot at
// node: on the technology itself when the tech lives at exactly this node,
// else through node_overrides["<node>"].field (MEME's t.At(node) merges it).
// The value is a bare array — the Value shape MEME's InternInlineSeries
// interns; {source,values,unit} would decode as an indexed parameter and be
// silently dropped.
func setSeriesAt(id, field, node string, values []float64, tech map[string]json.RawMessage) error {
	if len(values) == 0 {
		return fmt.Errorf("meme: %s series for tech %q at node %q is empty", field, id, node)
	}
	vals := mustJSON(values)
	nodes := decodeStringList(tech["node"])
	if len(nodes) == 1 && nodes[0] == node {
		tech[field] = vals
		return nil
	}
	if !contains(nodes, node) {
		tech["node"] = mustJSON(append(nodes, node))
	}
	var overrides map[string]json.RawMessage
	if raw, ok := tech["node_overrides"]; ok {
		if err := json.Unmarshal(raw, &overrides); err != nil {
			return fmt.Errorf("meme: decode node_overrides of tech %q: %w", id, err)
		}
	} else {
		overrides = map[string]json.RawMessage{}
	}
	ov := map[string]json.RawMessage{}
	if raw, ok := overrides[node]; ok {
		if err := json.Unmarshal(raw, &ov); err != nil {
			return fmt.Errorf("meme: decode node override of tech %q at %q: %w", id, node, err)
		}
	}
	ov[field] = vals
	overrides[node] = mustJSON(ov)
	tech["node_overrides"] = mustJSON(overrides)
	return nil
}

// lineElectrical builds the transmission.electrical block of a pass line: the
// literal Ohms the pass resolved from the cable catalogue, the MVA rating and
// the parallel circuit count, kind "line".
func lineElectrical(l pypsapass.Line) (json.RawMessage, error) {
	if l.SNomMVA <= 0 {
		return nil, fmt.Errorf("meme: pass line %q has no positive rating (s_nom %g MVA); MEME needs electrical.s_nom or capacity.existing for the loading output", l.Name, l.SNomMVA)
	}
	return mustJSON(map[string]json.RawMessage{
		"kind":         mustJSON("line"),
		"r":            mustJSON(l.ROhm),
		"x":            mustJSON(l.XOhm),
		"s_nom":        mustJSON(l.SNomMVA),
		"num_parallel": mustJSON(int(l.NumParallel)),
	}), nil
}

// transformerElectrical builds the transmission.electrical block of a pass
// transformer. The pass carries only the rating and circuit count (no
// impedance), so the legacy c2p zero-impedance auto-fix applies: x=0.04,
// r=0.01 per unit of s_nom (a transformer with r=x=0 degenerates the
// Newton-Raphson solve).
func transformerElectrical(t pypsapass.Transformer) (json.RawMessage, error) {
	if t.SNomMVA <= 0 {
		return nil, fmt.Errorf("meme: pass transformer %q has no positive rating (s_nom %g MVA); MEME needs electrical.s_nom or capacity.existing for the loading output", t.Name, t.SNomMVA)
	}
	return mustJSON(map[string]json.RawMessage{
		"kind":         mustJSON("transformer"),
		"r":            mustJSON(0.01),
		"x":            mustJSON(0.04),
		"s_nom":        mustJSON(t.SNomMVA),
		"num_parallel": mustJSON(int(t.NumParallel)),
	}), nil
}

// addElectricalArc inserts a new electricity transmission arc (the canonical
// twin of a pass line/transformer that the translated model does not carry).
func addElectricalArc(transmissions map[string]json.RawMessage, id, from, to string, elec json.RawMessage) error {
	if _, exists := transmissions[id]; exists {
		return fmt.Errorf("meme: power flow arc %q collides with an existing transmission id", id)
	}
	transmissions[id] = mustJSON(map[string]json.RawMessage{
		"carrier":       mustJSON("electricity"),
		"from":          mustJSON(from),
		"to":            mustJSON(to),
		"bidirectional": mustJSON(true),
		"electrical":    elec,
	})
	return nil
}

// withElectrical sets the electrical block on an existing transmission arc.
func withElectrical(raw, elec json.RawMessage) (json.RawMessage, error) {
	var arc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &arc); err != nil {
		return nil, fmt.Errorf("meme: decode transmission arc: %w", err)
	}
	arc["electrical"] = elec
	return mustJSON(arc), nil
}

// unsetExpandable removes every capacity.expandable=true from the model —
// technology, per-node override and transmission alike — because the
// power_flow mode gate rejects a single decision variable. Absent expandable
// means fixed, which is exactly the power-flow contract.
func unsetExpandable(model map[string]json.RawMessage) error {
	skill := func(what string, raw json.RawMessage) (json.RawMessage, error) {
		if len(raw) == 0 {
			return raw, nil
		}
		var o map[string]json.RawMessage
		if err := json.Unmarshal(raw, &o); err != nil {
			return nil, fmt.Errorf("meme: decode %s: %w", what, err)
		}
		if c, ok := o["capacity"]; ok {
			var cap map[string]json.RawMessage
			if err := json.Unmarshal(c, &cap); err != nil {
				return nil, fmt.Errorf("meme: decode %s capacity: %w", what, err)
			}
			if _, has := cap["expandable"]; has {
				delete(cap, "expandable")
				if len(cap) == 0 {
					delete(o, "capacity")
				} else {
					o["capacity"] = mustJSON(cap)
				}
			}
		}
		return mustJSON(o), nil
	}
	techs, err := objectMap(model, "technologies")
	if err != nil {
		return err
	}
	for id, raw := range techs {
		cleaned, err := skill("technology "+id, raw)
		if err != nil {
			return err
		}
		var t map[string]json.RawMessage
		if err := json.Unmarshal(cleaned, &t); err != nil {
			return err
		}
		if ovRaw, ok := t["node_overrides"]; ok {
			var ovs map[string]json.RawMessage
			if err := json.Unmarshal(ovRaw, &ovs); err != nil {
				return fmt.Errorf("meme: decode node_overrides of tech %q: %w", id, err)
			}
			for nid, ovRaw := range ovs {
				ovCleaned, err := skill(fmt.Sprintf("technology %s override %s", id, nid), ovRaw)
				if err != nil {
					return err
				}
				ovs[nid] = ovCleaned
			}
			t["node_overrides"] = mustJSON(ovs)
		}
		techs[id] = mustJSON(t)
	}
	model["technologies"] = mustJSON(techs)

	transmissions, err := objectMap(model, "transmission")
	if err != nil {
		return err
	}
	for id, raw := range transmissions {
		arc, err := skill("transmission "+id, raw)
		if err != nil {
			return err
		}
		transmissions[id] = arc
	}
	model["transmission"] = mustJSON(transmissions)
	return nil
}

// --- small raw-JSON helpers (numbers are never re-encoded from the job; the
// values this package writes come from the pass or are literals) --------------

// mustJSON marshals v, which the caller guarantees is encodable (primitives,
// float slices, RawMessage maps); marshaling cannot fail for those.
func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic("meme: marshal " + fmt.Sprint(v) + ": " + err.Error())
	}
	return b
}

// objectMap decodes model["key"] as a map, tolerating its absence (an empty
// map is created so callers can add entries).
func objectMap(model map[string]json.RawMessage, key string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	raw, ok := model[key]
	if !ok {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("meme: decode model.%s: %w", key, err)
	}
	return out, nil
}

// decodeStringList reads a StringList-shaped raw value (a JSON string or an
// array of strings).
func decodeStringList(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return []string{one}
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		return many
	}
	return nil
}

// unquote is a string(raw) with the surrounding quotes stripped; returns "" on
// anything that is not a JSON string.
func unquote(raw json.RawMessage) string {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return ""
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func sortedKeys(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// pairKey canonicalizes an unordered node pair for arc matching.
func pairKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + "\x00" + b
}
