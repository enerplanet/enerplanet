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
