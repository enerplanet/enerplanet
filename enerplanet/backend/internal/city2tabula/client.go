// Package city2tabula resolves bbox-scoped 3D building data from City2TABULA's
// on-request wrapper (THD-Spatial-AI/city2tabula, cmd/server), reached through
// the TentaCron orchestrator - the backend makes no direct City2TABULA call.
// Used by the run_buem job and the enrich handler (internal/handler/city2tabula).
package city2tabula

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
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
	targetCoverage   = "c2t-coverage"
	targetGeometry   = "c2t-geometry"
	targetSurfaces   = "c2t-surfaces"
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
//
// One City2TABULA failure reaches callers by both routes: a retryable 5xx that
// exhausts the target's attempt cap arrives as max_attempts_exceeded, not
// target_error, so the same upstream fault is typed or raw depending only on
// whether a retry was left. Branch on the error, never on the code alone.
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
	RunStage
}

// RunStage is the pipeline step a run is in: import, extract_features or
// link_buildings, numbered 1 to 3. It is empty while the run is pending.
type RunStage struct {
	Stage      string `json:"stage,omitempty" example:"extract_features"`
	StageLabel string `json:"stage_label,omitempty" example:"Extracting building features"`
	StageIndex int    `json:"stage_index,omitempty" example:"2"`
	StageCount int    `json:"stage_count,omitempty" example:"3"`
}

