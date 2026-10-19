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

type linkedOSMIDs []string

func (l linkedOSMIDs) GetBuildingsByOSMIDs(_ context.Context, _ string, ids []string) (city2tabula.BuildingsResult, error) {
	var res city2tabula.BuildingsResult
	for _, id := range ids {
		for _, linked := range l {
			if id == linked {
				res.Buildings = append(res.Buildings, city2tabula.Building{OSMID: id})
			}
		}
	}
	return res, nil
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
			features = append(features, fmt.Sprintf(`{"properties":{"building_id":%d,"osm_id":%q}}`, i+1, id))
		}
		fmt.Fprintf(w, `{"features":[%s]}`, strings.Join(features, ","))
	case "PATCH /sites/7/buildings":
		fmt.Fprint(w, `{"revision":2}`)
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

func serveSite(t *testing.T, fake *fakeSitePylovo, linked linkedOSMIDs, user, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	pylovo := httptest.NewServer(fake)
	t.Cleanup(pylovo.Close)

	h := NewPylovoHandler(pylovo.URL, nil, nil)
	sites := NewSiteHandler(h, fixedCountry("germany"), linked)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", user) })
	r.POST("/sites", sites.CreateSite)
	r.POST("/sites/:id/generate", sites.GenerateSite)
	r.GET("/sites/:id/grid", sites.GetSiteGrid)
	r.PUT("/sites/:id/transformers", sites.PutSiteTransformers)
	r.POST("/power-flow", h.RunPowerFlow)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

const siteBody = `{"name":"THD","geom":{"type":"Polygon","coordinates":[[[13,48],[13.1,48],[13.1,48.1],[13,48]]]}}`

// Buildings without a City2TABULA link cannot be modelled, so a new site
// excludes them in pylovo and counts only the linked ones.
func TestCreateSite_excludesUnlinkedBuildings(t *testing.T) {
	fake := &fakeSitePylovo{osmIDs: []string{"w1", "w2", "w3"}}
	rec := serveSite(t, fake, linkedOSMIDs{"w1", "w3"}, "owner", http.MethodPost, "/sites", siteBody)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body)
	}
	if create := fake.sent("POST /sites "); len(create) != 1 || !strings.Contains(create[0], `"country_code":"DE"`) || !strings.Contains(create[0], `"user_id":"owner"`) {
		t.Errorf("create request = %v, want country_code DE and the caller as user_id", create)
	}
	patch := fake.sent("PATCH /sites/7/buildings")
	if len(patch) != 1 || !strings.Contains(patch[0], `{"building_id":2,"overrides":{"excluded":true}}`) || strings.Contains(patch[0], `"building_id":1`) {
		t.Errorf("patch = %v, want only building 2 excluded", patch)
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
	if resp.Data.BuildingCount != 2 || resp.Data.Revision != 2 {
		t.Errorf("data = %+v, want building_count 2 and revision 2", resp.Data)
	}
}

// An area over the limit is refused, and the site pylovo already made is deleted.
func TestCreateSite_overLimitIsRefusedAndDeleted(t *testing.T) {
	ids := make([]string, siteBuildingLimit+1)
	for i := range ids {
		ids[i] = fmt.Sprintf("w%d", i)
	}
	fake := &fakeSitePylovo{osmIDs: ids}
	rec := serveSite(t, fake, linkedOSMIDs(ids), "owner", http.MethodPost, "/sites", siteBody)

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
