package pylovo

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/tentacron"
)

// emptyRegionCache is a region cache with nothing stored yet, as on a fresh stack.
type emptyRegionCache struct {
	upserted chan []byte
	covered  chan map[string][]json.RawMessage
}

func (e *emptyRegionCache) GetAllCachedRegions() ([]models.CachedRegion, error)     { return nil, nil }
func (e *emptyRegionCache) GetEnabledCachedRegions() ([]models.CachedRegion, error) { return nil, nil }
func (e *emptyRegionCache) DeleteCachedRegion(uint) error                           { return nil }
func (e *emptyRegionCache) ToggleCachedRegion(uint, bool) error                     { return nil }
func (e *emptyRegionCache) UpsertRegionsFromAPI(body []byte) error {
	e.upserted <- body
	return nil
}
func (e *emptyRegionCache) ApplyCoverage(footprints map[string][]json.RawMessage) error {
	e.covered <- footprints
	return nil
}

// A TentaCron that answers every request with one German 3D dataset footprint.
func fakeTentaCron(t *testing.T) *tentacron.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"r1","state":"received"}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"target_response":` +
			`{"datasets":[{"country":"germany","footprint":{"type":"Polygon","coordinates":[[[8,48],[9,48],[9,49],[8,48]]]}}]}}}`))
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "key")
}

// On a fresh stack the first region list comes from PyLovo and is cached; the
// cache must get its 3D coverage then, or the regions show no 3D badge.
func TestGetAvailableRegions_firstLoadAppliesCoverage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pylovo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"regions":[]}`))
	}))
	t.Cleanup(pylovo.Close)
	cache := &emptyRegionCache{upserted: make(chan []byte, 1), covered: make(chan map[string][]json.RawMessage, 1)}
	h := NewPylovoHandler(pylovo.URL, cache, nil, city2tabula.NewClient(fakeTentaCron(t)))

	r := gin.New()
	r.GET("/boundary/available", h.GetAvailableRegions)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boundary/available", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	select {
	case <-cache.upserted:
	case <-time.After(5 * time.Second):
		t.Fatal("regions were not cached")
	}
	select {
	case footprints := <-cache.covered:
		if len(footprints["germany"]) != 1 {
			t.Fatalf("coverage applied with %v, want one German footprint", footprints)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("3D coverage was not applied after the first region load")
	}
}
