package buem

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/tentacron"
)

func init() { gin.SetMode(gin.TestMode) }

// fakeTentacron serves the submit + poll exchange for both targets this handler
// uses, replying to each with the canned target_response for its target name,
// and records every payload submitted. A target with no canned response is
// answered as a failed job, which is how a real TentaCron reports one.
type fakeTentacron struct {
	mu        sync.Mutex
	responses map[string]string
	submitted map[string]map[string]any
	byID      map[string]string
}

func newFakeTentacron(t *testing.T, responses map[string]string) (*tentacron.Client, *fakeTentacron) {
	t.Helper()
	f := &fakeTentacron{
		responses: responses,
		submitted: map[string]map[string]any{},
		byID:      map[string]string{},
	}
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Method == http.MethodPost && r.URL.Path == "/v1/requests" {
			var body struct {
				Target  string         `json:"target"`
				Payload map[string]any `json:"payload"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			n++
			id := fmt.Sprintf("req-%d", n)
			f.submitted[body.Target] = body.Payload
			f.byID[id] = body.Target
			w.WriteHeader(http.StatusAccepted)
			_, _ = fmt.Fprintf(w, `{"id":%q}`, id)
			return
		}
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/") {
			id := strings.TrimPrefix(r.URL.Path, "/v1/requests/")
			target := f.byID[id]
			resp, ok := f.responses[target]
			if !ok {
				_, _ = fmt.Fprintf(w, `{"state":"failed","error":{"code":"target_error","message":"no %s upstream"}}`, target)
				return
			}
			_, _ = fmt.Fprintf(w, `{"state":"completed","result":{"target_status":200,"target_response":%s}}`, resp)
			return
		}
		t.Fatalf("unexpected %s %s", r.Method, r.URL)
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "k"), f
}

const (
	sampleWeather  = `{"index":["2018-01-01T00:30:00Z"],"variables":{"T":[1.0]}}`
	sampleGeometry = `{"type":"Point","coordinates":[5.98,52.10]}`
)

// editedBuilding is a building block whose wall U-value a user has changed. The
// point of this endpoint is that it reaches BuEM unchanged.
const editedBuilding = `{"building_type":"SFH","envelope":{"elements":[{"id":"w1","type":"wall","area":{"value":40,"unit":"m2"},"U":{"value":0.18,"unit":"W/(m2K)"}}]}}`

func postBody(osmID string) string {
	return fmt.Sprintf(`{"osm_id":%q,"geometry":%s,"building":%s,"start_date":"2018-01-01T00:00:00Z","end_date":"2018-12-31T23:00:00Z","resolution":60,"model_id":"42"}`,
		osmID, sampleGeometry, editedBuilding)
}

func post(t *testing.T, h *Handler, body string) (*httptest.ResponseRecorder, contracts.BuemBuildingRunResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/buem/building", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.RunBuilding(c)
	var resp contracts.BuemBuildingRunResponse
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
	}
	return w, resp
}

func TestRunBuilding_SendsTheCallersEnvelopeAndReturnsTheSeries(t *testing.T) {
	tc, fake := newFakeTentacron(t, map[string]string{
		"weather-point":  sampleWeather,
		"buem-buildings": `[{"id":"111","buem":{"thermal_load_profile":{"timeseries":{"heating":[1,2,3]}}}}]`,
	})
	w, resp := post(t, NewHandler(tc, "cosmo-rea6"), postBody("111"))

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "111", resp.OSMID)
	assert.Contains(t, string(resp.BUEM), "timeseries")

	wx := fake.submitted["weather-point"]
	assert.InDelta(t, 52.10, wx["lat"], 1e-9)
	assert.InDelta(t, 5.98, wx["lon"], 1e-9)
	assert.Equal(t, float64(2018), wx["year"], "the year comes from start_date, not from today")
	assert.Equal(t, "cosmo-rea6", wx["provider"])

	run := fake.submitted["buem-buildings"]
	assert.Equal(t, true, run["keep_timeseries"])
	buildings, ok := run["buildings"].([]any)
	require.True(t, ok)
	require.Len(t, buildings, 1)
	sent, _ := json.Marshal(buildings[0].(map[string]any)["building"])
	assert.Contains(t, string(sent), `"value":0.18`,
		"the caller's edited U-value must reach BuEM; the model path would have overwritten it from City2TABULA")
}

func TestRunBuilding_RejectsAMissingBuildingBlock(t *testing.T) {
	tc, _ := newFakeTentacron(t, nil)
	w, _ := post(t, NewHandler(tc, "cosmo-rea6"),
		`{"osm_id":"111","geometry":`+sampleGeometry+`,"start_date":"2018-01-01T00:00:00Z"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "building is required")
}

func TestRunBuilding_RejectsAnUnparseableStartDate(t *testing.T) {
	tc, _ := newFakeTentacron(t, nil)
	w, _ := post(t, NewHandler(tc, "cosmo-rea6"),
		fmt.Sprintf(`{"osm_id":"111","geometry":%s,"building":%s,"start_date":"2018"}`, sampleGeometry, editedBuilding))

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "2018", "the rejected value belongs in the message")
}

func TestRunBuilding_PerBuildingRejectionIsA400NotAnEmpty200(t *testing.T) {
	tc, _ := newFakeTentacron(t, map[string]string{
		"weather-point":  sampleWeather,
		"buem-buildings": `[{"id":"111","error":"building.envelope is required"}]`,
	})
	w, _ := post(t, NewHandler(tc, "cosmo-rea6"), postBody("111"))

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "building.envelope is required")
}

func TestRunBuilding_WeatherFailureIsABadGateway(t *testing.T) {
	tc, _ := newFakeTentacron(t, map[string]string{
		"buem-buildings": `[{"id":"111","buem":{}}]`,
	})
	w, _ := post(t, NewHandler(tc, "cosmo-rea6"), postBody("111"))

	assert.Equal(t, http.StatusBadGateway, w.Code,
		"buem-gateway requires a complete weather block, so there is no useful result without one")
}
