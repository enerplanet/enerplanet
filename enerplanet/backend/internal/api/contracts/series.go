package contracts

import (
	"time"

	"spatialhub_backend/internal/seriessummary"
)

// --- Per-building series endpoints ---

// SeriesSummary is one stored series of a building, reduced to totals, the
// peak and daily, weekly and monthly energy. Values are magnitudes: cooling is
// reported positive.
type SeriesSummary struct {
	// name is the series: heating, cooling, electricity, hot_water, kitchen.
	Name string `json:"name" example:"heating"`
	// part is the roof face for a PV series, empty for a whole-building series.
	Part              string    `json:"part,omitempty"`
	Source            string    `json:"source" enums:"default,user,uploaded" example:"default"`
	ProducerVersion   string    `json:"producer_version,omitempty" example:"6.10.0+21f79d7ce08016a6df43e81aaad6aa7493c40c25"`
	Start             time.Time `json:"start" example:"1900-01-01T00:00:00Z"`
	ResolutionMinutes int       `json:"resolution_minutes" example:"60"`
	seriessummary.Summary
}

// BuildingDemandProfileResponse is the response for
// GET /models/{id}/buildings/{building_ref}/demand-profile.
type BuildingDemandProfileResponse struct {
	BuildingRef string          `json:"building_ref" example:"268426401"`
	Series      []SeriesSummary `json:"series"`
}

// SeriesWindowResponse is the response for
// GET /models/{id}/buildings/{building_ref}/series/{series}: one week of power
// values, the first at start.
type SeriesWindowResponse struct {
	BuildingRef       string    `json:"building_ref" example:"268426401"`
	Series            string    `json:"series" example:"heating"`
	Part              string    `json:"part,omitempty"`
	Week              int       `json:"week" example:"0"`
	Unit              string    `json:"unit" example:"kW"`
	Start             time.Time `json:"start" example:"1900-01-01T00:00:00Z"`
	ResolutionMinutes int       `json:"resolution_minutes" example:"60"`
	Values            []float32 `json:"values"`
}

// ClaimDraftSeriesRequest is the body of POST /models/{id}/series/claim-draft.
type ClaimDraftSeriesRequest struct {
	DraftID string `json:"draft_id" binding:"required" example:"3f6c2a1e-8b1d-4c2e-9a7f-1e2d3c4b5a69"`
}

// ClaimDraftSeriesResponse reports how many series links moved to the model.
type ClaimDraftSeriesResponse struct {
	Moved int64 `json:"moved" example:"24"`
}
