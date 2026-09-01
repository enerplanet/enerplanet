package contracts

import "spatialhub_backend/internal/city2tabula"

// --- City2TABULA enrich endpoint ---

// EnrichBbox is the drawn area in WGS84 lon/lat. It is used only to trigger a
// City2TABULA pipeline run when some buildings are not yet linked.
type EnrichBbox struct {
	Xmin float64 `json:"xmin" example:"6.09"`
	Ymin float64 `json:"ymin" example:"51.90"`
	Xmax float64 `json:"xmax" example:"6.13"`
	Ymax float64 `json:"ymax" example:"51.93"`
}

// EnrichRequest is the POST /api/v1/city2tabula/enrich body.
type EnrichRequest struct {
	Country string     `json:"country" example:"germany"`
	Bbox    EnrichBbox `json:"bbox"`
	OSMIDs  []string   `json:"osm_ids" example:"240054621,240054622"`
}

// EnrichQuantity is a value with its unit.
type EnrichQuantity struct {
	Value float64 `json:"value" example:"2.5"`
	Unit  string  `json:"unit" example:"m"`
}

// BuemEnvelope holds the envelope elements derived from City2TABULA geometry.
type BuemEnvelope struct {
	Elements []city2tabula.EnvelopeElement `json:"elements"`
}

// BuemBuilding is the building node the configurator folds onto its feature's
// properties.buem. Scalar fields appear only when City2TABULA provides them.
type BuemBuilding struct {
	NStoreys      *int32          `json:"n_storeys,omitempty" example:"3"`
	HRoom         *EnrichQuantity `json:"h_room,omitempty"`
	FootprintArea *EnrichQuantity `json:"footprint_area,omitempty"`
	Envelope      BuemEnvelope    `json:"envelope"`
}

// BuemNode wraps BuemBuilding under a "building" key, matching the buem-gateway
// v5 request shape.
type BuemNode struct {
	Building BuemBuilding `json:"building"`
}

// EnrichedBuilding is one entry in the merge map, keyed by osm_id.
type EnrichedBuilding struct {
	ObjectID          string   `json:"object_id" example:"DEBW_1"`
	MatchType         int16    `json:"match_type" example:"1"`
	TabulaVariantCode *string  `json:"tabula_variant_code,omitempty" example:"DE.N.SFH.05.Gen.ReEx.001.001"`
	Buem              BuemNode `json:"buem"`
}

// EnrichResponse is returned by both enrich endpoints.
//
// status is one of:
//   - completed: every requested osm_id resolved
//   - running:   a pipeline run is in progress (run_id set); poll the run endpoint
//   - partial:   some resolved, a run was needed but could not be triggered
//   - pending / no_data / failed: City2TABULA's own run states (run endpoint only)
type EnrichResponse struct {
	Status   string                      `json:"status" example:"completed"`
	RunID    string                      `json:"run_id,omitempty" example:"a1b2c3d4"`
	Resolved int                         `json:"resolved" example:"40"`
	Total    int                         `json:"total" example:"42"`
	Missing  []string                    `json:"missing,omitempty" example:"240054999"`
	Data     map[string]EnrichedBuilding `json:"data"`
}
