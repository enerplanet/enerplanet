package pylovo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"spatialhub_backend/internal/city2tabula"
)

type fixedCountry string

func (f fixedCountry) Resolve(context.Context, json.RawMessage) (string, error) {
	return string(f), nil
}

// fake3D answers as City2TABULA does: ways maps a requested OSM way to the 3D
// building linked to it (with all its ways), area lists the 3D buildings the
// bbox holds (without ways), and every footprint lies inside siteBody.
type fake3D struct {
	ways map[string]city2tabula.Building
	area []city2tabula.Building
}

func (f fake3D) GetBuildingsByOSMIDs(_ context.Context, _ string, ids []string) (city2tabula.BuildingsResult, error) {
	var res city2tabula.BuildingsResult
	for _, id := range ids {
		if b, ok := f.ways[id]; ok && b.OSMID == id {
			res.Buildings = append(res.Buildings, b)
		}
	}
	return res, nil
}

func (f fake3D) GetBuildingsInBBox(context.Context, string, city2tabula.Bbox) (city2tabula.BuildingsResult, error) {
	return city2tabula.BuildingsResult{Buildings: f.area}, nil
}

func (f fake3D) GetFootprintsWGS84(_ context.Context, _ string, ids []string) (city2tabula.GeometryResult, error) {
	var res city2tabula.GeometryResult
	for _, id := range ids {
		res.Buildings = append(res.Buildings, city2tabula.BuildingGeometry{
			ObjectID:         id,
			FootprintGeoJSON: json.RawMessage(`{"type":"Polygon","coordinates":[[[13.05,48.01],[13.06,48.01],[13.06,48.02],[13.05,48.01]]]}`),
		})
	}
	return res, nil
}

// fakeSiteModels reports the saved models using each site, by site id.
type fakeSiteModels map[int][]string

func (f fakeSiteModels) ModelsUsingSite(siteID int) ([]string, error) {
	return f[siteID], nil
}

// fakeSitePylovo serves one site, 7, owned by "owner", holding osmIDs, and
// records each request as "METHOD path body".
type fakeSitePylovo struct {
	mu       sync.Mutex
	osmIDs   []string
	requests []string
}

