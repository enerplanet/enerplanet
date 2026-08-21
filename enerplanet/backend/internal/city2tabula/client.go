// Package city2tabula is a thin HTTP client for City2TABULA's on-request
// wrapper (THD-Spatial-AI/city2tabula, cmd/server): bbox-scoped 3D building
// data for whatever region a model's calculation needs. Used internally by
// the run_buem job, not exposed as a public backend route.
package city2tabula

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Bbox is a WGS84 (EPSG:4326) lon/lat bounding box — the CRS a user-drawn
// area of interest naturally comes in as (see geo.BBoxFromGeoJSON).
type Bbox struct {
	Xmin, Ymin, Xmax, Ymax float64
}

// Client talks to City2TABULA's on-request HTTP wrapper.
type Client struct {
	http *httpclient.Client
}

// NewClient creates a Client bound to City2TABULA's server at baseURL.
func NewClient(baseURL string) *Client {
	return &Client{http: httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second))}
}

// Run tracks a triggered City2TABULA pipeline run, as returned by both
// TriggerRun and GetRunStatus. Status is one of pending/running/completed/
// no_data/failed (see server.Run in City2TABULA's own internal/api/server).
type Run struct {
	RunID   string `json:"run_id"`
	Country string `json:"country"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// Building is one LOD2 building's thematic (non-geometric) 3D attributes, as
// City2TABULA's GET /api/v1/buildings returns them. Callers reshape these
// into whatever envelope block BuEM actually needs. No geometry here —
// City2TABULA serves that separately (GET /api/v1/geometry) for consumers
// that actually need to render it; nothing here does.
type Building struct {
	ObjectID          string    `json:"object_id"`
	OSMID             string    `json:"osm_id"`
	MatchType         int16     `json:"match_type"`
	MinHeight         *float64  `json:"min_height,omitempty"`
	MaxHeight         *float64  `json:"max_height,omitempty"`
	RoomHeight        *float64  `json:"room_height,omitempty"`
	NumberOfStoreys   *int32    `json:"number_of_storeys,omitempty"`
	FootprintAreaSqm  *float64  `json:"footprint_area,omitempty"`
	RoofAreaSqm       *float64  `json:"area_total_roof,omitempty"`
	WallAreaSqm       *float64  `json:"area_total_wall,omitempty"`
	FloorAreaSqm      *float64  `json:"area_total_floor,omitempty"`
	TabulaVariantCode *string   `json:"tabula_variant_code,omitempty"`
	Surfaces          []Surface `json:"surfaces,omitempty"`
}

// Surface is one envelope surface (wall, roof, or ground) belonging to a
// Building. Type is the raw CityGML classname (WallSurface, RoofSurface,
// GroundSurface).
type Surface struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	AreaSqm *float64 `json:"area,omitempty"`
	// Azimuth is -1 (undefined) for near-horizontal surfaces.
	Azimuth *float64 `json:"azimuth,omitempty"`
	// Tilt: 0=vertical wall, 90=flat roof — inverted from BuEM's own
	// convention (0=horizontal roof, 90=vertical wall); invert before mapping.
	Tilt     *float64 `json:"tilt,omitempty"`
	IsValid  *bool    `json:"is_valid,omitempty"`
	IsPlanar *bool    `json:"is_planar,omitempty"`
}

// normalizeCountry adapts the backend's country vocabulary (geo.NormalizeCountry,
// e.g. "uk") to City2TABULA's (isoByCountry/sridByCountry, e.g. "united_kingdom").
// Every other backend-supported country name already matches City2TABULA's own
// keys directly; countries City2TABULA doesn't support yet (e.g. "switzerland")
// are passed through unchanged and simply fail City2TABULA's own lookup.
func normalizeCountry(country string) string {
	if country == "uk" {
		return "united_kingdom"
	}
	return country
}

func bboxQuery(country string, bbox Bbox) string {
	return fmt.Sprintf("country=%s&xmin=%g&ymin=%g&xmax=%g&ymax=%g",
		url.QueryEscape(normalizeCountry(country)), bbox.Xmin, bbox.Ymin, bbox.Xmax, bbox.Ymax)
}

// GetCoverage returns how many already-linked buildings City2TABULA has for
// country within bbox — a cheap check to decide whether TriggerRun is needed.
func (c *Client) GetCoverage(ctx context.Context, country string, bbox Bbox) (int, error) {
	resp, err := c.http.Do(ctx, http.MethodGet, "/api/v1/coverage?"+bboxQuery(country, bbox), nil, nil)
	if err != nil {
		return 0, fmt.Errorf("city2tabula coverage request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("city2tabula coverage: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, fmt.Errorf("failed to decode coverage response: %w", err)
	}
	return body.Count, nil
}

// TriggerRun starts a bbox-scoped City2TABULA pipeline run for country and
// returns immediately with the run to poll via GetRunStatus.
func (c *Client) TriggerRun(ctx context.Context, country string, bbox Bbox) (*Run, error) {
	payload := map[string]interface{}{
		"country": normalizeCountry(country),
		"xmin":    bbox.Xmin, "ymin": bbox.Ymin, "xmax": bbox.Xmax, "ymax": bbox.Ymax,
	}
	resp, err := c.http.DoJSON(ctx, http.MethodPost, "/api/v1/runs", payload, nil)
	if err != nil {
		return nil, fmt.Errorf("city2tabula trigger-run request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return nil, fmt.Errorf("city2tabula trigger-run: unexpected status %d", resp.StatusCode)
	}

	var run Run
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return nil, fmt.Errorf("failed to decode trigger-run response: %w", err)
	}
	return &run, nil
}

// GetRunStatus polls the status of a run started by TriggerRun.
func (c *Client) GetRunStatus(ctx context.Context, runID string) (*Run, error) {
	resp, err := c.http.Do(ctx, http.MethodGet, "/api/v1/runs/"+url.PathEscape(runID), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("city2tabula run-status request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("city2tabula run-status: unexpected status %d", resp.StatusCode)
	}

	var run Run
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return nil, fmt.Errorf("failed to decode run-status response: %w", err)
	}
	return &run, nil
}

// GetBuildingsByBBox returns 3D attributes for every building in country
// whose footprint intersects bbox, independent of any PyLovo link.
func (c *Client) GetBuildingsByBBox(ctx context.Context, country string, bbox Bbox) ([]Building, error) {
	resp, err := c.http.Do(ctx, http.MethodGet, "/api/v1/buildings?"+bboxQuery(country, bbox), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("city2tabula buildings request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("city2tabula buildings: unexpected status %d", resp.StatusCode)
	}

	var buildings []Building
	if err := json.NewDecoder(resp.Body).Decode(&buildings); err != nil {
		return nil, fmt.Errorf("failed to decode buildings response: %w", err)
	}
	return buildings, nil
}
