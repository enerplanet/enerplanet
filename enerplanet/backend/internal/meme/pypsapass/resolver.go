package pypsapass

// resolver.go holds the pure mapping from load options + config into a
// PowerFlow. It mirrors the legacy c2p create.py / read.py / net.py logic:
// buses/lines/trafos from the topology + pypsa types, generators/loads from
// the carrier series, electrical params resolved from the type catalogue
// (never literal on the wire).

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// loadConfig loads the embedded, versionable defaults. Kept as a plain read so
// a version bump only touches the catalogue; identity of the embedded bytes is
// established at build time.
func loadConfig() Config {
	var c Config
	if err := unmarshalCatalog(&c); err != nil {
		panic("pypsapass: invalid embedded catalog: " + err.Error())
	}
	if c.Unit == 0 {
		c.Unit = 1.0 // passthrough: MEME Calliope results_flow_*.csv are natively MW (PyPSA p_set unit)
	}
	return c
}

var defaultConfig = loadConfig()

// NodeID is the MEME node name a feature becomes: the mapping routes
// topology from/to features into model.nodes{n<id>}. The power-flow block must
// reuse the SAME names so generator/load p_set (whose locations are those node
// names in the Calliope results) attach to the right buses.
func NodeID(id string) string {
	return "n" + id
}

// build resolves the options into a PowerFlow.
func build(cfg Config, opts LoadOptions) (*PowerFlow, error) {
	pf := &PowerFlow{
		Buses:        []Bus{},
		Lines:        []Line{},
		Transformers: []Transformer{},
		Generators:   []Generator{},
		Loads:        []Load{},
	}
	buses := map[string]float64{} // bus name -> v_nom
	// trafoMV maps a transformer's LV-side bus name -> its MV-side bus name.
	// Grid/supply that lands on a trafo's LV bus belongs on the MV side (the
	// utility connection point) and is the network's slack reference.
	trafoMV := map[string]string{}
	numTimesteps := opts.NumTimesteps
	if numTimesteps < 0 {
		numTimesteps = 0
	}

	addBus := func(name string, vNom float64) {
		if _, ok := buses[name]; ok {
			return
		}
		buses[name] = vNom
	}

	// --- 1. buses + lines/trafos from the topology -------------------------
	// v_nom per pipe level from the config; a line's electrical params are
	// resolved from its type (pipe -> type -> catalogue) x length x num_parallel.
	// A connection's `to` is usually the transformer node (building -> trafo),
	// so the transformer is emitted there: an LV cable from the building to the
	// trafo's LV bus, plus an MV->LV transformer and the trafo's MV-side bus.
	for i, entry := range opts.Topology {
		pipe, _ := entry["pipe"].(string)
		length, _ := number(entry["length"])
		from := feature(entry["from"])
		to := feature(entry["to"])

		bus0Name := NodeID(from.id)
		if bus0Name == "n" {
			continue
		}
		addBus(bus0Name, vNomFor(cfg, pipe))

		if to.id == "" {
			continue // standalone building (no transformer) — bus only, no line
		}
		bus1Name := NodeID(to.id)
		addBus(bus1Name, vNomFor(cfg, pipe))

		p := cableParams(cfg, pipe)
		vNom := vNomFor(cfg, pipe)
		pf.Lines = append(pf.Lines, Line{
			Name:        fmt.Sprintf("%s_%d", pipe, i),
			Bus0:        bus0Name,
			Bus1:        bus1Name,
			LengthKm:    length,
			NumParallel: numParallel(cfg, opts, "line_"+pipe),
			ROhm:        p.ROhmPerKm * length / 1000.0, // mOhm/km * km / 1000 -> Ohm
			XOhm:        p.XOhmPerKm * length / 1000.0,
			SNomMVA:     cableSNom(p, vNom),
		})

		// Transformer on the `to` node: MV->LV pair + an MV-side bus.
		if to.isTransformer {
			mvName := NodeID(to.id + cfg.Affixes.SuffixTrafoBusMV)
			if _, ok := buses[mvName]; !ok {
				addBus(mvName, cfg.VoltagesKV["mv"])
				trafoMV[bus1Name] = mvName // LV-side -> MV-side; used in section 3
				pf.Transformers = append(pf.Transformers, Transformer{
					Name:        to.id,
					Bus0:        mvName, // MV side (higher voltage)
					Bus1:        bus1Name,
					SNomMVA:     trafoSNom(cfg, opts, to.ratedPowerKVA),
					NumParallel: numParallel(cfg, opts, "trafo_mv_lv"),
				})
			}
		}
	}

	// --- 2. deterministic bus output order (Go map iteration is random) ----
	names := make([]string, 0, len(buses))
	for name := range buses {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		pf.Buses = append(pf.Buses, Bus{Name: name, VNom: buses[name]})
	}

	// --- 3. generators (carrier_prod) + loads (carrier_con), per bus -------
	// Each location maps to its bus by name; the series are already index-aligned
	// with the model timesteps and scaled by the unit here.
	//
	// Generator placement: a supply whose node is a transformer's LV-side bus is
	// the utility grid connection — it belongs on the transformer's MV-side bus
	// and is the network's slack reference (power enters the LV grid at the trafo,
	// then flows out the LV feeders). Any other supply (e.g. building PV) stays a
	// PQ generator at its own bus. Note: the topology's lines are NOT generators —
	// the dispatch leg strips the connecting-line techs before building the pass.
	for _, g := range opts.CarrierProd {
		bus := g.FromLocation
		control := "PQ"
		if mv, ok := trafoMV[bus]; ok {
			bus = mv
			control = "Slack"
		}
		pf.Generators = append(pf.Generators, Generator{
			Name:    g.FromLocation + "_" + g.Tech,
			Bus:     bus,
			Control: control,
			PSet:    scaleSeries(capTo(g.Timeseries, numTimesteps), cfg.Unit),
		})
	}
	for _, l := range opts.CarrierCon {
		pf.Loads = append(pf.Loads, Load{
			Name: l.FromLocation + "_" + l.Tech,
			Bus:  l.FromLocation,
			PSet: scaleSeries(capTo(l.Timeseries, numTimesteps), cfg.Unit),
		})
	}

	return pf, nil
}