// Building is one LOD2 building's thematic (non-geometric) 3D attributes, as
// City2TABULA's GET /api/v1/buildings returns them. Callers reshape these
// into whatever envelope block BuEM actually needs. No geometry here -
// City2TABULA serves that separately (GET /api/v1/geometry) for consumers
// that actually need to render it; nothing here does.
type Building struct {
	ObjectID  string `json:"object_id"`
	DatasetID string `json:"dataset_id"`
	OSMID     string `json:"osm_id"`
	// OSMIDs lists every OSM way linked to this 3D building, OSMID first
	// (City2TABULA 0.11.2 and later). A building appears once even when
	// several of the requested ways belong to it.
	OSMIDs    []string `json:"osm_ids,omitempty"`
	MatchType int16    `json:"match_type"`
	// FunctionCode is the source building's CityGML function, such as the
	// ALKIS code 31001_1000; null where the dataset has none (City2TABULA
	// 0.11.3 and later).
	FunctionCode      *string   `json:"function_code,omitempty"`
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

// ByRequestedWay groups the result's buildings under the requested way that
// stands for each: its best way when that was requested, otherwise its first
// requested way (OSMIDs lists the best way first). One way can stand for
// several 3D buildings, a terraced row mapped as one OSM outline; they are
// listed largest first (see Larger). Every other requested way of a building
// is a further way and maps to the way standing for it; its building is
// reported once, under the standing way.
func (r BuildingsResult) ByRequestedWay(requested []string) (map[string][]Building, map[string]string) {
	want := make(map[string]bool, len(requested))
	for _, id := range requested {
		want[id] = true
	}
	byWay := map[string][]Building{}
	further := map[string]string{}
	for _, b := range r.Buildings {
		ways := b.OSMIDs
		if len(ways) == 0 && b.OSMID != "" {
			ways = []string{b.OSMID} // a server before 0.11.2 sends no osm_ids
		}
		standing := ""
		for _, w := range ways {
			if want[w] {
				standing = w
				break
			}
		}
		if standing == "" {
			continue
		}
		byWay[standing] = append(byWay[standing], b)
		for _, w := range ways {
			if w != standing && want[w] {
				further[w] = standing
			}
		}
	}
	for w, buildings := range byWay {
		slices.SortStableFunc(buildings, func(a, b Building) int {
			switch {
			case Larger(a, b):
				return -1
			case Larger(b, a):
				return 1
			}
			return strings.Compare(a.ObjectID, b.ObjectID)
		})
		// A way covering several 3D buildings can stand for one and be further
		// on another; it keeps its own buildings' data.
		delete(further, w)
	}
	return byWay, further
}

// Larger reports whether a is the larger building by floor area, then by
// footprint; the largest building of a way is the one the configurator shows.
func Larger(a, b Building) bool {
	if fa, fb := deref(a.FloorAreaSqm), deref(b.FloorAreaSqm); fa != fb {
		return fa > fb
	}
	return deref(a.FootprintAreaSqm) > deref(b.FootprintAreaSqm)
}

func deref(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

// DatasetCredit is one source dataset's attribution as City2TABULA returns it
// next to the data derived from it. Callers pass it on unchanged.
type DatasetCredit struct {
	DatasetID  string `json:"dataset_id"`
	Provider   string `json:"provider"`
	Dataset    string `json:"dataset"`
	Licence    string `json:"licence"`
	LicenceURL string `json:"licence_url"`
	Credit     string `json:"credit"`
	CreditURL  string `json:"credit_url,omitempty"`
	TermsURL   string `json:"terms_url,omitempty"`
	Changes    string `json:"changes"`
}

// BuildingsResult is GET /api/v1/buildings: the buildings and the credit of
// every dataset they come from, TABULA's included when any building carries a
// TABULA type.
type BuildingsResult struct {
	Buildings    []Building      `json:"buildings"`
	Attributions []DatasetCredit `json:"attributions"`
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
	// IsPartyWall marks a wall piece City2TABULA found shared with a
	// neighbouring building (City2TABULA v0.9.0 and later).
	IsPartyWall *bool `json:"is_party_wall,omitempty"`
	// AreaBelowPrecision is true when the area rounds to 0.00 m2, as for the
	// sliver faces where walls meet. City2TABULA documents that such a surface
	// must not be used as a thermal area (v0.9.0 and later).
	AreaBelowPrecision *bool `json:"area_below_precision,omitempty"`
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
// by osm_id.
//
// A key made by ObjectKey is looked up by object id (City2TABULA 0.11.4 and
// later) and its building comes back with that key as OSMID and only OSMID,
// so ByRequestedWay files it under the key.
func (c *Client) GetBuildingsByOSMIDs(ctx context.Context, country string, osmIDs []string) (BuildingsResult, error) {
	var ways, objects []string
	for _, key := range osmIDs {
		if id, ok := ObjectIDOfKey(key); ok {
			objects = append(objects, id)
		} else {
			ways = append(ways, key)
		}
	}
	result, err := c.getBuildings(ctx, country, "osm_ids", ways)
	if err != nil {
		return BuildingsResult{}, err
	}
	byObject, err := c.getBuildings(ctx, country, "object_ids", objects)
	if err != nil {
		return BuildingsResult{}, err
	}
	for _, b := range byObject.Buildings {
		key := ObjectKey(b.ObjectID)
		b.OSMID, b.OSMIDs = key, []string{key}
		result.Buildings = append(result.Buildings, b)
	}
	for _, credit := range byObject.Attributions {
		if !slices.Contains(result.Attributions, credit) {
			result.Attributions = append(result.Attributions, credit)
		}
	}
	return result, nil
}

// getBuildings asks GET /api/v1/buildings for ids in the given mode
// (osm_ids or object_ids); no ids sends no request.
func (c *Client) getBuildings(ctx context.Context, country, mode string, ids []string) (BuildingsResult, error) {
	if len(ids) == 0 {
		return BuildingsResult{}, nil
	}
	payload := map[string]any{
		"country": normalizeCountry(country),
		mode:      strings.Join(ids, ","),
	}
	var result BuildingsResult
	if err := c.tc.Do(ctx, targetBuildings, payload, &result); err != nil {
		return BuildingsResult{}, asC2TError(err)
	}
	return result, nil
}

// GetCoverage returns City2TABULA's coverage count for bbox. Unlike
// GetBuildingsByOSMIDs it needs no osm_ids, which is what lets a caller ask
// about an area before it has any building list for it.
//
// The count is every building_link row, including those recording a failed
// pairing: match_type 2, a 3D building with no OSM match, and 3, an OSM
// building with no 3D one. Neither is modellable, and 724 of the 3106 Dutch
// rows are match_type 2. The count therefore overstates coverage, and an area
// where nothing paired still returns non-zero. The filter belongs in
// City2TABULA's own query, since the count arrives here already summed.
func (c *Client) GetCoverage(ctx context.Context, country string, bbox Bbox) (int, error) {
	payload := map[string]any{
		"country": normalizeCountry(country),
		"xmin":    bbox.Xmin, "ymin": bbox.Ymin, "xmax": bbox.Xmax, "ymax": bbox.Ymax,
	}
	var body struct {
		Count int `json:"count"`
	}
	if err := c.tc.Do(ctx, targetCoverage, payload, &body); err != nil {
		return 0, asC2TError(err)
	}
	return body.Count, nil
}

// GetBuildingsInBBox returns every LOD2 building City2TABULA holds inside
// bbox, whether or not it is linked to a PyLovo building. City2TABULA's
// bbox query cannot report the link, so OSMID is empty and MatchType is 0 on
// every result: callers that need the PyLovo identity must use
// GetBuildingsByOSMIDs instead.
//
// Read with GetCoverage the count separates "no 3D data here" from "3D data
// here that the link step has not been run over".
func (c *Client) GetBuildingsInBBox(ctx context.Context, country string, bbox Bbox) (BuildingsResult, error) {
	payload := map[string]any{
		"country": normalizeCountry(country),
		"xmin":    bbox.Xmin, "ymin": bbox.Ymin, "xmax": bbox.Xmax, "ymax": bbox.Ymax,
	}
	var result BuildingsResult
	if err := c.tc.Do(ctx, targetBuildings, payload, &result); err != nil {
		return BuildingsResult{}, asC2TError(err)
	}
	return result, nil
}

// SurfaceGeometry is one envelope surface's polygon, keyed by the same surface
// id the buildings endpoint returns, so a caller can match a rendered face to
// the element it configures.
//
// GeoJSON stays raw for the same reason FootprintGeoJSON does: it passes
// through byte exact, so a consumer that wants the "crs" member still gets it.
// Coordinates are [x, y, z] in the country's own storage CRS and rings are
// closed.
type SurfaceGeometry struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	GeoJSON json.RawMessage `json:"geojson,omitempty"`
}

// BuildingGeometry is one building's footprint, as City2TABULA's
// GET /api/v1/geometry returns it.
//
// FootprintGeoJSON is in the country's own storage CRS, not WGS84 -
// EPSG:28992 for the Netherlands, 25832 for Germany - because City2TABULA
// serves the geometry without reprojecting. The GeoJSON names its CRS in a
// "crs" member, so a consumer can reproject; nothing here does it for them.
//
// Surfaces is populated only by GetSurfaceGeometryByObjectIDs. City2TABULA
// omits the key for a building with no surface rows, so absent and empty are
// the same case.
type BuildingGeometry struct {
	ObjectID         string            `json:"object_id"`
	DatasetID        string            `json:"dataset_id"`
	FootprintGeoJSON json.RawMessage   `json:"footprint_geojson,omitempty"`
	Surfaces         []SurfaceGeometry `json:"surfaces,omitempty"`
}

// GeometryResult is GET /api/v1/geometry: the geometries and the credit of
// every dataset they come from. It never carries TABULA's credit.
type GeometryResult struct {
	Buildings    []BuildingGeometry `json:"buildings"`
	Attributions []DatasetCredit    `json:"attributions"`
}

// GetGeometryByObjectIDs returns footprints for the given building object ids.
// Buildings carry no geometry in the other responses, so this is the only way
// to place them on a map.
func (c *Client) GetGeometryByObjectIDs(ctx context.Context, country string, objectIDs []string) (GeometryResult, error) {
	return c.getGeometry(ctx, country, objectIDs, nil)
}

// GetFootprintsWGS84 returns footprints for the given object ids reprojected
// to EPSG:4326 in 2D, for consumers whose API takes WGS84.
func (c *Client) GetFootprintsWGS84(ctx context.Context, country string, objectIDs []string) (GeometryResult, error) {
	return c.getGeometry(ctx, country, objectIDs, map[string]any{"srid": "4326"})
}

// GetSurfaceGeometryByObjectIDs returns footprints and every envelope surface
// polygon, for rendering a building rather than placing it.
//
// Ask for this one building at a time. A building's face count is unbounded and
// TentaCron fails a job whole when a response exceeds upstream.max_response_bytes,
// so an area would fail on its largest buildings with nothing in the request
// predicting which those are.
func (c *Client) GetSurfaceGeometryByObjectIDs(ctx context.Context, country string, objectIDs []string) (GeometryResult, error) {
	return c.getGeometry(ctx, country, objectIDs, map[string]any{"include": "surfaces"})
}

// GetSurfaceGeometryWGS84 is GetSurfaceGeometryByObjectIDs reprojected to
// EPSG:4326, for drawing on a web map. Surfaces keep their z, the height above
// sea level; the footprint is 2D. Ask for one building at a time, as above.
func (c *Client) GetSurfaceGeometryWGS84(ctx context.Context, country string, objectIDs []string) (GeometryResult, error) {
	return c.getGeometry(ctx, country, objectIDs, map[string]any{"include": "surfaces", "srid": "4326"})
}

// getGeometry backs every variant. Unconsumed payload fields reach City2TABULA
// as query parameters, so the options in extra travel without any target
// configuration.
func (c *Client) getGeometry(ctx context.Context, country string, objectIDs []string, extra map[string]any) (GeometryResult, error) {
	if len(objectIDs) == 0 {
		return GeometryResult{}, nil
	}
	payload := map[string]any{
		"country":    normalizeCountry(country),
		"object_ids": strings.Join(objectIDs, ","),
	}
	for k, v := range extra {
		payload[k] = v
	}
	var result GeometryResult
	if err := c.tc.Do(ctx, targetGeometry, payload, &result); err != nil {
		return GeometryResult{}, asC2TError(err)
	}
	return result, nil
}

// SurfacesBuilding is one building of a surfaces page: its LoD2 roofs and
// walls in WGS84, and the OSM ways linked to it, best match first.
type SurfacesBuilding struct {
	ObjectID string         `json:"object_id"`
	OSMIDs   []string       `json:"osm_ids"`
	Surfaces []WGS84Surface `json:"surfaces"`
}

// WGS84Surface is a roof or wall polygon in EPSG:4326 with z in metres above
// sea level. ID is the surface id GET /api/v1/geometry and stored PV arrays use.
type WGS84Surface struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Geometry json.RawMessage `json:"geometry" swaggertype:"object"`
}

// SurfacesPage is one page of GET /api/v1/surfaces. NextCursor is nil on the
// last page.
type SurfacesPage struct {
	Buildings    []SurfacesBuilding `json:"buildings"`
	Attributions []DatasetCredit    `json:"attributions"`
	NextCursor   *string            `json:"next_cursor"`
}

// GetSurfacesInBBox returns one page of the LoD2 roofs and walls of every
// building whose footprint intersects bbox (WGS84). Pass the previous page's
// NextCursor as cursor, "" for the first page.
func (c *Client) GetSurfacesInBBox(ctx context.Context, country string, bbox Bbox, cursor string) (SurfacesPage, error) {
	payload := map[string]any{
		"country": normalizeCountry(country),
		"xmin":    bbox.Xmin, "ymin": bbox.Ymin, "xmax": bbox.Xmax, "ymax": bbox.Ymax,
	}
	if cursor != "" {
		payload["cursor"] = cursor
	}
	var page SurfacesPage
	if err := c.tc.Do(ctx, targetSurfaces, payload, &page); err != nil {
		return SurfacesPage{}, asC2TError(err)
	}
	return page, nil
}
