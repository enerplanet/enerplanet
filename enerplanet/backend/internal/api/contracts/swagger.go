// Package contracts defines request/response types used for Swagger documentation.
// These types mirror the actual JSON structures returned by handlers and are
// referenced by swaggo annotations via @Success/@Failure tags.
package contracts

import "time"

// --- Generic response envelopes ---

// ErrorResponse is the standard error response envelope.
type ErrorResponse struct {
	Error string `json:"error" example:"Unauthorized"`
}

// --- Models ---

// ModelSummary represents a model in list responses.
type ModelSummary struct {
	ID          uint       `json:"id" example:"42"`
	UserID      string     `json:"user_id" example:"f47ac10b-58cc-4372-a567-0e02b2c3d479"`
	UserEmail   string     `json:"user_email" example:"user@example.com"`
	WorkspaceID *uint      `json:"workspace_id,omitempty" example:"1"`
	Title       string     `json:"title" example:"Munich District Heating"`
	Description *string    `json:"description,omitempty" example:"Heating model for Munich south"`
	Status      string     `json:"status" example:"draft"`
	Region      *string    `json:"region,omitempty" example:"Bavaria"`
	Country     *string    `json:"country,omitempty" example:"DE"`
	Resolution  *int       `json:"resolution,omitempty" example:"8"`
	FromDate    time.Time  `json:"from_date" example:"2025-01-01T00:00:00Z"`
	ToDate      time.Time  `json:"to_date" example:"2025-12-31T00:00:00Z"`
	IsActive    bool       `json:"is_active" example:"false"`
	IsCopy      bool       `json:"is_copy" example:"false"`
	CreatedAt   time.Time  `json:"created_at" example:"2025-06-15T10:30:00Z"`
	UpdatedAt   time.Time  `json:"updated_at" example:"2025-06-15T10:30:00Z"`
}

// GetModelsResponse is the response for GET /api/models.
type GetModelsResponse struct {
	Success    bool           `json:"success" example:"true"`
	Data       []ModelSummary `json:"data"`
	Total      int64          `json:"total" example:"25"`
	Limit      int            `json:"limit" example:"100"`
	Offset     int            `json:"offset" example:"0"`
	ServerTime string         `json:"server_time" example:"2025-06-15T10:30:00Z"`
}

// --- Pylovo Boundary ---

// BoundaryRegion contains metadata about the matched administrative region.
type BoundaryRegion struct {
	Name         string `json:"name" example:"Bayern"`
	AdminLevel   int    `json:"admin_level" example:"4"`
	Country      string `json:"country,omitempty" example:"Germany"`
	CountryCode  string `json:"country_code,omitempty" example:"DE"`
	OsmID        int64  `json:"osm_id,omitempty" example:"2145268"`
}

// BoundaryData is the data portion of the boundary response.
type BoundaryData struct {
	Status   string          `json:"status" example:"success"`
	Region   *BoundaryRegion `json:"region,omitempty"`
	Boundary interface{}     `json:"boundary,omitempty"` // GeoJSON Feature
	Message  string          `json:"message,omitempty" example:""`
}

// GetBoundaryResponse is the response for GET /api/v2/pylovo/boundary.
type GetBoundaryResponse struct {
	Success bool         `json:"success" example:"true"`
	Data    BoundaryData `json:"data"`
}
