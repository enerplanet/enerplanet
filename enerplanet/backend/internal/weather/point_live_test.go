//go:build manualignis

// Regression guard for the weather leg against a live TentaCron fronting a real
// weather-serve. Not run by `go test ./...` or CI: it needs a running TentaCron
// with the weather-point target configured, a weather-serve instance with the
// 2018 archives, and network reachability from TentaCron to weather-serve
// (weather-serve is not in TentaCron's compose network yet). Shares the
// manualignis tag with internal/heatdemand/resolve_live_test.go so one run
// covers both legs.
//
//	TENTACRON_LIVE_URL=http://127.0.0.1:8092 TENTACRON_LIVE_KEY=dev-frontend-key \
//	  go test -tags manualignis -run TestPointWeatherLive -v ./internal/weather/
package weather

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"spatialhub_backend/internal/tentacron"
)

func liveEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func TestPointWeatherLive(t *testing.T) {
	client := NewClient(tentacron.New(
		liveEnv("TENTACRON_LIVE_URL", "http://127.0.0.1:8092"),
		liveEnv("TENTACRON_LIVE_KEY", "dev-frontend-key"),
	))
	// Bremen centroid, a year weather-serve has archives for.
	const lat, lon, year = 53.08, 8.80, 2018
	provider := liveEnv("WEATHER_LIVE_PROVIDER", "cosmo-rea6")

	start := time.Now()
	raw, err := client.GetPointWeather(context.Background(), lat, lon, year, provider)
	if err != nil {
		t.Fatalf("GetPointWeather: %v", err)
	}
	t.Logf("weather-serve via TentaCron returned %d bytes in %s", len(raw), time.Since(start).Round(time.Millisecond))

	var ts struct {
		Index     []string             `json:"index"`
		Variables map[string][]float64 `json:"variables"`
	}
	if err := json.Unmarshal(raw, &ts); err != nil {
		t.Fatalf("response is not the {index, variables} shape buem-gateway needs: %v", err)
	}
	if len(ts.Index) < 8000 {
		t.Fatalf("index has %d rows, want a full year (~8760)", len(ts.Index))
	}
	for _, name := range []string{"T", "GHI", "DHI", "DNI"} {
		v, ok := ts.Variables[name]
		if !ok {
			t.Fatalf("use_case=solar must return %q; got variables %v", name, keys(ts.Variables))
		}
		if len(v) != len(ts.Index) {
			t.Fatalf("variable %q has %d values, index has %d", name, len(v), len(ts.Index))
		}
	}
}

func keys(m map[string][]float64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
