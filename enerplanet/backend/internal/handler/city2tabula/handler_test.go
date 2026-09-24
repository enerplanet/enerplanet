package city2tabula

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
	c2t "spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/tentacron"
)

func init() { gin.SetMode(gin.TestMode) }

// fakeYearResolver is a hand-rolled yearResolver so default_construction_year
// can be tested without a live ignis server.
type fakeYearResolver struct {
	uValues map[string]ignis.EnvelopeUValues
	err     error
}

func (f fakeYearResolver) GetEnvelopeUValues(ctx context.Context, variantCode string) (ignis.EnvelopeUValues, error) {
	if f.err != nil {
		return ignis.EnvelopeUValues{}, f.err
	}
	return f.uValues[variantCode], nil
}

// fakeC2T stands in for City2TABULA behind a fake TentaCron: it serves the
// submit + poll exchange and answers each c2t target from these fields, so a
// c2t.Client (which speaks only TentaCron now) can drive it.
type fakeC2T struct {
	buildingsJSON       string // target_response for c2t-buildings
	buildingsBadRequest bool   // c2t-buildings fails as an upstream 400 (unsupported country)
	runStatus           string // status field returned by c2t-run-status
	runNotFound         bool   // c2t-run-status fails as an upstream 404
	triggerFails        bool   // c2t-trigger-run fails as an upstream 500
	triggeredRuns       int
	coverageCount       int    // count returned by c2t-coverage
	coverageFails       bool   // c2t-coverage fails as an upstream 500
	coverageExhausted   bool   // c2t-coverage gives up after its attempt cap
	geometryJSON        string // target_response for c2t-geometry
	geometryFails       bool   // c2t-geometry fails as an upstream 500
}

