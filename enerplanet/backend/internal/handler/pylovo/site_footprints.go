package pylovo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/geo"
)

// structureCodes are the City2TABULA function codes of structures that are
// not buildings; they get no grid connection.
var structureCodes = map[string]bool{"51009_1610": true, "53001_1800": true}

// minFootprintSqm is just above pylovo's 25 m2 floor for an added building:
// pylovo measures in EPSG:3035, City2TABULA in the country's own CRS.
const minFootprintSqm = 26

// maxFootprintFetch bounds the 3D buildings fetched for one area. The bbox
// query can return more than the polygon holds, so it sits above the limit.
const maxFootprintFetch = 4 * siteBuildingLimit

// siteCopy is a building pylovo copied from OSM into a new site.
type siteCopy struct {
	BuildingID int    `json:"building_id"`
	OSMID      string `json:"osm_id"`
	FClass     string `json:"f_class"`
}

// addedBuilding is one 3D building sent to pylovo's POST /sites/{id}/buildings.
type addedBuilding struct {
	Geom     json.RawMessage `json:"geom"`
	Source   string          `json:"source"`
	SourceID string          `json:"source_id"`
	FClass   string          `json:"f_class"`
	Floors   *int32          `json:"floors,omitempty"`
}

// footprintPlan turns a site's OSM copies into its 3D buildings: the copies a
// 3D building replaces are excluded, the 3D buildings are added, and the
// copies with no 3D building stay.
type footprintPlan struct {
	exclude []int
	add     []addedBuilding
	kept    int
}

// buildingCount is the number of buildings the site models after the plan.
func (p footprintPlan) buildingCount() int { return len(p.add) + p.kept }

// planFootprints plans a site from its OSM copies and the 3D buildings found
// for them (linked, which carry their OSM ways) and in its area (inArea,
// which do not). footprints holds each 3D building's WGS84 footprint, and
// inSite reports whether a footprint touches the site polygon.
func planFootprints(copies []siteCopy, linked, inArea []city2tabula.Building, footprints map[string]json.RawMessage, inSite func(json.RawMessage) bool) footprintPlan {
	copyByWay := make(map[string]siteCopy, len(copies))
	for _, c := range copies {
		copyByWay[c.OSMID] = c
	}
	var plan footprintPlan
	replaced := map[string]bool{}
	for _, b := range uniqueByObject(linked, inArea) {
		code := ""
		if b.FunctionCode != nil {
			code = *b.FunctionCode
		}
		if structureCodes[code] {
			markWays(replaced, b)
			continue
		}
		footprint, ok := footprints[b.ObjectID]
		if !ok || deref(b.FootprintAreaSqm) < minFootprintSqm || !inSite(footprint) {
			continue
		}
		markWays(replaced, b)
		plan.add = append(plan.add, addedBuilding{
			Geom: footprint, Source: "city2tabula", SourceID: b.ObjectID,
			FClass: osmClass(b, copyByWay), Floors: b.NumberOfStoreys,
		})
	}
	for _, c := range copies {
		if replaced[c.OSMID] {
			plan.exclude = append(plan.exclude, c.BuildingID)
		} else {
			plan.kept++
		}
	}
	return plan
}

// uniqueByObject lists each 3D building once, preferring its linked entry,
// which carries the OSM ways the area query cannot report.
func uniqueByObject(linked, inArea []city2tabula.Building) []city2tabula.Building {
	seen := map[string]bool{}
	var out []city2tabula.Building
	for _, b := range append(append([]city2tabula.Building{}, linked...), inArea...) {
		if b.ObjectID == "" || seen[b.ObjectID] {
			continue
		}
		seen[b.ObjectID] = true
		out = append(out, b)
	}
	return out
}

// markWays records every OSM way linked to the 3D building.
func markWays(ways map[string]bool, b city2tabula.Building) {
	ways[b.OSMID] = true
	for _, w := range b.OSMIDs {
		ways[w] = true
	}
}

// osmClass is the f_class of the 3D building's best linked OSM copy, or
// "yes" (use unknown) when it has none.
func osmClass(b city2tabula.Building, copyByWay map[string]siteCopy) string {
	for _, w := range append([]string{b.OSMID}, b.OSMIDs...) {
		if c, ok := copyByWay[w]; ok && c.FClass != "" {
			return c.FClass
		}
	}
	return "yes"
}

