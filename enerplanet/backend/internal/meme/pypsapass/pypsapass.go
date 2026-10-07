// Package pypsapass builds the MEME `power_flow` leg of a model from the
// backend's already-built calculation payload and the parsed Calliope
// carrier_prod/carrier_con time series. It is the Go port of the legacy c2p
// conversion (dependencies/simulation-engine/.../c2p): a pure function,
//
//	payload + parsed Calliope results -> IsolatedPowerFlow
//
// that the 1B dispatch endpoint then embeds into a MEME job body and submits
// to the `meme-pypsa` TentaCron target. The type catalogue (cable/trafo
// electrical params), unit scale, per-level v_nom and affixes are all
// configurable via the embedded catalog.json — a PyPSA/branch version bump is
// an edit there, never code (see the "configurable" note in the 1B plan).
//
// Deliberately NOT here: the isolated dispatch / run-record handling (that is
// the endpoint's job) and the bundle ingest (the result layer's job).
package pypsapass

// CableParams is the electrical parameter set resolved from a cable type.
// Values mirror pylovo equipment_data.csv units: resistance/reactance in
// mOhm/km, current rating in A.
type CableParams struct {
	ROhmPerKm float64 `json:"r_mohm_per_km"`
	XOhmPerKm float64 `json:"x_mohm_per_km"`
	MaxIAmps  float64 `json:"max_i_a"`
}

// TransformerParams is the rating resolved from a transformer type (kVA).
type TransformerParams struct {
	SKva float64 `json:"s_max_kva"`
}

// Config is the embedded, versionable defaults for the pass (see catalog.json).
type Config struct {
	SchemaVersion string                       `json:"schema_version"`
	Unit          float64                      `json:"unit"` // p_set scale. 1.0 = passthrough: the MEME Calliope results_flow_*.csv are natively MW (PyPSA p_set unit).
	VoltagesKV    map[string]float64           `json:"voltages_kv"`
	Affixes       Affixes                      `json:"affixes"`
	DefaultTypes  DefaultTypes                 `json:"default_types"`
	Cables        map[string]CableParams       `json:"cables"`
	Transformers  map[string]TransformerParams `json:"transformers"`
}

// Affixes are the name-prefix/suffix rules the legacy create.py applied when
// naming buses and transformer endpoints.
type Affixes struct {
	PrefixBus        string `json:"prefix_bus"`
	PrefixPOI        string `json:"prefix_poi"`
	SuffixTrafoBusLV string `json:"suffix_trafo_bus_lv"`
	SuffixTrafoBusMV string `json:"suffix_trafo_bus_mv"`
	SuffixTrafoBusHV string `json:"suffix_trafo_bus_hv"`
}

// DefaultTypes are the fallback line/trafo types when the payload carries none.
type DefaultTypes struct {
	LineTypeLV    string `json:"line_type_lv"`
	LineTypeMV    string `json:"line_type_mv"`
	TrafoTypeMVLV string `json:"trafo_type_mv_lv"`
}

// PowerFlow is the isolated PyPSA power-flow network this pass produces from
// the Calliope results. Buses/lines/trafos come from the payload topology; the
// per-bus p_set series come from the parsed carrier_prod/con records. Final
// JSON emission into the MEME job body is a thin adapter (1C defines its shape).
type PowerFlow struct {
	Buses        []Bus         `json:"buses"`
	Lines        []Line        `json:"lines"`
	Transformers []Transformer `json:"transformers"`
	Generators   []Generator   `json:"generators"`
	Loads        []Load        `json:"loads"`
}

// Bus is one electrical bus with its nominal voltage (kV).
type Bus struct {
	Name string  `json:"name"`
	VNom float64 `json:"v_nom_kv"`
}

// Line is one electrical line between two buses. r/x are in Ohm (resolved from
// the cable type × length × num_parallel), s_nom in MVA. This is the literal
// parameter form — MEME stays decoupled from the cable catalogue.
type Line struct {
	Name        string  `json:"name"`
	Bus0        string  `json:"bus0"`
	Bus1        string  `json:"bus1"`
	LengthKm    float64 `json:"length_km"`
	NumParallel float64 `json:"num_parallel"`
	ROhm        float64 `json:"r_ohm"`
	XOhm        float64 `json:"x_ohm"`
	SNomMVA     float64 `json:"s_nom_mva"`
}

// Transformer is one MV/LV (or HV/MV) transformer. s_nom in MVA.
type Transformer struct {
	Name        string  `json:"name"`
	Bus0        string  `json:"bus0"`
	Bus1        string  `json:"bus1"`
	SNomMVA     float64 `json:"s_nom_mva"`
	NumParallel float64 `json:"num_parallel"`
}

// Generator is a supply injection at a bus with its per-timestep p_set (MW).
type Generator struct {
	Name    string    `json:"name"`
	Bus     string    `json:"bus"`
	Control string    `json:"control"` // "Slack" | "PQ" — mirrors the legacy slack conventions
	PSet    []float64 `json:"p_set_mw"`
}

// Load is a demand withdrawal at a bus with its per-timestep p_set (MW).
type Load struct {
	Name string    `json:"name"`
	Bus  string    `json:"bus"`
	PSet []float64 `json:"p_set_mw"`
}

// CarrierSeries is one location's per-timestep production or consumption.
// FromLocation is the Calliope location (which maps onto a bus name); Tech is
// the technology id; Timeseries is index-aligned with the model timesteps.
type CarrierSeries struct {
	FromLocation string
	Tech         string
	Timeseries   []float64
}

// carrierRecord is the minimal per-timestep row the pass consumes — the same
// shape the legacy results_carrier_prod/con.csv carry and result_parser.go
// already reads (locs, techs, timesteps, value).
type carrierRecord struct {
	FromLocation string
	Tech         string
	Timestep     int // index into the model's timesteps
	Value        float64
}

// LoadOptions carries the pass inputs: the payload's pypsa settings + topology
// and the parsed carrier series. Keeping it as a struct lets the unit tests
// drive the resolver without a full CalculationPayload.
type LoadOptions struct {
	// Pypsa is payload.Pypsa (map from CalculationPayload). Recognized keys:
	// line_type_lv, line_type_mv, trafo_mv_lv_type, *_num_parallel.
	Pypsa map[string]interface{}

	// Topology is payload.Topology — one entry per connection:
	// {from: <feature>, to: <feature>, length: <km>, pipe: "lv"|"mv"}.
	Topology []map[string]interface{}

	// CarrierProd / CarrierCon are the per-location per-tech per-timestep
	// series parsed from the Calliope results.
	CarrierProd []CarrierSeries
	CarrierCon  []CarrierSeries

	// NumTimesteps is the number of model timesteps (index-aligned with each
	// carrier series). It bounds every p_set.
	NumTimesteps int
}

// Build resolves the pass inputs into the isolated power-flow network. It is
// the single entrypoint the 1B dispatch endpoint calls: given the payload's
// pypsa settings + topology and the parsed Calliope carrier series, it returns
// the PowerFlow the endpoint embeds into the MEME `meme-pypsa` job body.
func Build(opts LoadOptions) (*PowerFlow, error) {
	return build(defaultConfig, opts)
}
