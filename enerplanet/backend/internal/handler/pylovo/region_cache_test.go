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
	refreshed chan map[string][]json.RawMessage
}

func (e *emptyRegionCache) GetAllCachedRegions() ([]models.CachedRegion, error)     { return nil, nil }
func (e *emptyRegionCache) GetEnabledCachedRegions() ([]models.CachedRegion, error) { return nil, nil }
func (e *emptyRegionCache) DeleteCachedRegion(uint) error                           { return nil }
func (e *emptyRegionCache) ToggleCachedRegion(uint, bool) error                     { return nil }
func (e *emptyRegionCache) RefreshRegions(_ []byte, footprints map[string][]json.RawMessage) error {
	e.refreshed <- footprints
	return nil
}

// germanFootprint is a TentaCron job answer listing one German 3D dataset footprint.
const germanFootprint = `{"state":"completed","result":{"target_status":200,"target_response":` +
	`{"datasets":[{"country":"germany","footprint":{"type":"Polygon","coordinates":[[[8,48],[9,48],[9,49],[8,48]]]}}]}}}`

// A TentaCron that answers every job status request with job.
func fakeTentaCron(t *testing.T, job string) *tentacron.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"r1","state":"received"}`))
			return
		}
		_, _ = w.Write([]byte(job))
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "key")
}

// pylovoRegions is a PyLovo answering /boundary/available with no regions.
func pylovoRegions(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"regions":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// On a fresh stack the first region list comes from PyLovo and is cached; the
// cache must get its 3D coverage then, or the regions show no 3D badge.
func TestGetAvailableRegions_firstLoadAppliesCoverage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cache := &emptyRegionCache{refreshed: make(chan map[string][]json.RawMessage, 1)}
	h := NewPylovoHandler(pylovoRegions(t), cache, nil, city2tabula.NewClient(fakeTentaCron(t, germanFootprint)))

	r := gin.New()
	r.GET("/boundary/available", h.GetAvailableRegions)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boundary/available", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	select {
	case footprints := <-cache.refreshed:
		if len(footprints["germany"]) != 1 {
			t.Fatalf("coverage applied with %v, want one German footprint", footprints)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("3D coverage was not applied after the first region load")
	}
}

// A refresh while City2TABULA cannot list its footprints must leave the cache
// alone: storing PyLovo's regions without them clears every region's 3D mark.
func TestRefreshRegionCache_keepsCacheWithoutFootprints(t *testing.T) {
	cache := &emptyRegionCache{refreshed: make(chan map[string][]json.RawMessage, 1)}
	failed := `{"state":"failed","error":"target timed out"}`
	h := NewPylovoHandler(pylovoRegions(t), cache, nil, city2tabula.NewClient(fakeTentaCron(t, failed)))

	h.refreshRegionCache()

	select {
	case footprints := <-cache.refreshed:
		t.Fatalf("cache refreshed with %v although the footprints were unavailable", footprints)
	default:
	}
}
