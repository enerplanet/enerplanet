// Package city2tabula resolves bbox-scoped 3D building data from City2TABULA's
// on-request wrapper (THD-Spatial-AI/city2tabula, cmd/server), reached through
// the TentaCron orchestrator - the backend makes no direct City2TABULA call.
// Used by the run_buem job and the enrich handler (internal/handler/city2tabula).
package city2tabula

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"spatialhub_backend/internal/tentacron"
)

// TentaCron proxy target names for the three City2TABULA calls. Each is a proxy
// target with response.mode direct; TentaCron maps the payload onto the
// City2TABULA URL per its target config.
const (
	targetTriggerRun = "c2t-trigger-run"
	targetRunStatus  = "c2t-run-status"
	targetBuildings  = "c2t-buildings"
)

// ErrRunNotFound is returned by GetRunStatus when City2TABULA has no run with
// the given id (a stale or mistyped id), so callers can answer 404 rather than
// treat it as an upstream failure.
var ErrRunNotFound = errors.New("city2tabula: run not found")

// BadRequestError is a 400 from City2TABULA (an unsupported country, a
// malformed bbox) carried through with its message so a handler can answer 400
// rather than a blanket 502.
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	return "city2tabula rejected the request: " + e.Message
}

// c2tRejectionCodes are the TentaCron job error codes that mean City2TABULA
// itself declined or failed the call. Other codes (unknown_target,
// invalid_payload, max_attempts_exceeded, internal) are backend or
// infrastructure faults and are returned as the raw *tentacron.TargetError.
var c2tRejectionCodes = map[string]bool{
	"target_error":      true,
	"target_job_failed": true,
	"target_timeout":    true,
}

// asC2TError maps a TentaCron rejection to the typed error the callers branch
// on: a 404 to ErrRunNotFound (a stale run id - only GetRunStatus checks for
// it), any other 4xx to a BadRequestError carrying City2TABULA's own message.
// A 5xx carries a raw DB error string that must not reach an end user, so it
// stays an opaque *tentacron.TargetError for the caller to log and nothing
// more. Anything that is not a City2TABULA rejection is returned unchanged.
func asC2TError(err error) error {
	te, ok := tentacron.AsTargetError(err)
	if !ok || !c2tRejectionCodes[te.Code] {
		return err
	}
	status, hasStatus := te.UpstreamStatus()
	switch {
	case hasStatus && status == http.StatusNotFound:
		return ErrRunNotFound
	case hasStatus && status >= 400 && status < 500:
		return &BadRequestError{Message: te.UpstreamMessage()}
	default:
		return err
	}
}

// Bbox is a WGS84 (EPSG:4326) lon/lat bounding box - the CRS a user-drawn
// area of interest naturally comes in as (see geo.BBoxFromGeoJSON).
type Bbox struct {
	Xmin, Ymin, Xmax, Ymax float64
}

// Client resolves City2TABULA data through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client that reaches City2TABULA through the given
// TentaCron client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
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
// into whatever envelope block BuEM actually needs. No geometry here -
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
	// Tilt: 0=vertical wall, 90=flat roof - inverted from BuEM's own
	// convention (0=horizontal roof, 90=vertical wall); invert before mapping.
	Tilt *float64 `json:"tilt,omitempty"`
	// IsValid and IsPlanar are City2TABULA extraction diagnostics, not
	// usability flags. IsValid is a 2D-projection ST_IsValid check that is
	// structurally false for near-vertical walls; IsPlanar is false for most
	// LOD2 roof faces. Area and angle are computed regardless, so mapping does
	// not gate on either.
	IsValid  *bool `json:"is_valid,omitempty"`
	IsPlanar *bool `json:"is_planar,omitempty"`
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

// TriggerRun starts a bbox-scoped City2TABULA pipeline run for country and
// returns immediately with the run to poll via GetRunStatus. The c2t-trigger-run
// target is configured no-retry: a run is not idempotent, so callers must treat
// a timeout or transient failure as "may or may not have started" rather than
// re-trigger.
func (c *Client) TriggerRun(ctx context.Context, country string, bbox Bbox) (*Run, error) {
	payload := map[string]any{
		"country": normalizeCountry(country),
		"xmin":    bbox.Xmin, "ymin": bbox.Ymin, "xmax": bbox.Xmax, "ymax": bbox.Ymax,
	}
	var run Run
	if err := c.tc.Do(ctx, targetTriggerRun, payload, &run); err != nil {
		return nil, asC2TError(err)
	}
	return &run, nil
}

// GetRunStatus polls the status of a run started by TriggerRun. A stale run id
// comes back as ErrRunNotFound.
func (c *Client) GetRunStatus(ctx context.Context, runID string) (*Run, error) {
	var run Run
	if err := c.tc.Do(ctx, targetRunStatus, map[string]any{"run_id": runID}, &run); err != nil {
		return nil, asC2TError(err)
	}
	return &run, nil
}

// GetBuildingsByOSMIDs returns 3D attributes for buildings already matched to
// a PyLovo building via building_link. OSMID and MatchType are populated on
// every result, so callers join the response back to their own topology nodes
// by osm_id. An empty match set comes back as JSON null and decodes to a nil
// slice.
func (c *Client) GetBuildingsByOSMIDs(ctx context.Context, country string, osmIDs []string) ([]Building, error) {
	if len(osmIDs) == 0 {
		return nil, nil
	}
	payload := map[string]any{
		"country": normalizeCountry(country),
		"osm_ids": strings.Join(osmIDs, ","),
	}
	var buildings []Building
	if err := c.tc.Do(ctx, targetBuildings, payload, &buildings); err != nil {
		return nil, asC2TError(err)
	}
	return buildings, nil
}
