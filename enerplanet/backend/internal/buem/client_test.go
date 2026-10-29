package buem

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

// fakeTentacron serves the submit + single-poll TentaCron exchange, replying to
// the status GET with statusBody. It records the payload submitted for
// buem-buildings.
func fakeTentacron(t *testing.T, statusBody string) (*tentacron.Client, *map[string]any) {
	t.Helper()
	var gotPayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var body struct {
				Target  string         `json:"target"`
				Payload map[string]any `json:"payload"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			assert.Equal(t, "buem-buildings", body.Target)
			gotPayload = body.Payload
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/req-1":
			_, _ = w.Write([]byte(statusBody))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "k"), &gotPayload
}

func completed(targetResponse string) string {
	return `{"state":"completed","result":{"target_status":200,"target_response":` + targetResponse + `}}`
}

func failed(code, message string) string {
	b, _ := json.Marshal(map[string]any{
		"state": "failed",
		"error": map[string]any{"code": code, "message": message},
	})
	return string(b)
}

func sampleBuildings() []Building {
	return []Building{
		{ID: "111", Geometry: json.RawMessage(`{"type":"Point","coordinates":[1,2]}`), Building: json.RawMessage(`{"envelope":{"elements":[]}}`)},
		{ID: "222", Geometry: json.RawMessage(`{"type":"Point","coordinates":[3,4]}`), Building: json.RawMessage(`{}`)},
	}
}

const sampleWeather = `{"index":["2026-01-01T00:30:00Z"],"variables":{"T":[1.0]}}`

func TestRunBuildings_ForwardsBodyAndReturnsResultsInOrder(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(
		`[{"id":"111","buem":{"thermal_load_profile":{}}},{"id":"222","error":"building.envelope is required"}]`))

	results, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "2026-01-01T00:00:00Z", "2026-12-31T23:00:00Z", 60, "model-42")

	require.NoError(t, err)
	assert.Equal(t, "model-42", (*payload)["model_id"])
	assert.Equal(t, float64(60), (*payload)["resolution"])
	weather, ok := (*payload)["weather"].(map[string]any)
	require.True(t, ok, "weather must be sent once at the top level")
	assert.Contains(t, weather, "index")
	sent, ok := (*payload)["buildings"].([]any)
	require.True(t, ok)
	assert.Len(t, sent, 2)

	require.Len(t, results, 2)
	assert.Equal(t, "111", results[0].ID)
	assert.NotEmpty(t, results[0].BUEM)
	assert.Empty(t, results[0].Error)
	assert.Equal(t, "222", results[1].ID)
	assert.Equal(t, "building.envelope is required", results[1].Error)
}

func TestRunBuildings_ResolutionZeroDefaultsTo60(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(`[]`))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 0, "m")

	require.NoError(t, err)
	assert.Equal(t, float64(60), (*payload)["resolution"])
}

func TestRunBuildings_GatewayBadRequestIsBadRequestError(t *testing.T) {
	tc, _ := fakeTentacron(t, failed("target_error",
		`target buem-buildings: HTTP 400: {"error":"resolution must be a positive integer"}`))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.Error(t, err)
	var badReq *BadRequestError
	require.ErrorAs(t, err, &badReq)
	assert.Contains(t, badReq.Message, "resolution must be a positive integer")
}

func TestRunBuildings_GatewayDownStaysOpaque(t *testing.T) {
	tc, _ := fakeTentacron(t, failed("target_error", "target buem-buildings: HTTP 502: Bad Gateway"))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.Error(t, err)
	var badReq *BadRequestError
	assert.NotErrorAs(t, err, &badReq, "a 5xx is gateway-down, not a bad request")
	te, ok := tentacron.AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "target_error", te.Code)
}

func TestRunBuildings_BatchTimeoutStaysOpaque(t *testing.T) {
	tc, _ := fakeTentacron(t, failed("target_timeout", "target buem-buildings timed out after 570s"))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.Error(t, err)
	var badReq *BadRequestError
	assert.NotErrorAs(t, err, &badReq)
	te, ok := tentacron.AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "target_timeout", te.Code)
}

func TestRunBuilding_AsksForTheHourlySeriesAndReturnsTheOneResult(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(
		`[{"id":"111","buem":{"thermal_load_profile":{"timeseries":{"heating":[1,2,3]}}}}]`))

	result, err := NewClient(tc).RunBuilding(context.Background(), sampleBuildings()[0],
		json.RawMessage(sampleWeather), "2026-01-01T00:00:00Z", "2026-12-31T23:00:00Z", 60, "model-42")

	require.NoError(t, err)
	assert.Equal(t, true, (*payload)["keep_timeseries"],
		"without this buem-gateway strips the hourly values and the configurator has no profile to draw")
	sent, ok := (*payload)["buildings"].([]any)
	require.True(t, ok)
	assert.Len(t, sent, 1)

	assert.Equal(t, "111", result.ID)
	assert.Contains(t, string(result.BUEM), "timeseries")
}

func TestRunBuildings_DoesNotAskForTheHourlySeries(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(`[]`))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.NoError(t, err)
	assert.NotContains(t, *payload, "keep_timeseries",
		"buem-buildings is read whole under TentaCron's 10 MiB response cap, which is "+
			"roughly fifteen building-years at ~666 KB each, so this flag here fails every "+
			"batch past about fifteen buildings")
}

func TestRunBuilding_EmptyBatchIsAnErrorNotAPanic(t *testing.T) {
	tc, _ := fakeTentacron(t, completed(`[]`))

	_, err := NewClient(tc).RunBuilding(context.Background(), sampleBuildings()[0],
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "111")
}

func sentThermal(t *testing.T, payload map[string]any, i int) map[string]any {
	t.Helper()
	buildings, ok := payload["buildings"].([]any)
	require.True(t, ok)
	block, ok := buildings[i].(map[string]any)["building"].(map[string]any)
	require.True(t, ok)
	thermal, _ := block["thermal"].(map[string]any)
	return thermal
}

// Without an explicit band BuEM's API applies 21-24 °C, which overstates
// heating against BuEM's own recommended residential default of 18-21 °C.
func TestRunBuildings_SendsTheDefaultComfortBand(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(`[]`))

	_, err := NewClient(tc).RunBuildings(context.Background(), sampleBuildings(),
		json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.NoError(t, err)
	for i := range sampleBuildings() {
		thermal := sentThermal(t, *payload, i)
		assert.Equal(t, map[string]any{"value": 18.0, "unit": "degC"}, thermal["comfortT_lb"])
		assert.Equal(t, map[string]any{"value": 21.0, "unit": "degC"}, thermal["comfortT_ub"])
	}
}

// A building edited in the configurator may carry its own band; it reaches
// BuEM as set, and no default bound is added beside it.
func TestRunBuilding_KeepsTheBuildingsOwnComfortBand(t *testing.T) {
	tc, payload := fakeTentacron(t, completed(`[{"id":"111","buem":{}}]`))
	b := Building{ID: "111", Geometry: json.RawMessage(`{"type":"Point","coordinates":[1,2]}`),
		Building: json.RawMessage(`{"thermal":{"comfortT_lb":{"value":20,"unit":"degC"},"n_air_use":{"value":0.4,"unit":"1/h"}}}`)}

	_, err := NewClient(tc).RunBuilding(context.Background(), b, json.RawMessage(sampleWeather), "s", "e", 60, "m")

	require.NoError(t, err)
	thermal := sentThermal(t, *payload, 0)
	assert.Equal(t, map[string]any{"value": 20.0, "unit": "degC"}, thermal["comfortT_lb"])
	assert.NotContains(t, thermal, "comfortT_ub")
	assert.Contains(t, thermal, "n_air_use", "other thermal fields are kept")
}
