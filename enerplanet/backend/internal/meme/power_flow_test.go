package meme

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	pypsapass "spatialhub_backend/internal/meme/pypsapass"
)

// powerFlowFixture builds the pass a real dispatch would: the elOnlyPayload
// topology (transformer pair + one building) with a grid import at the first
// transformer (the slack, on its MV bus), building PV, and a demand.
func powerFlowFixture(t *testing.T) (*pypsapass.PowerFlow, []byte) {
	t.Helper()
	var in map[string]interface{}
	require.NoError(t, json.Unmarshal(elOnlyPayload(), &in))

	topology := []map[string]interface{}{}
	for _, e := range in["topology"].([]interface{}) {
		topology = append(topology, e.(map[string]interface{}))
	}
	pf, err := pypsapass.Build(pypsapass.LoadOptions{
		Pypsa:    map[string]interface{}{},
		Topology: topology,
		CarrierProd: []pypsapass.CarrierSeries{
			{FromLocation: "ntrafo_1", Tech: "grid_trafo_1_import", Timeseries: []float64{100, 200}},
			{FromLocation: "nb1", Tech: "pv_supply_1", Timeseries: []float64{1000, 2000}},
		},
		CarrierCon: []pypsapass.CarrierSeries{
			{FromLocation: "nb1", Tech: "demand_1", Timeseries: []float64{500, 300}},
		},
		NumTimesteps: 2,
	})
	require.NoError(t, err)

	job, err := TranslatePayload(elOnlyPayload())
	require.NoError(t, err)
	return pf, job.Job
}

