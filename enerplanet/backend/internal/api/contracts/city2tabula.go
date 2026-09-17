package contracts

import (
	"encoding/json"

	"spatialhub_backend/internal/city2tabula"
)

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
//
// country selects City2TABULA's per-country database. Omit it and the bbox
// centroid decides, which is what a caller that has only drawn an area should
// do: the canonical spelling is the backend's, and a reverse geocode answers in
// whatever language it pleases.
type EnrichRequest struct {
	Country string     `json:"country,omitempty" example:"germany"`
	Bbox    EnrichBbox `json:"bbox"`
	OSMIDs  []string   `json:"osm_ids" example:"240054621,240054622"`
}

// HeatAvailabilityResponse is returned by GET /api/v1/heat/availability.
//
// Modelling an area needs 3D buildings matched to PyLovo grid buildings. The
// match itself is the authority: two datasets covering the same ground does
// not mean the link step has run over them, and until it has, nothing there
// resolves. Status is a stable code for the interface to map to its own
// wording, and each value carries a different next step:
//
//   - ready:    matched buildings exist here, so demand modelling works now
//   - linkable: both datasets present but nothing matched yet, so the area is
//     one City2TABULA link run away from ready
//   - partial:  one of the two datasets is missing, which needs data rather
//     than a pipeline run; Has3DData and HasGrid say which
//
// An area City2TABULA cannot answer for, such as a country it holds no data
// for at all, is a 502 rather than a status. "Nothing is covered here" and
// "the service could not say" are different answers, and only the first is
// safe to draw on a map.
type HeatAvailabilityResponse struct {
	Status    string `json:"status" example:"linkable"`
	Available bool   `json:"available" example:"false"`
	// LinkedBuildings is City2TABULA's coverage count for the area, above zero
	// exactly when Status is ready. It counts attempted matches rather than
	// successful ones, so both it and a ready status overstate coverage until
	// City2TABULA excludes the rows where 3D and OSM failed to pair.
	LinkedBuildings int `json:"linked_buildings" example:"0"`
	// Has3DData is true when City2TABULA holds LOD2 buildings here at all,
	// matched or not.
	Has3DData bool `json:"has_3d_data" example:"true"`
	// HasGrid is true when PyLovo reports generated grids for a region covering
	// this area. Status does not imply it: City2TABULA links 3D buildings to
	// PyLovo's input buildings (res/oth), never to generated grids, so an area
	// can be ready with HasGrid false. Demand modelling needs only the link; a
	// node-based caller needs HasGrid too, since nodes are transformer areas.
	HasGrid bool `json:"has_grid" example:"false"`
	// GridRegions names the PyLovo regions whose extent overlaps the area, as
	// "<country_code>/<state_code>". Empty when HasGrid is false.
	GridRegions []string `json:"grid_regions,omitempty" example:"DE/bremen"`
}

// AreaEnrichRequest is the POST /api/v1/city2tabula/enrich/area body. Unlike
// EnrichRequest it carries no osm_ids: the area itself selects the buildings.
type AreaEnrichRequest struct {
	Country string     `json:"country" example:"netherlands"`
	Bbox    EnrichBbox `json:"bbox"`
}

// AreaBuilding is one building in an area response, keyed by its City2TABULA
// object_id rather than an osm_id.
//
// FootprintGeoJSON is in the country's own storage CRS, not WGS84, because
// City2TABULA serves geometry without reprojecting. The GeoJSON names its CRS
// in a "crs" member; a map consumer must reproject before drawing.
type AreaBuilding struct {
	EnrichedBuilding
	FootprintGeoJSON json.RawMessage `json:"footprint_geojson,omitempty"`
}

// AreaEnrichResponse is returned by the area enrich endpoint.
//
// Data is keyed by object_id. City2TABULA's area query cannot report the
// PyLovo link, so every entry has an empty match_type and there is no osm_id
// to join on: this answers "what 3D data is here" for drawing, not "which
// buildings can be modelled". Use the osm_ids endpoint for the latter.
type AreaEnrichResponse struct {
	Total        int                     `json:"total" example:"249"`
	WithGeometry int                     `json:"with_geometry" example:"249"`
	Data         map[string]AreaBuilding `json:"data"`
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
	ObjectID          string  `json:"object_id" example:"DEBW_1"`
	MatchType         int16   `json:"match_type" example:"1"`
	TabulaVariantCode *string `json:"tabula_variant_code,omitempty" example:"DE.N.SFH.05.Gen.ReEx.001.001"`
	// Derived from the TABULA variant's construction-period range (ignis
	// Year1_Building/Year2_Building); set only when TabulaVariantCode
	// resolved and ignis had year data for it. A user-entered construction
	// year, once saved, takes precedence over this estimate.
	DefaultConstructionYear *int     `json:"default_construction_year,omitempty" example:"1963"`
	Buem                    BuemNode `json:"buem"`
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
