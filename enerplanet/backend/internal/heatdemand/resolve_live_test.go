//go:build manualignis

// Regression guard for the resolve chain against a real ignis service. Not
// run by `go test ./...` or CI: it needs an ignis instance backed by a
// TABULA-populated database, which is not available in CI.
//
// Run it after any change to internal/ignis or internal/heatdemand, or after
// an ignis release, with ignis reachable and:
//
//	IGNIS_LIVE_URL=http://127.0.0.1:18080 \
//	  go test -tags manualignis -run TestResolveChainLive -v ./internal/heatdemand/
//
// IGNIS_LIVE_URL defaults to http://127.0.0.1:18080.
package heatdemand

import (
	"context"
	"os"
	"testing"

	"spatialhub_backend/internal/ignis"
)

func liveIgnisURL() string {
	if u := os.Getenv("IGNIS_LIVE_URL"); u != "" {
		return u
	}
	return "http://127.0.0.1:18080"
}

func intPtr(v int) *int { return &v }

func TestResolveChainLive(t *testing.T) {
	client := ignis.NewClient(liveIgnisURL())
	ctx := context.Background()

	t.Run("residential resolves via ignis", func(t *testing.T) {
		got := Resolve(ctx, client, Input{
			FClass:           "detached",
			Country:          "germany",
			ConstructionYear: intPtr(1975),
			FloorAreaM2:      120,
		})
		if got.Source != SourceIgnis {
			t.Fatalf("source = %q, want %q (warnings: %v)", got.Source, SourceIgnis, got.Warnings)
		}
		if got.TabulaVariantCode == nil {
			t.Fatal("tabula_variant_code is nil")
		}
		if got.HeatingDemandKwhA < 5_000 || got.HeatingDemandKwhA > 60_000 {
			t.Fatalf("heating_demand_kwh_a = %d, outside the sane 5000..60000 range for a 120 m2 SFH", got.HeatingDemandKwhA)
		}
		t.Logf("variant=%s specific=%.1f kWh/m2a annual=%d kWh",
			*got.TabulaVariantCode, got.SpecificHeatingDemandKwhM2a, got.HeatingDemandKwhA)
	})

	t.Run("non-residential resolves via estimate", func(t *testing.T) {
		got := Resolve(ctx, client, Input{
			FClass:      "office",
			Country:     "germany",
			FloorAreaM2: 500,
		})
		if got.Source != SourceEstimate {
			t.Fatalf("source = %q, want %q", got.Source, SourceEstimate)
		}
		if len(got.Warnings) != 0 {
			t.Fatalf("non-residential estimate is the correct path, want no warnings, got %v", got.Warnings)
		}
		t.Logf("specific=%.1f kWh/m2a annual=%d kWh", got.SpecificHeatingDemandKwhM2a, got.HeatingDemandKwhA)
	})

	t.Run("residential without construction year falls back to estimate with a warning", func(t *testing.T) {
		got := Resolve(ctx, client, Input{
			FClass:      "detached",
			Country:     "germany",
			FloorAreaM2: 120,
		})
		if got.Source != SourceEstimate {
			t.Fatalf("source = %q, want %q", got.Source, SourceEstimate)
		}
		if len(got.Warnings) == 0 {
			t.Fatal("want a fallback warning explaining the missing construction year")
		}
		t.Logf("warning: %s", got.Warnings[0])
	})
}