func deref(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

// buildFromFootprints replaces the new site's OSM copies with the 3D buildings
// in area (see planFootprints) and returns the building count and revision.
// It writes nothing when the count is outside 1..siteBuildingLimit.
func (s *SiteHandler) buildFromFootprints(ctx context.Context, siteID int, country string, area json.RawMessage) (int, int, error) {
	copies, err := s.siteCopies(ctx, siteID)
	if err != nil {
		return 0, 0, err
	}
	osmIDs := make([]string, 0, len(copies))
	for _, c := range copies {
		if c.OSMID != "" {
			osmIDs = append(osmIDs, c.OSMID)
		}
	}
	linked, err := s.links.GetBuildingsByOSMIDs(ctx, country, osmIDs)
	if err != nil {
		return 0, 0, fmt.Errorf("City2TABULA lookup for site %d failed: %w", siteID, err)
	}
	xmin, ymin, xmax, ymax, err := geo.BBoxFromGeoJSON(area)
	if err != nil {
		return 0, 0, fmt.Errorf("bbox of site %d: %w", siteID, err)
	}
	inArea, err := s.links.GetBuildingsInBBox(ctx, country, city2tabula.Bbox{Xmin: xmin, Ymin: ymin, Xmax: xmax, Ymax: ymax})
	if err != nil {
		return 0, 0, fmt.Errorf("City2TABULA area query for site %d failed: %w", siteID, err)
	}
	footprints, err := s.footprints(ctx, country, uniqueByObject(linked.Buildings, inArea.Buildings))
	if err != nil {
		return 0, 0, fmt.Errorf("footprints for site %d: %w", siteID, err)
	}
	plan := planFootprints(copies, linked.Buildings, inArea.Buildings, footprints, func(f json.RawMessage) bool { return geo.Touches(area, f) })
	if n := plan.buildingCount(); n == 0 || n > siteBuildingLimit {
		return 0, 0, fmt.Errorf("the area holds %d buildings; a custom grid holds between 1 and %d", n, siteBuildingLimit)
	}
	revision := 1
	if len(plan.exclude) > 0 {
		patches := make([]map[string]any, len(plan.exclude))
		for i, id := range plan.exclude {
			patches[i] = map[string]any{"building_id": id, "overrides": map[string]any{"excluded": true}}
		}
		if revision, err = s.siteWrite(ctx, http.MethodPatch, siteID, patches, http.StatusOK); err != nil {
			return 0, 0, err
		}
	}
	if len(plan.add) > 0 {
		if revision, err = s.siteWrite(ctx, http.MethodPost, siteID, plan.add, http.StatusCreated); err != nil {
			return 0, 0, err
		}
	}
	return plan.buildingCount(), revision, nil
}

// siteCopies lists the buildings pylovo copied from OSM into the site.
func (s *SiteHandler) siteCopies(ctx context.Context, siteID int) ([]siteCopy, error) {
	body, status, err := forwardPylovoRequest(ctx, s.pylovo.resolveBaseURL(), http.MethodGet, fmt.Sprintf("/sites/%d/buildings", siteID), nil)
	if err != nil || status != http.StatusOK {
		return nil, fmt.Errorf("listing buildings of site %d failed (status %d): %v", siteID, status, err)
	}
	var list struct {
		Features []struct {
			Properties siteCopy `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("unreadable buildings of site %d: %w", siteID, err)
	}
	copies := make([]siteCopy, len(list.Features))
	for i, f := range list.Features {
		copies[i] = f.Properties
	}
	return copies, nil
}

// footprints fetches the WGS84 footprints of the 3D buildings, keyed by
// object id.
func (s *SiteHandler) footprints(ctx context.Context, country string, buildings []city2tabula.Building) (map[string]json.RawMessage, error) {
	if len(buildings) > maxFootprintFetch {
		return nil, fmt.Errorf("the area holds %d 3D buildings; draw a smaller area (at most %d)", len(buildings), maxFootprintFetch)
	}
	ids := make([]string, len(buildings))
	for i, b := range buildings {
		ids[i] = b.ObjectID
	}
	result, err := s.links.GetFootprintsWGS84(ctx, country, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, len(result.Buildings))
	for _, g := range result.Buildings {
		if len(g.FootprintGeoJSON) > 0 {
			out[g.ObjectID] = g.FootprintGeoJSON
		}
	}
	return out, nil
}

// siteWrite sends payload to the site's buildings and returns the new revision.
func (s *SiteHandler) siteWrite(ctx context.Context, method string, siteID int, payload any, want int) (int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("encoding %s buildings of site %d: %w", method, siteID, err)
	}
	body, status, err := forwardPylovoRequest(ctx, s.pylovo.resolveBaseURL(), method, fmt.Sprintf("/sites/%d/buildings", siteID), data)
	if err != nil || status != want {
		return 0, fmt.Errorf("%s buildings of site %d failed (status %d): %v %s", method, siteID, status, err, body)
	}
	var written struct {
		Revision int `json:"revision"`
	}
	if err := json.Unmarshal(body, &written); err != nil {
		return 0, fmt.Errorf("unreadable revision of site %d: %w", siteID, err)
	}
	return written.Revision, nil
}

// keyBuildings3D gives every 3D building in a site grid its object key in the
// osm_id slot, where pylovo has null (see city2tabula.ObjectKey).
func keyBuildings3D(grid []byte) (json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(grid))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return nil, err
	}
	buildings, _ := doc["buildings"].(map[string]any)
	features, _ := buildings["features"].([]any)
	for _, f := range features {
		feature, _ := f.(map[string]any)
		props, _ := feature["properties"].(map[string]any)
		if id, ok := props["source_id"].(string); ok && props["source"] == "city2tabula" {
			props["osm_id"] = city2tabula.ObjectKey(id)
		}
	}
	return json.Marshal(doc)
}
