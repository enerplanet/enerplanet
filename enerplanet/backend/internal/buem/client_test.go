package buem

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunBuildings_ReturnsResultsInOrder(t *testing.T) {
	var gotBody map[string]interface{}
	var gotAPIKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/v1/buem/buildings", r.URL.Path)
		gotAPIKey = r.Header.Get("X-Api-Key")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"111","buem":{"thermal_load_profile":{}}},{"id":"222","error":"building.envelope is required"}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	buildings := []Building{
		{ID: "111", Geometry: json.RawMessage(`{"type":"Point","coordinates":[1,2]}`), Building: json.RawMessage(`{"envelope":{"elements":[]}}`)},
		{ID: "222", Geometry: json.RawMessage(`{"type":"Point","coordinates":[3,4]}`), Building: json.RawMessage(`{}`)},
	}
	weather := json.RawMessage(`{"index":["2026-01-01T00:30:00Z"],"variables":{"T":[1.0]}}`)

	results, err := client.RunBuildings(context.Background(), buildings, weather, "2026-01-01T00:00:00Z", "2026-12-31T23:00:00Z", 60, "model-42")

	require.NoError(t, err)
	assert.Equal(t, "model-42", gotBody["model_id"])
	assert.Equal(t, float64(60), gotBody["resolution"])
	assert.Equal(t, "test-key", gotAPIKey)
	gotWeather, ok := gotBody["weather"].(map[string]interface{})
	require.True(t, ok, "expected weather to be sent once at the top level, got %v", gotBody["weather"])
	assert.Contains(t, gotWeather, "index")
	gotBuildings, ok := gotBody["buildings"].([]interface{})
	require.True(t, ok)
	assert.Len(t, gotBuildings, 2)

	require.Len(t, results, 2)
	assert.Equal(t, "111", results[0].ID)
	assert.NotEmpty(t, results[0].BUEM)
	assert.Empty(t, results[0].Error)
	assert.Equal(t, "222", results[1].ID)
	assert.Empty(t, results[1].BUEM)
	assert.Equal(t, "building.envelope is required", results[1].Error)
}

func TestRunBuildings_UnexpectedStatusIsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	_, err := client.RunBuildings(context.Background(), nil, json.RawMessage(`{}`), "s", "e", 60, "m")

	assert.Error(t, err)
}
