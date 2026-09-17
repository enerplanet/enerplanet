package contracts

import "encoding/json"

// --- Per-building BuEM run ---

// BuemBuildingRunRequest is the POST /api/v1/buem/building body. It carries one
// building's geometry and its BuEM building block, the same two fields a model
// run assembles per building, so a caller that has edited an envelope can run
// exactly what it is showing.
//
// building is passed to buem-gateway verbatim and must be complete: this
// endpoint resolves no U-values and applies no archetype defaults, unlike the
// model path, which fills them from a TABULA variant when City2TABULA supplies
// the envelope.
type BuemBuildingRunRequest struct {
	OSMID      string          `json:"osm_id" example:"240054621"`
	Geometry   json.RawMessage `json:"geometry" swaggertype:"object"`
	Building   json.RawMessage `json:"building" swaggertype:"object"`
	StartDate  string          `json:"start_date" example:"2018-01-01T00:00:00Z"`
	EndDate    string          `json:"end_date" example:"2018-12-31T23:00:00Z"`
	Resolution int             `json:"resolution,omitempty" example:"60"`
	ModelID    string          `json:"model_id,omitempty" example:"42"`
}

// BuemBuildingRunResponse carries BuEM's result for the building unchanged.
// buem is the same block a model run merges onto a topology node, including
// thermal_load_profile.timeseries, which the batch path omits.
type BuemBuildingRunResponse struct {
	OSMID string          `json:"osm_id"`
	BUEM  json.RawMessage `json:"buem" swaggertype:"object"`
}