func (f *fakeSitePylovo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, fmt.Sprintf("%s %s %s", r.Method, r.URL.Path, body))
	f.mu.Unlock()
	switch r.Method + " " + r.URL.Path {
	case "POST /sites":
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"site_id":7,"revision":1,"building_count":%d,"transformer_count":0}`, len(f.osmIDs))
	case "GET /sites/7":
		fmt.Fprint(w, `{"site_id":7,"user_id":"owner","revision":1}`)
	case "GET /sites/7/buildings":
		var features []string
		for i, id := range f.osmIDs {
			features = append(features, fmt.Sprintf(`{"properties":{"building_id":%d,"osm_id":%q,"f_class":"house"}}`, i+1, id))
		}
		fmt.Fprintf(w, `{"features":[%s]}`, strings.Join(features, ","))
	case "PATCH /sites/7/buildings":
		fmt.Fprint(w, `{"revision":2}`)
	case "POST /sites/7/buildings":
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"revision":3,"buildings":[]}`)
	case "GET /sites/7/grid":
		fmt.Fprint(w, `{"buildings":{"features":[`+
			`{"properties":{"building_id":12345678901,"osm_id":null,"source":"city2tabula","source_id":"DEBY_LOD2_1"}},`+
			`{"properties":{"building_id":2,"osm_id":"1001832418","source":"osm","source_id":null}}]}}`)
	case "DELETE /sites/7":
		w.WriteHeader(http.StatusNoContent)
	case "PUT /sites/7/transformers":
		fmt.Fprintf(w, `{"revision":3,"transformers":%s}`, body)
	case "POST /sites/7/generate":
		w.WriteHeader(http.StatusConflict)
		fmt.Fprint(w, `{"detail":"Site 7 has an active generation job 3"}`)
	default:
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"detail":"not found"}`)
	}
}

func (f *fakeSitePylovo) sent(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, r := range f.requests {
		if strings.HasPrefix(r, prefix) {
			out = append(out, r)
		}
	}
	return out
}

func serveSite(t *testing.T, fake *fakeSitePylovo, linked buildings3D, user, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return serveSiteUsedBy(t, fake, linked, nil, user, method, path, body)
}

// serveSiteUsedBy serves one request, with models naming the saved models that use each site.
func serveSiteUsedBy(t *testing.T, fake *fakeSitePylovo, linked buildings3D, models fakeSiteModels, user, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	pylovo := httptest.NewServer(fake)
	t.Cleanup(pylovo.Close)

	h := NewPylovoHandler(pylovo.URL, nil, nil)
	sites := NewSiteHandler(h, fixedCountry("germany"), linked, models)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", user) })
	r.POST("/sites", sites.CreateSite)
	r.POST("/sites/:id/generate", sites.GenerateSite)
	r.GET("/sites/:id/grid", sites.GetSiteGrid)
	r.PUT("/sites/:id/transformers", sites.PutSiteTransformers)
	r.DELETE("/sites/:id", sites.DeleteSite)
	r.POST("/power-flow", h.RunPowerFlow)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

const siteBody = `{"name":"THD","geom":{"type":"Polygon","coordinates":[[[13,48],[13.1,48],[13.1,48.1],[13,48]]]}}`

// A new site's buildings are its 3D buildings: the OSM copies they cover are
// excluded, each 3D building is added with the class of its OSM way, and an
// outline with no 3D building stays.
func TestCreateSite_buildsFromFootprints(t *testing.T) {
	area := 80.0
	row := city2tabula.Building{ObjectID: "A", OSMID: "w1", OSMIDs: []string{"w1", "w2"}, FootprintAreaSqm: &area}
	alone := city2tabula.Building{ObjectID: "B", FootprintAreaSqm: &area}
	fake := &fakeSitePylovo{osmIDs: []string{"w1", "w2", "w3"}}
	rec := serveSite(t, fake, fake3D{ways: map[string]city2tabula.Building{"w1": row}, area: []city2tabula.Building{alone}}, "owner", http.MethodPost, "/sites", siteBody)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body)
	}
	if create := fake.sent("POST /sites "); len(create) != 1 || !strings.Contains(create[0], `"country_code":"DE"`) || !strings.Contains(create[0], `"user_id":"owner"`) {
		t.Errorf("create request = %v, want country_code DE and the caller as user_id", create)
	}
	patch := fake.sent("PATCH /sites/7/buildings")
	if len(patch) != 1 || !strings.Contains(patch[0], `"building_id":1,`) || !strings.Contains(patch[0], `"building_id":2,`) || strings.Contains(patch[0], `"building_id":3,`) {
		t.Errorf("patch = %v, want buildings 1 and 2 excluded", patch)
	}
	add := fake.sent("POST /sites/7/buildings")
	if len(add) != 1 || !strings.Contains(add[0], `"source_id":"A","f_class":"house"`) || !strings.Contains(add[0], `"source_id":"B","f_class":"yes"`) {
		t.Errorf("add = %v, want A with its way's class and B as yes", add)
	}
	var resp struct {
		Data struct {
			BuildingCount int `json:"building_count"`
			Revision      int `json:"revision"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.BuildingCount != 3 || resp.Data.Revision != 3 {
		t.Errorf("data = %+v, want building_count 3 and revision 3", resp.Data)
	}
}