func (f *fakeC2T) client(t *testing.T) *c2t.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var req struct {
				Target string `json:"target"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			if req.Target == "c2t-trigger-run" {
				f.triggeredRuns++
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = fmt.Fprintf(w, `{"id":%q}`, req.Target)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/"):
			_, _ = w.Write([]byte(f.envelope(strings.TrimPrefix(r.URL.Path, "/v1/requests/"))))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return c2t.NewClient(tentacron.New(srv.URL, "k"))
}

// envelope builds the TentaCron job-status body for one target.
func (f *fakeC2T) envelope(target string) string {
	ok := func(body string) string {
		return `{"state":"completed","result":{"target_status":200,"target_response":` + body + `}}`
	}
	fail := func(status int, msg string) string {
		b, _ := json.Marshal(map[string]any{
			"state": "failed",
			"error": map[string]any{
				"code":    "target_error",
				"message": fmt.Sprintf("target %s: HTTP %d: %s", target, status, msg),
			},
		})
		return string(b)
	}
	switch target {
	case "c2t-buildings":
		if f.buildingsBadRequest {
			return fail(http.StatusBadRequest, `unsupported country "string": no TABULA data available`)
		}
		return ok(f.buildingsJSON)
	case "c2t-trigger-run":
		if f.triggerFails {
			return fail(http.StatusInternalServerError, "internal server error")
		}
		return ok(`{"run_id":"run-1","country":"germany","status":"pending"}`)
	case "c2t-geometry":
		if f.geometryFails {
			return fail(http.StatusInternalServerError, "internal server error")
		}
		return ok(f.geometryJSON)
	case "c2t-coverage":
		if f.coverageExhausted {
			b, _ := json.Marshal(map[string]any{
				"state": "failed",
				"error": map[string]any{
					"code": "max_attempts_exceeded",
					"message": "gave up after 2 attempts, last error: target c2t-coverage: " +
						`HTTP 500: {"error":"failed to count building_link rows for germany"}`,
				},
			})
			return string(b)
		}
		if f.coverageFails {
			return fail(http.StatusInternalServerError, "internal server error")
		}
		return ok(fmt.Sprintf(`{"count":%d}`, f.coverageCount))
	case "c2t-run-status":
		if f.runNotFound {
			return fail(http.StatusNotFound, "run not found")
		}
		return ok(`{"run_id":"run-1","country":"germany","status":"` + f.runStatus + `"}`)
	default:
		return fail(http.StatusInternalServerError, "unexpected target "+target)
	}
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
	h := &Handler{client: fake.client(t)}

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
	h := &Handler{client: fake.client(t)}

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
	h := &Handler{client: fake.client(t)}

	w, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111","222"]}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "partial", resp.Status)
	assert.Equal(t, []string{"222"}, resp.Missing)
}

func TestEnrich_MissingFields_400(t *testing.T) {
	h := &Handler{client: (&fakeC2T{}).client(t)}
	w, _ := postEnrich(t, h, `{"country":"germany","osm_ids":[]}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestEnrichStatus_Running_ReturnsStatusOnly(t *testing.T) {
	fake := &fakeC2T{runStatus: "running"}
	h := &Handler{client: fake.client(t)}

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

func TestEnrich_UnsupportedCountry_Returns400(t *testing.T) {
	fake := &fakeC2T{buildingsBadRequest: true}
	h := &Handler{client: fake.client(t)}

	w, _ := postEnrich(t, h, `{"country":"string","osm_ids":["1"],"bbox":{"xmin":0,"ymin":0,"xmax":0,"ymax":0}}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), upstreamRejectedMessage)
}

// City2TABULA names databases, schemas and container paths in its rejection
// text. The status still tells the caller the request was refused; the text
// itself belongs in the log.
func TestEnrich_UpstreamRejectionTextDoesNotReachTheClient(t *testing.T) {
	fake := &fakeC2T{buildingsBadRequest: true}
	h := &Handler{client: fake.client(t)}

	w, _ := postEnrich(t, h, `{"country":"string","osm_ids":["1"],"bbox":{"xmin":0,"ymin":0,"xmax":0,"ymax":0}}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.NotContains(t, w.Body.String(), "unsupported country")
	assert.NotContains(t, w.Body.String(), "TABULA data available")
}

func TestEnrichStatus_UnknownRunID_Returns404(t *testing.T) {
	fake := &fakeC2T{runNotFound: true}
	h := &Handler{client: fake.client(t)}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/enrich/stale-id", nil)
	c.Params = gin.Params{{Key: "run_id", Value: "stale-id"}}
	h.EnrichStatus(c)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestEnrich_SetsDefaultConstructionYearFromTabulaVariant(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	h := &Handler{
		client: fake.client(t),
		yearClient: fakeYearResolver{uValues: map[string]ignis.EnvelopeUValues{
			"DE.N.SFH.05.Gen": {YearFrom: 1958, YearTo: 1968},
		}},
	}

	_, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111"]}`)

	b := resp.Data["111"]
	require.NotNil(t, b.DefaultConstructionYear)
	assert.Equal(t, 1963, *b.DefaultConstructionYear)
}

func TestEnrich_NoYearClientLeavesDefaultConstructionYearNil(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	h := &Handler{client: fake.client(t)} // yearClient unset, as in most other tests here

	_, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111"]}`)

	assert.Nil(t, resp.Data["111"].DefaultConstructionYear)
}

func TestEnrich_IgnisFailureLeavesDefaultConstructionYearNil(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	h := &Handler{client: fake.client(t), yearClient: fakeYearResolver{err: assert.AnError}}

	_, resp := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111"]}`)

	assert.Nil(t, resp.Data["111"].DefaultConstructionYear, "an ignis miss must not fail the enrich response")
}

func TestEnrichStatus_Completed_WithQueryParams_ReturnsData(t *testing.T) {
	fake := &fakeC2T{runStatus: "completed", buildingsJSON: twoWallBuilding}
	h := &Handler{client: fake.client(t)}

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

// fakeCountry stands in for the Nominatim resolver, recording the geometry it
// was handed so a test can check which point decided the country.
type fakeCountry struct {
	country    string
	err        error
	gotGeoJSON string
}

func (f *fakeCountry) Resolve(_ context.Context, coords json.RawMessage) (string, error) {
	f.gotGeoJSON = string(coords)
	return f.country, f.err
}

func TestEnrich_NoCountry_ResolvesItFromTheBboxCentre(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	country := &fakeCountry{country: "netherlands"}
	h := &Handler{client: fake.client(t), country: country}

	w, resp := postEnrich(t, h, `{"bbox":{"xmin":5.9,"ymin":52.0,"xmax":6.1,"ymax":52.2},"osm_ids":["111"]}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "completed", resp.Status)
	assert.JSONEq(t, `{"type":"Point","coordinates":[6,52.1]}`, country.gotGeoJSON,
		"the centre of the drawn area decides, not a corner")
}

func TestEnrich_CountryGiven_IsNotResolved(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	country := &fakeCountry{country: "netherlands"}
	h := &Handler{client: fake.client(t), country: country}

	w, _ := postEnrich(t, h, `{"country":"germany","bbox":{"xmin":6,"ymin":51,"xmax":6.1,"ymax":51.1},"osm_ids":["111"]}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, country.gotGeoJSON, "a caller that named the country is taken at its word")
}

func TestEnrich_CountryUnresolvable_IsA400(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: twoWallBuilding}
	h := &Handler{client: fake.client(t), country: &fakeCountry{err: errors.New("no country at these coordinates")}}

	w, _ := postEnrich(t, h, `{"bbox":{"xmin":0,"ymin":0,"xmax":0.1,"ymax":0.1},"osm_ids":["111"]}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "could not resolve the country")
}
