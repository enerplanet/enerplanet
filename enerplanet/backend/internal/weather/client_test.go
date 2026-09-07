package weather

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
// the status GET with statusBody. It records the submit payload it received.
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
			assert.Equal(t, "weather-point", body.Target)
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

func TestGetPointWeather_ReturnsRawBodyVerbatim(t *testing.T) {
	const weatherJSON = `{"index":["2018-01-01T00:00:00Z"],"variables":{"T":[5.2],"GHI":[0]}}`
	status := `{"state":"completed","result":{"target_status":200,"target_response":` + weatherJSON + `}}`
	tc, gotPayload := fakeTentacron(t, status)

	raw, err := NewClient(tc).GetPointWeather(context.Background(), 53.15, 8.80, 2018, "cosmo-rea6")

	require.NoError(t, err)
	assert.JSONEq(t, weatherJSON, string(raw))
	assert.Equal(t, map[string]any{
		"lat": 53.15, "lon": 8.80, "year": float64(2018),
		"provider": "cosmo-rea6", "use_case": "solar", "format": "json",
	}, *gotPayload)
}

func TestGetPointWeather_UpstreamRejectionSurfacesWeatherMessage(t *testing.T) {
	status := `{"state":"failed","error":{"code":"target_error","message":"target weather-point: HTTP 404: no archive for year 2099"}}`
	tc, _ := fakeTentacron(t, status)

	_, err := NewClient(tc).GetPointWeather(context.Background(), 53.15, 8.80, 2099, "cosmo-rea6")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no archive for year 2099")
}

func TestGetPointWeather_InfraFaultReturnedUnchanged(t *testing.T) {
	status := `{"state":"failed","error":{"code":"unknown_target","message":"no target weather-point"}}`
	tc, _ := fakeTentacron(t, status)

	_, err := NewClient(tc).GetPointWeather(context.Background(), 53.15, 8.80, 2018, "cosmo-rea6")

	require.Error(t, err)
	te, ok := tentacron.AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "unknown_target", te.Code)
}
