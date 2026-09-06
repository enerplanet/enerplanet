//go:build manualignis

// Regression guard for the resolve chain against a live TentaCron fronting a
// real ignis service. Not run by `go test ./...` or CI: it needs a running
// TentaCron with the three ignis targets configured and an ignis instance
// backed by a TABULA-populated database, none of which exist in CI.
//
// Run it after any change to internal/tentacron, internal/ignis or
// internal/heatdemand, or after an ignis release, with the stack reachable:
//
//	TENTACRON_LIVE_URL=http://127.0.0.1:8092 TENTACRON_LIVE_KEY=dev-frontend-key \
//	  go test -tags manualignis -run TestResolveChainLive -v ./internal/heatdemand/
//
// TENTACRON_LIVE_URL defaults to http://127.0.0.1:8092, the key to
// dev-frontend-key.
package heatdemand

import (
	"context"
	"os"
	"testing"
	"time"

	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/tentacron"
)

func liveEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func intPtr(v int) *int { return &v }

func TestResolveChainLive(t *testing.T) {
	client := ignis.NewClient(tentacron.New(
		liveEnv("TENTACRON_LIVE_URL", "http://127.0.0.1:8092"),
		liveEnv("TENTACRON_LIVE_KEY", "dev-frontend-key"),
	))
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

	// The run_buem envelope path: resolve a variant, then fetch its U-values
	// (ignis-data). Not part of Resolve.
	t.Run("envelope U-values resolve for run_buem", func(t *testing.T) {
		code, err := client.ExistingStateVariant(ctx, "DE", "SFH", 1975)
		if err != nil {
			t.Fatalf("ExistingStateVariant: %v", err)
		}
		u, err := client.GetEnvelopeUValues(ctx, code)
		if err != nil {
			t.Fatalf("GetEnvelopeUValues: %v", err)
		}
		if u.Wall <= 0 || u.Roof <= 0 || u.Floor <= 0 {
			t.Fatalf("non-positive U-value in %+v", u)
		}
		t.Logf("variant=%s U wall=%.2f roof=%.2f floor=%.2f W/(m2.K)", code, u.Wall, u.Roof, u.Floor)
	})

	t.Run("added latency per resolve call is small", func(t *testing.T) {
		start := time.Now()
		const n = 5
		for i := 0; i < n; i++ {
			if got := Resolve(ctx, client, Input{
				FClass: "detached", Country: "germany",
				ConstructionYear: intPtr(1975), FloorAreaM2: 120,
			}); got.Source != SourceIgnis {
				t.Fatalf("iteration %d: source = %q", i, got.Source)
			}
		}
		perResolve := time.Since(start) / n
		// Each resolve is two TentaCron round-trips (match + calculate), each a
		// submit plus one ?wait GET. Well under a second against a local
		// TentaCron; this only fails if the 202+poll overhead is pathological.
		if perResolve > time.Second {
			t.Fatalf("per-resolve wall time %s exceeds 1s", perResolve)
		}
		t.Logf("~%s per resolve (2 TentaCron calls each)", perResolve.Round(time.Millisecond))
	})
}
