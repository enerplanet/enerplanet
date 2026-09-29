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
	SchemaVersion          string                     `json:"schema_version"`
	Framework              string                     `json:"framework"`
	FrameworkVersion       string                     `json:"framework_version"`
	ModelName              *string                    `json:"model_name"`
	Solver                 *string                    `json:"solver"`
	Success                *bool                      `json:"success"`
	TerminationCondition   *string                    `json:"termination_condition"`
	Objective              *float64                   `json:"objective"`
	ObjectiveFunctionValue *float64                   `json:"objective_function_value"`
	Timestamps             []string                   `json:"timestamps"`
	Capacities             map[string]float64         `json:"capacities"`          // "loc::tech" -> installed capacity
	StorageCapacities      map[string]float64         `json:"storage_capacities"`  // "loc::tech" -> energy capacity
	Coordinates            map[string][]float64       `json:"coordinates"`         // "loc" -> [x, y]
	CostsByLocation        map[string]map[string]float64 `json:"costs_by_location"` // "loc" -> { "tech": cost }
	CostsByTech            map[string]float64         `json:"costs_by_tech"`        // "tech" -> cost (systemwide)
	TotalUnmetDemand       *float64                   `json:"total_unmet_demand"`

	// Large time-series — deferred for the R2 streaming tables (see above).
	Generation        map[string]json.RawMessage `json:"generation"`
	Dispatch          map[string]json.RawMessage `json:"dispatch"`
	DemandTimeseries  json.RawMessage            `json:"demand_timeseries"`
	TransmissionFlow  map[string]json.RawMessage `json:"transmission_flow"`

	Warnings []string        `json:"warnings"`
	Metadata json.RawMessage `json:"metadata"`
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
	Framework           string   `json:"framework"`
	FrameworkVersion    string   `json:"framework_version"`
	ModelName           string   `json:"model_name,omitempty"`
	Solver              string   `json:"solver,omitempty"`
	Success             bool     `json:"success"`
	TerminationCondition string  `json:"termination_condition,omitempty"`
	Objective           *float64 `json:"objective,omitempty"`
	TotalUnmetDemand    *float64 `json:"total_unmet_demand,omitempty"`
	EnergyCapCount      int      `json:"energy_cap_count"`
	StorageCapCount     int      `json:"storage_capacity_count"`
	LocationCount       int      `json:"location_count"`
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