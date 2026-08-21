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

func TestRunTopology_ReturnsEnrichedTopology(t *testing.T) {
	var gotBody map[string]interface{}
	var gotAPIKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/v1/buem/topology", r.URL.Path)
		gotAPIKey = r.Header.Get("X-Api-Key")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"start_date":"2026-01-01T00:00:00Z","end_date":"2026-12-31T23:00:00Z","topology":[{"enriched":true}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	enriched, err := client.RunTopology(
		context.Background(),
		json.RawMessage(`[{"from":{},"to":{}}]`),
		"2026-01-01T00:00:00Z", "2026-12-31T23:00:00Z", 60, "model-42",
	)

	require.NoError(t, err)
	assert.JSONEq(t, `[{"enriched":true}]`, string(enriched))
	assert.Equal(t, "model-42", gotBody["model_id"])
	assert.Equal(t, float64(60), gotBody["resolution"])
	assert.Equal(t, "test-key", gotAPIKey)
}

func TestRunTopology_UnexpectedStatusIsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	_, err := client.RunTopology(context.Background(), json.RawMessage(`[]`), "s", "e", 60, "m")

	assert.Error(t, err)
}
