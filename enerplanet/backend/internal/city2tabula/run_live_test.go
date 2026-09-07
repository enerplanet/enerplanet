//go:build manualignis

// Regression guard for the City2TABULA leg against a live TentaCron fronting a
// real city2tabula-server. Not run by `go test ./...` or CI: it needs a
// running TentaCron with the three c2t targets configured and a
// city2tabula-server it can reach. Shares the manualignis tag with the ignis
// and weather live tests so one run covers every TentaCron leg.
//
//	TENTACRON_LIVE_URL=http://127.0.0.1:8092 TENTACRON_LIVE_KEY=dev-frontend-key \
//	  go test -tags manualignis -run TestC2TLegLive -v ./internal/city2tabula/
package city2tabula

import (
	"context"
	"errors"
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

func TestC2TLegLive(t *testing.T) {
	client := NewClient(tentacron.New(
		liveEnv("TENTACRON_LIVE_URL", "http://127.0.0.1:8092"),
		liveEnv("TENTACRON_LIVE_KEY", "dev-frontend-key"),
	))
	ctx := context.Background()

	// A tiny box in open sea off the Belgian coast: a valid request that maps
	// to no buildings, so the pipeline settles on no_data (or completes with an
	// empty set) rather than failing.
	emptyBox := Bbox{Xmin: 2.40, Ymin: 51.60, Xmax: 2.41, Ymax: 51.61}

	t.Run("trigger then poll to a non-failed terminal state", func(t *testing.T) {
		run, err := client.TriggerRun(ctx, "belgium", emptyBox)
		if err != nil {
			t.Fatalf("TriggerRun: %v", err)
		}
		if run.RunID == "" {
			t.Fatal("TriggerRun returned an empty run id")
		}
		t.Logf("run %s status %s", run.RunID, run.Status)

		deadline := time.Now().Add(2 * time.Minute)
		for {
			got, err := client.GetRunStatus(ctx, run.RunID)
			if err != nil {
				t.Fatalf("GetRunStatus(%s): %v", run.RunID, err)
			}
			switch got.Status {
			case "no_data", "completed":
				t.Logf("terminal status %s", got.Status)
				return
			case "failed":
				t.Fatalf("run %s failed: %s", run.RunID, got.Error)
			}
			if time.Now().After(deadline) {
				t.Fatalf("run %s still %s after 2m", run.RunID, got.Status)
			}
			time.Sleep(3 * time.Second)
		}
	})

	t.Run("stale run id is ErrRunNotFound", func(t *testing.T) {
		_, err := client.GetRunStatus(ctx, "00000000-0000-0000-0000-000000000000")
		if !errors.Is(err, ErrRunNotFound) {
			t.Fatalf("want ErrRunNotFound for a stale id, got %v", err)
		}
	})

	t.Run("buildings for an unknown osm_id is an empty set, not an error", func(t *testing.T) {
		buildings, err := client.GetBuildingsByOSMIDs(ctx, "belgium", []string{"live-test-no-such-osm-id"})
		if err != nil {
			t.Fatalf("GetBuildingsByOSMIDs: %v", err)
		}
		if len(buildings) != 0 {
			t.Fatalf("want no buildings for a bogus osm_id, got %d", len(buildings))
		}
	})
}
