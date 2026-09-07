//go:build manualignis

// Regression guard for the buem-gateway leg against a live TentaCron fronting a
// real buem-gateway. Not run by `go test ./...` or CI: it needs a running
// TentaCron with the buem-buildings target configured and a buem-gateway it can
// reach. Shares the manualignis tag with the ignis, weather and c2t live tests
// so one run covers every TentaCron leg.
//
// The empty-batch subtest passes against buem-gateway alone. A real building
// batch also needs a live BuEM behind the gateway; skip it (WITH_BUEM unset)
// until one is available.
//
//	TENTACRON_LIVE_URL=http://127.0.0.1:8092 TENTACRON_LIVE_KEY=dev-frontend-key \
//	  go test -tags manualignis -run TestBuemLegLive -v ./internal/buem/
package buem

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

func TestBuemLegLive(t *testing.T) {
	client := NewClient(tentacron.New(
		liveEnv("TENTACRON_LIVE_URL", "http://127.0.0.1:8092"),
		liveEnv("TENTACRON_LIVE_KEY", "dev-frontend-key"),
	))
	ctx := context.Background()

	t.Run("empty batch returns an empty result set", func(t *testing.T) {
		start := time.Now()
		results, err := client.RunBuildings(ctx, nil, json.RawMessage(sampleWeather),
			"2018-01-01T00:00:00Z", "2018-12-31T23:00:00Z", 60, "live-test-empty")
		if err != nil {
			t.Fatalf("RunBuildings(empty): %v", err)
		}
		if len(results) != 0 {
			t.Fatalf("empty batch returned %d results, want 0", len(results))
		}
		t.Logf("empty batch round-trip in %s", time.Since(start).Round(time.Millisecond))
	})

	t.Run("one building batch", func(t *testing.T) {
		if os.Getenv("WITH_BUEM") == "" {
			t.Skip("set WITH_BUEM=1 once a live BuEM is behind buem-gateway")
		}
		results, err := client.RunBuildings(ctx, sampleBuildings(), json.RawMessage(sampleWeather),
			"2018-01-01T00:00:00Z", "2018-12-31T23:00:00Z", 60, "live-test-batch")
		if err != nil {
			t.Fatalf("RunBuildings(batch): %v", err)
		}
		if len(results) != len(sampleBuildings()) {
			t.Fatalf("got %d results for %d buildings", len(results), len(sampleBuildings()))
		}
		for _, r := range results {
			t.Logf("building %s: buem=%d bytes error=%q", r.ID, len(r.BUEM), r.Error)
		}
	})
}
