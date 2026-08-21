package weather

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPointWeather_ReturnsRawBody(t *testing.T) {
	const body = `{"index":["2026-01-01T00:00:00Z"],"variables":{"T":[5.2]}}`
	var gotPath, gotAPIKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		gotAPIKey = r.Header.Get("X-API-Key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	raw, err := client.GetPointWeather(context.Background(), 53.15, 8.80, 2026, "era5_land")

	require.NoError(t, err)
	assert.JSONEq(t, body, string(raw))
	assert.Contains(t, gotPath, "lat=53.15")
	assert.Contains(t, gotPath, "lon=8.8")
	assert.Contains(t, gotPath, "year=2026")
	assert.Contains(t, gotPath, "provider=era5_land")
	assert.Contains(t, gotPath, "use_case=solar")
	assert.Contains(t, gotPath, "format=json")
	assert.Equal(t, "test-key", gotAPIKey)
}

func TestGetPointWeather_UnexpectedStatusIsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	_, err := client.GetPointWeather(context.Background(), 200, 8.80, 2026, "era5_land")

	assert.Error(t, err)
}