// TestApplyPowerFlow_buildsCanonicalPowerFlowPayload is the acceptance proof
// for the send-side migration: the transformed job carries
// experiment.mode=power_flow with the pass's slack named in
// experiment.power_flow, the electrical network in the canonical model
// (node.electrical.v_nom, transmission.electrical on every arc), the fixed
// dispatch as technology.dispatch / demand_profile, and none of the rejected
// decisions (no top-level power_flow block, no trade, no expandable
// capacity) — the shape MEME's own validatePowerFlow requires.
func TestApplyPowerFlow_buildsCanonicalPowerFlowPayload(t *testing.T) {
	pf, job := powerFlowFixture(t)

	got, err := ApplyPowerFlow(job, pf)
	require.NoError(t, err)

	var top map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &top))
	assert.NotContains(t, top, "power_flow", "the rejected top-level block must not be emitted")

	exp, _ := top["experiment"].(map[string]interface{})
	require.NotNil(t, exp)
	assert.Equal(t, "power_flow", exp["mode"])

	pfOpts, _ := exp["power_flow"].(map[string]interface{})
	require.NotNil(t, pfOpts, "experiment.power_flow present")
	assert.Equal(t, "newton_raphson", pfOpts["method"])
	assert.Equal(t, "grid_trafo_1_import", pfOpts["slack"], "the pass Slack generator resolves to its technology")
	assert.Equal(t, false, pfOpts["distribute_slack"], "only the named slack balances")
	assert.InDelta(t, 1e-6, pfOpts["tolerance"], 1e-12)
	assert.NotContains(t, exp, "scenarios", "scenarios are a decision and rejected in power_flow mode")

	m, _ := top["model"].(map[string]interface{})
	require.NotNil(t, m)
	assert.NotContains(t, m, "trade", "trade is a decision and rejected in power_flow mode")
	assert.NotContains(t, m, "constraints")
	assert.NotContains(t, m, "emission_limits")

	// Every bus of the pass is a node with electrical.v_nom; the transformer
	// MV-side buses the pass invents exist as nodes now.
	nodes, _ := m["nodes"].(map[string]interface{})
	require.NotNil(t, nodes)
	expectedVNom := map[string]float64{"nb1": 0.4, "ntrafo_1": 20, "ntrafo_1_mv": 20, "ntrafo_2": 20, "ntrafo_2_mv": 20}
	require.Len(t, nodes, len(expectedVNom))
	for node, kv := range expectedVNom {
		n, _ := nodes[node].(map[string]interface{})
		require.NotNil(t, n, "node %s exists", node)
		elec, _ := n["electrical"].(map[string]interface{})
		require.NotNil(t, elec, "node %s carries electrical", node)
		assert.InDelta(t, kv, elec["v_nom"], 1e-9, "node %s v_nom", node)
	}

	// Every electrical arc (the translated lines get their impedance/rating,
	// the pass transformers are added) carries transmission.electrical.
	transmissions, _ := m["transmission"].(map[string]interface{})
	require.Len(t, transmissions, 4, "lv_1, mv_0 + the two transformers")
	for id, raw := range transmissions {
		arc, _ := raw.(map[string]interface{})
		elec, _ := arc["electrical"].(map[string]interface{})
		require.NotNil(t, elec, "transmission %s carries electrical", id)
		require.NotEmpty(t, elec["kind"], "transmission %s has a kind", id)
		require.NotEmpty(t, elec["s_nom"], "transmission %s has a rating", id)
		require.NotEmpty(t, elec["num_parallel"], "transmission %s has a circuit count", id)
	}
	lv := transmissions["lv_1"].(map[string]interface{})["electrical"].(map[string]interface{})
	assert.Equal(t, "line", lv["kind"])
	assert.InDelta(t, 208*0.0182/1000.0, lv["r"], 1e-9, "lv_1 r = NAYY_4_150 r_mohm/km * km / 1000 -> Ohm")
	assert.InDelta(t, 80*0.0182/1000.0, lv["x"], 1e-9)
	tr := transmissions["trafo_1"].(map[string]interface{})["electrical"].(map[string]interface{})
	assert.Equal(t, "transformer", tr["kind"])
	assert.InDelta(t, 0.01, tr["r"], 1e-12, "transformer r/x are the legacy per-unit-s_nom auto-fix")
	assert.InDelta(t, 0.04, tr["x"], 1e-12)
	assert.Equal(t, "ntrafo_1_mv", transmissions["trafo_1"].(map[string]interface{})["from"])
	assert.Equal(t, "ntrafo_1", transmissions["trafo_1"].(map[string]interface{})["to"])

	// Fixed injections: the slack is a supply at the MV bus without dispatch;
	// the other generator carries dispatch, the load keeps demand_profile.
	techs, _ := m["technologies"].(map[string]interface{})
	slack, _ := techs["grid_trafo_1_import"].(map[string]interface{})
	require.NotNil(t, slack, "the slack technology exists")
	assert.Equal(t, "supply", slack["role"])
	assert.Equal(t, []interface{}{"ntrafo_1_mv"}, slack["node"])
	assert.Equal(t, "electricity", slack["carrier_out"], "StringList accepts the bare-string form (as T1K writes it)")
	assert.NotContains(t, slack, "dispatch", "the slack balances; it needs no fixed dispatch")

	pv, _ := techs["pv_supply_1"].(map[string]interface{})
	require.NotNil(t, pv, "the non-slack generator technology is created")
	assert.Equal(t, "supply", pv["role"])
	assert.Equal(t, []interface{}{1000.0, 2000.0}, pv["dispatch"], "generator p_set becomes technology.dispatch")

	demand, _ := techs["demand_1"].(map[string]interface{})
	require.NotNil(t, demand)
	assert.Equal(t, "demand", demand["role"])
	assert.Equal(t, []interface{}{500.0, 300.0}, demand["demand_profile"], "loads keep demand_profile")
	assert.NotContains(t, demand, "dispatch", "demand must not carry dispatch (MEME rejects it)")

	// No decision variables anywhere: capacity blocks are fixed or absent.
	walkCapacities(t, m, func(c map[string]interface{}) {
		assert.NotContains(t, c, "expandable", "power_flow mode has no decision variables")
	})

	// Every key the mapper fabricates stays Calliope-legal.
	for _, family := range []string{"nodes", "technologies", "transmission"} {
		fm, _ := m[family].(map[string]interface{})
		for key := range fm {
			require.Regexp(t, calliopeKey, key, "%s key %q must be Calliope-legal", family, key)
		}
	}
}

