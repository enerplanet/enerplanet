package city2tabula

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
	c2t "spatialhub_backend/internal/city2tabula"
)

func init() { gin.SetMode(gin.TestMode) }

// fakeC2T stands in for the City2TABULA on-request server.
type fakeC2T struct {
	buildingsJSON string // response body for GET /api/v1/buildings
	runStatus     string // status returned by GET /api/v1/runs/{id}
	runNotFound   bool   // GET /api/v1/runs/{id} returns 404
	triggerFails  bool   // POST /api/v1/runs returns 500
	triggeredRuns int
}

func (f *fakeC2T) server(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/buildings":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(f.buildingsJSON))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runs":
			f.triggeredRuns++
			if f.triggerFails {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"run_id":"run-1","country":"germany","status":"pending"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/runs/"):
			if f.runNotFound {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(`{"run_id":"run-1","country":"germany","status":"` + f.runStatus + `"}`))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

const twoWallBuilding = `[{
  "object_id": "DEBW_1", "osm_id": "111", "match_type": 1,
  "number_of_storeys": 3, "room_height": 2.5, "footprint_area": 80,
  "tabula_variant_code": "DE.N.SFH.05.Gen",
  "surfaces": [
    {"id": "w1", "type": "WallSurface", "area": 30, "azimuth": 180, "tilt": 0},
    {"id": "r1", "type": "RoofSurface", "area": 60, "azimuth": -1, "tilt": 90}
  ]
}]`

func postEnrich(t *testing.T, h *Handler, body string) (*httptest.ResponseRecorder, contracts.EnrichResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/city2tabula/enrich", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Enrich(c)
	var resp contracts.EnrichResponse
	if w.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	}
	return w, resp
}

func TestEnrich_AllResolved_ReturnsCompletedInline(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111"]}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "completed", resp.Status)
	assert.Equal(t, 1, resp.Resolved)
	assert.Equal(t, 1, resp.Total)
	assert.Empty(t, resp.Missing)
	assert.Equal(t, 0, fake.triggeredRuns, "no run should be triggered when every osm_id resolves")

	b := resp.Data["111"]
	assert.Equal(t, "DEBW_1", b.ObjectID)
	require.NotNil(t, b.TabulaVariantCode)
	assert.Equal(t, "DE.N.SFH.05.Gen", *b.TabulaVariantCode)

	require.NotNil(t, b.Buem.Building.NStoreys)
	assert.EqualValues(t, 3, *b.Buem.Building.NStoreys)
	elements := b.Buem.Building.Envelope.Elements
	require.Len(t, elements, 2)
	assert.Equal(t, "wall", elements[0].Type)
	assert.EqualValues(t, 90, elements[0].Tilt.Value)   // c2t 0 -> BuEM 90
	assert.EqualValues(t, 0, elements[1].Azimuth.Value) // c2t -1 -> clamped 0
}

func TestEnrich_SomeMissing_TriggersRunAndReturns202(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding} // only 111 comes back
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111","222"]}`)

	assert.Equal(t, http.StatusAccepted, w.Code)
	assert.Equal(t, "running", resp.Status)
	assert.Equal(t, "run-1", resp.RunID)
	assert.Equal(t, 1, resp.Resolved)
	assert.Equal(t, 2, resp.Total)
	assert.Equal(t, []string{"222"}, resp.Missing)
	assert.Equal(t, 1, fake.triggeredRuns)
	assert.Contains(t, resp.Data, "111", "the resolved building is returned alongside the running status")
}

func TestEnrich_TriggerFails_ReturnsPartial(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding, triggerFails: true}
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111","222"]}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "partial", resp.Status)
	assert.Equal(t, []string{"222"}, resp.Missing)
}

func TestEnrich_MissingFields_400(t *testing.T) {
	h := NewHandler(c2t.NewClient("http://unused"))
	w, _ := postEnrich(t, h, `{"country":"germany","osm_ids":[]}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestEnrichStatus_Running_ReturnsStatusOnly(t *testing.T) {
	fake := &fakeC2T{runStatus: "running"}
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/enrich/run-1", nil)
	c.Params = gin.Params{{Key: "run_id", Value: "run-1"}}
	h.EnrichStatus(c)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp contracts.EnrichResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "running", resp.Status)
	assert.Empty(t, resp.Data)
}

func TestEnrichStatus_UnknownRunID_Returns404(t *testing.T) {
	fake := &fakeC2T{runNotFound: true}
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/enrich/stale-id", nil)
	c.Params = gin.Params{{Key: "run_id", Value: "stale-id"}}
	h.EnrichStatus(c)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestEnrichStatus_Completed_WithQueryParams_ReturnsData(t *testing.T) {
	fake := &fakeC2T{runStatus: "completed", buildingsJSON: twoWallBuilding}
	srv := fake.server(t)
	defer srv.Close()
	h := NewHandler(c2t.NewClient(srv.URL))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet,
		"/api/v1/city2tabula/enrich/run-1?country=germany&osm_ids=111,222", nil)
	c.Params = gin.Params{{Key: "run_id", Value: "run-1"}}
	h.EnrichStatus(c)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp contracts.EnrichResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "completed", resp.Status)
	assert.Equal(t, 1, resp.Resolved)
	assert.Equal(t, 2, resp.Total)
	assert.Equal(t, []string{"222"}, resp.Missing)
	assert.Contains(t, resp.Data, "111")
}