// The grid names each 3D building by its object key, where pylovo has no OSM id.
func TestGetSiteGrid_keysBuildings3D(t *testing.T) {
	fake := &fakeSitePylovo{}
	rec := serveSite(t, fake, nil, "owner", http.MethodGet, "/sites/7/grid", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"osm_id":"c2t:DEBY_LOD2_1"`) || !strings.Contains(body, `"osm_id":"1001832418"`) || !strings.Contains(body, `"building_id":12345678901`) {
		t.Errorf("grid = %s, want the 3D building keyed c2t:DEBY_LOD2_1, the OSM one unchanged, numbers intact", body)
	}
}

// An area over the limit is refused, and the site pylovo already made is deleted.
func TestCreateSite_overLimitIsRefusedAndDeleted(t *testing.T) {
	ids := make([]string, siteBuildingLimit+1)
	for i := range ids {
		ids[i] = fmt.Sprintf("w%d", i)
	}
	fake := &fakeSitePylovo{osmIDs: ids}
	rec := serveSite(t, fake, fake3D{}, "owner", http.MethodPost, "/sites", siteBody)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422: %s", rec.Code, rec.Body)
	}
	if len(fake.sent("DELETE /sites/7")) != 1 {
		t.Errorf("requests = %v, want the site deleted", fake.requests)
	}
}

// pylovo does not authenticate, so another user's site id must read as absent
// and nothing may be forwarded for it.
func TestSiteRoutes_otherUsersSiteIsNotFound(t *testing.T) {
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/sites/7/grid", ""},
		{http.MethodPost, "/sites/7/generate", ""},
		{http.MethodPost, "/power-flow", `{"site_id":7,"revision":1,"kcid":1,"bcid":1}`},
		{http.MethodPut, "/sites/7/transformers", `[]`},
	} {
		fake := &fakeSitePylovo{}
		rec := serveSite(t, fake, nil, "intruder", tc.method, tc.path, tc.body)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404", tc.method, tc.path, rec.Code)
		}
		if len(fake.requests) != 1 || fake.requests[0] != "GET /sites/7 " {
			t.Errorf("%s %s: pylovo requests = %q, want only the owner lookup", tc.method, tc.path, fake.requests)
		}
	}
}

// A pylovo 409 (generation already running) reaches the client as a 409.
func TestGenerateSite_conflictPassesThrough(t *testing.T) {
	rec := serveSite(t, &fakeSitePylovo{}, nil, "owner", http.MethodPost, "/sites/7/generate", "")

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "active generation job 3") {
		t.Fatalf("status = %d body = %s, want 409 with pylovo's detail", rec.Code, rec.Body)
	}
}

// The owner's station list reaches pylovo unchanged, and pylovo's answer comes back in the envelope.
func TestPutSiteTransformers_forwardsStationsForTheOwner(t *testing.T) {
	stations := `[{"transformer_id":null,"geom":{"type":"Point","coordinates":[12.89,48.81]},"rated_kva":400,"cost_eur":null,"assigned_building_ids":[3]}]`
	fake := &fakeSitePylovo{}
	rec := serveSite(t, fake, nil, "owner", http.MethodPut, "/sites/7/transformers", stations)

	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"revision":3`) {
		t.Fatalf("status = %d body = %s, want 200 with pylovo's revision", rec.Code, rec.Body)
	}
	if put := fake.sent("PUT /sites/7/transformers "); len(put) != 1 || !strings.HasSuffix(put[0], stations) {
		t.Errorf("forwarded = %v, want the station list unchanged", put)
	}
}

// A body that is not a station list is refused before anything reaches pylovo.
func TestPutSiteTransformers_rejectsNonArray(t *testing.T) {
	fake := &fakeSitePylovo{}
	rec := serveSite(t, fake, nil, "owner", http.MethodPut, "/sites/7/transformers", `{"rated_kva":400}`)

	if rec.Code != http.StatusBadRequest || len(fake.requests) != 0 {
		t.Fatalf("status = %d, pylovo requests = %v; want 400 and none", rec.Code, fake.requests)
	}
}

// A 3D building is sent to pylovo by its object id, which pylovo matches as
// the site building's source_id; OSM ids pass unchanged.
func TestSiteScopedRequest_sends3DBuildingsByObjectID(t *testing.T) {
	fake := &fakeSitePylovo{}
	serveSite(t, fake, nil, "owner", http.MethodPost, "/power-flow",
		`{"site_id":7,"revision":1,"grid_result_id":1,"building_osm_ids":["c2t:DEBY_LOD2_7672149","1001832418"]}`)

	sent := fake.sent("POST /power-flow")
	if len(sent) != 1 || !strings.Contains(sent[0], `"building_osm_ids":["DEBY_LOD2_7672149","1001832418"]`) {
		t.Fatalf("pylovo got %v; want the object id without its c2t: prefix and the OSM id unchanged", sent)
	}
}

// A site a saved model still uses is not deleted: the models are named and
// pylovo never receives the delete.
func TestDeleteSite_refusedWhileAModelUsesIt(t *testing.T) {
	fake := &fakeSitePylovo{}
	rec := serveSiteUsedBy(t, fake, nil, fakeSiteModels{7: {"THD 2014 I-L"}}, "owner", http.MethodDelete, "/sites/7", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "THD 2014 I-L") {
		t.Errorf("body does not name the model: %s", rec.Body)
	}
	if got := fake.sent("DELETE"); len(got) != 0 {
		t.Errorf("pylovo received %q, want no delete", got)
	}
}

// A site no saved model uses is deleted in pylovo.
func TestDeleteSite_deletesAnUnusedSite(t *testing.T) {
	fake := &fakeSitePylovo{}
	rec := serveSiteUsedBy(t, fake, nil, fakeSiteModels{}, "owner", http.MethodDelete, "/sites/7", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body %s", rec.Code, rec.Body)
	}
	if got := fake.sent("DELETE /sites/7"); len(got) != 1 {
		t.Errorf("pylovo delete requests = %q, want one", got)
	}
}