// --- small helpers --------------------------------------------------------

func vNomFor(cfg Config, pipe string) float64 {
	switch strings.ToLower(pipe) {
	case "lv":
		return cfg.VoltagesKV["lv"]
	case "mv":
		return cfg.VoltagesKV["mv"]
	case "hv":
		return cfg.VoltagesKV["hv"]
	default:
		if cfg.VoltagesKV != nil {
			if v, ok := cfg.VoltagesKV["lv"]; ok {
				return v
			}
		}
		return 0.4 // legacy LV default
	}
}

func numParallel(cfg Config, opts LoadOptions, key string) float64 {
	v, ok := opts.Pypsa[key+"_num_parallel"]
	if !ok {
		return 1.0
	}
	if f, err := number(v); err == nil && f > 0 {
		return f
	}
	return 1.0
}

// trafoSNom resolves the transformer rating (MVA). Prefer the config's trafo
// type catalogue; fall back to the rating carried on the topology node.
func trafoSNom(cfg Config, opts LoadOptions, ratedKVA float64) float64 {
	ttype := stringSetting(opts.Pypsa, "trafo_mv_lv_type")
	if ttype == "" {
		ttype = cfg.DefaultTypes.TrafoTypeMVLV
	}
	if t, ok := cfg.Transformers[ttype]; ok && t.SKva > 0 {
		return t.SKva / 1000.0 // kVA -> MVA
	}
	if ratedKVA > 0 {
		return ratedKVA / 1000.0
	}
	return 0.4 // legacy default 0.4 MVA
}

// cableParams resolves a pipe's cable electrical params from the config.
func cableParams(cfg Config, pipe string) CableParams {
	ttype := ""
	switch strings.ToLower(pipe) {
	case "lv":
		ttype = cfg.DefaultTypes.LineTypeLV
	case "mv":
		ttype = cfg.DefaultTypes.LineTypeMV
	}
	if c, ok := cfg.Cables[ttype]; ok {
		return c
	}
	// fall back to the first known cable (deterministic by sorted key)
	keys := make([]string, 0, len(cfg.Cables))
	for k := range cfg.Cables {
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		return CableParams{}
	}
	sort.Strings(keys)
	return cfg.Cables[keys[0]]
}

// cableSNom computes a line's apparent-power rating (MVA) from its current
// rating and the line's nominal voltage (kV): S = sqrt(3) * V_line * I / 1e6.
func cableSNom(p CableParams, vNomKV float64) float64 {
	if p.MaxIAmps <= 0 || vNomKV <= 0 {
		return 0.0
	}
	return 1.7320508 * vNomKV * 1000.0 * p.MaxIAmps / 1e6 // sqrt(3)*V(kV)*I(A) -> MVA
}

func capTo(series []float64, n int) []float64 {
	if n == 0 || len(series) <= n {
		return series
	}
	return series[:n]
}

func scaleSeries(series []float64, unit float64) []float64 {
	if unit == 0 || unit == 1 {
		return series
	}
	out := make([]float64, len(series))
	for i, v := range series {
		out[i] = v * unit
	}
	return out
}

func stringSetting(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

type topologyFeature struct {
	id            string
	isTransformer bool
	ratedPowerKVA float64
}

// feature extracts identity + type from a topology from/to feature (a GeoJSON
// Feature map). id comes from feature.id, falling back to properties.id.
func feature(v interface{}) topologyFeature {
	t, _ := v.(map[string]interface{})
	if t == nil {
		return topologyFeature{}
	}
	f := topologyFeature{}
	id, _ := t["id"].(string)
	if id == "" {
		if p, ok := t["properties"].(map[string]interface{}); ok {
			id, _ = p["id"].(string)
		}
	}
	f.id = id
	if p, ok := t["properties"].(map[string]interface{}); ok {
		if ft, ok := p["feature_type"].(string); ok && strings.EqualFold(ft, "topologynode") {
			f.isTransformer = true
		}
		if fc, ok := p["f_class"].(string); ok && strings.EqualFold(fc, "transformer") {
			f.isTransformer = true
		}
		f.ratedPowerKVA, _ = number(p["rated_power_kva"])
		if f.ratedPowerKVA == 0 {
			f.ratedPowerKVA, _ = number(p["rated_power"])
		}
	}
	return f
}

// number is a tolerant float extractor for the untyped payload maps.
func number(v interface{}) (float64, error) {
	switch n := v.(type) {
	case float64:
		return n, nil
	case int:
		return float64(n), nil
	case int64:
		return float64(n), nil
	case json.Number:
		return n.Float64()
	}
	return 0, fmt.Errorf("not a number: %T", v)
}
