package resultservice

import "encoding/json"

// CoatiResultsDocument is the unified results document Coati writes (schema
// "1.0"). Only the fields the R2 ingest consumes are typed; scalar totals are
// mapped into the small tables. Large per-timestep series (dispatch, demand,
// transmission) are kept as json.RawMessage and currently deferred — Coati's
// series are tech/location-aggregated and do not carry the per-location,
// per-carrier dimensions results_carrier_prod/con require.
//
// See enerplanet/.local/dependencies/coati/COATI.md for the full schema.
type CoatiResultsDocument struct {
	SchemaVersion          string                        `json:"schema_version"`
	Framework              string                        `json:"framework"`
	FrameworkVersion       string                        `json:"framework_version"`
	ModelName              *string                       `json:"model_name"`
	Solver                 *string                       `json:"solver"`
	Success                *bool                         `json:"success"`
	TerminationCondition   *string                       `json:"termination_condition"`
	Objective              *float64                      `json:"objective"`
	ObjectiveFunctionValue *float64                      `json:"objective_function_value"`
	Timestamps             []string                      `json:"timestamps"`
	Capacities             map[string]float64            `json:"capacities"`         // "loc::tech" -> installed capacity
	StorageCapacities      map[string]float64            `json:"storage_capacities"` // "loc::tech" -> energy capacity
	Coordinates            map[string][]float64          `json:"coordinates"`        // "loc" -> [x, y]
	CostsByLocation        map[string]map[string]float64 `json:"costs_by_location"`  // "loc" -> { "tech": cost }
	CostsByTech            map[string]float64            `json:"costs_by_tech"`      // "tech" -> cost (systemwide)
	TotalUnmetDemand       *float64                      `json:"total_unmet_demand"`

	// Large time-series — the wire mapping consumes TransmissionFlow; the rest
	// is deferred for the R2 streaming tables (see above).
	Generation       map[string]json.RawMessage   `json:"generation"`
	Dispatch         map[string]json.RawMessage   `json:"dispatch"`
	DemandTimeseries json.RawMessage              `json:"demand_timeseries"`
	TransmissionFlow map[string]CoatiTransmission `json:"transmission_flow"`

	// TechMetadata classifies every technology (parent: supply | demand |
	// conversion | storage | transmission). It is the authoritative way to tell
	// a wire from a conversion link.
	TechMetadata map[string]CoatiTechMetadata `json:"tech_metadata"`

	Warnings []string        `json:"warnings"`
	Metadata json.RawMessage `json:"metadata"`
}

// CoatiTechMetadata is one entry of the document's tech_metadata map.
type CoatiTechMetadata struct {
	Parent     string `json:"parent"`
	CarrierOut string `json:"carrier_out"`
}

// CoatiTransmission is one entry of transmission_flow, keyed "a::b" (a<b
// alphabetically). Timeseries is the NET ARRIVAL at To — i.e. the origin-side
// flow scaled by the arc's efficiency — and is index-aligned with the
// document's Timestamps.
type CoatiTransmission struct {
	From       string    `json:"from"`
	To         string    `json:"to"`
	Timeseries []float64 `json:"timeseries"`
}

// IsTransmission reports whether a technology is classified as a transmission
// arc (a wire) by the document's tech_metadata.
func (d *CoatiResultsDocument) IsTransmission(tech string) bool {
	meta, ok := d.TechMetadata[tech]
	return ok && meta.Parent == "transmission"
}

// doesCoatiSucceed reports whether the document grades as a successful solve
// (success true and a termination condition; a nil document is a failure).
func (d *CoatiResultsDocument) doesCoatiSucceed() bool {
	if d == nil || d.Success == nil {
		return false
	}
	return *d.Success
}

// CoatiSummary is the compact JSON written to model.results for the Coati
// ingest path (analogous to legacy results JSON, but derived from the Coati
// document rather than the Calliope CSVs).
type CoatiSummary struct {
	Framework            string   `json:"framework"`
	FrameworkVersion     string   `json:"framework_version"`
	ModelName            string   `json:"model_name,omitempty"`
	Solver               string   `json:"solver,omitempty"`
	Success              bool     `json:"success"`
	TerminationCondition string   `json:"termination_condition,omitempty"`
	Objective            *float64 `json:"objective,omitempty"`
	TotalUnmetDemand     *float64 `json:"total_unmet_demand,omitempty"`
	EnergyCapCount       int      `json:"energy_cap_count"`
	StorageCapCount      int      `json:"storage_capacity_count"`
	LocationCount        int      `json:"location_count"`

	// LineCount is the number of wires the document reported a flow for.
	LineCount int `json:"line_count,omitempty"`
}

func buildCoatiSummary(doc *CoatiResultsDocument) *CoatiSummary {
	s := &CoatiSummary{
		Framework:        doc.Framework,
		FrameworkVersion: doc.FrameworkVersion,
		Success:          doc.doesCoatiSucceed(),
		EnergyCapCount:   len(doc.Capacities),
		StorageCapCount:  len(doc.StorageCapacities),
		LocationCount:    len(doc.Coordinates),
	}
	if doc.ModelName != nil {
		s.ModelName = *doc.ModelName
	}
	if doc.Solver != nil {
		s.Solver = *doc.Solver
	}
	if doc.TerminationCondition != nil {
		s.TerminationCondition = *doc.TerminationCondition
	}
	s.Objective = doc.Objective
	s.TotalUnmetDemand = doc.TotalUnmetDemand
	return s
}