// walkCapacities visits every capacity block (technology, node override,
// transmission) so a single helper asserts the whole job is decision-free.
func walkCapacities(t *testing.T, m map[string]interface{}, check func(map[string]interface{})) {
	t.Helper()
	var visit func(raw map[string]interface{})
	visit = func(raw map[string]interface{}) {
		if c, ok := raw["capacity"].(map[string]interface{}); ok {
			check(c)
		}
		if ovs, ok := raw["node_overrides"].(map[string]interface{}); ok {
			for _, ovRaw := range ovs {
				visit(ovRaw.(map[string]interface{}))
			}
		}
	}
	for _, raw := range m["technologies"].(map[string]interface{}) {
		visit(raw.(map[string]interface{}))
	}
	for _, raw := range m["transmission"].(map[string]interface{}) {
		visit(raw.(map[string]interface{}))
	}
}

// TestApplyPowerFlow_keepsNonElectricalModelIntact guards the "keep everything
// else" requirement: metadata, time, carriers and the existing (non-electrical)
// demand technology survive the overlay untouched.
func TestApplyPowerFlow_keepsNonElectricalModelIntact(t *testing.T) {
	pf, job := powerFlowFixture(t)
	got, err := ApplyPowerFlow(job, pf)
	require.NoError(t, err)

	var top map[string]interface{}
	require.NoError(t, json.Unmarshal(got, &top))
	m := top["model"].(map[string]interface{})

	assert.Equal(t, "el_test_1", m["metadata"].(map[string]interface{})["name"])
	assert.Equal(t, "1H", m["time"].(map[string]interface{})["resolution"])
	assert.NotNil(t, m["carriers"].(map[string]interface{})["electricity"])

	// The translated demand technology stays (its load profile is the T1K
	// scalar; the pass's own demand series live on the created demand_1 tech).
	demandB, ok := m["technologies"].(map[string]interface{})["demand_b1"].(map[string]interface{})
	require.True(t, ok, "the translated demand tech is preserved")
	assert.Equal(t, "demand", demandB["role"])
	assert.NotNil(t, demandB["demand_profile"])
}

// TestApplyPowerFlow_rejectsPassWithoutSlack covers the contract anchor: MEME
// balances on the named slack, so a pass that labels none cannot be sent.
func TestApplyPowerFlow_rejectsPassWithoutSlack(t *testing.T) {
	job, err := TranslatePayload(elOnlyPayload())
	require.NoError(t, err)
	pf := &pypsapass.PowerFlow{
		Buses:      []pypsapass.Bus{{Name: "nb1", VNom: 0.4}},
		Lines:      []pypsapass.Line{},
		Generators: []pypsapass.Generator{{Name: "nb1_pv_supply_1", Bus: "nb1", Control: "PQ", PSet: []float64{1}}},
		Loads:      []pypsapass.Load{},
	}
	_, err = ApplyPowerFlow(job.Job, pf)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no generator control=Slack")
}

// TestComponentTechID_pinsTheNameSplitting pins the slack/tech id resolution:
// the longest bus prefix wins, so an underscore-carrying location (ntrafo_82)
// splits before the tech suffix, and a plain building node splits at its own
// boundary.
func TestComponentTechID_pinsTheNameSplitting(t *testing.T) {
	buses := []pypsapass.Bus{
		{Name: "nb1"},
		{Name: "ntrafo_82"},
		{Name: "ntrafo_82_mv"},
	}
	assert.Equal(t, "grid_trafo_82_import", componentTechID("ntrafo_82_grid_trafo_82_import", buses))
	assert.Equal(t, "pv_supply_1", componentTechID("nb1_pv_supply_1", buses))
	assert.Equal(t, "demand_1", componentTechID("nb1_demand_1", buses))
	assert.Equal(t, "", componentTechID("orphan_generator", buses), "no bus prefix -> unresolvable")
}

// TestApplyPowerFlow_isDeterministicAndIdempotent guards the overlay against
// re-application drift: folding the same pass onto the transformed job must
// change nothing.
func TestApplyPowerFlow_isDeterministicAndIdempotent(t *testing.T) {
	pf, job := powerFlowFixture(t)
	once, err := ApplyPowerFlow(job, pf)
	require.NoError(t, err)
	twice, err := ApplyPowerFlow(once, pf)
	require.NoError(t, err)
	assert.Equal(t, string(once), string(twice), "applying the overlay twice changes nothing")
}
