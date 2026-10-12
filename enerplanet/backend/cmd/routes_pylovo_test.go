package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/handler/pylovo"
)

// newPylovoRouter registers the PyLovo routes on a router whose requests carry
// the given access level, forwarding to a fake PyLovo that counts its hits.
func newPylovoRouter(t *testing.T, accessLevel string) (*gin.Engine, *int32) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	var hits int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(upstream.Close)

	r := gin.New()
	api := r.Group("/api", func(c *gin.Context) {
		c.Set("user_id", "u1")
		c.Set("access_level", accessLevel)
		c.Next()
	})
	registerPylovoRoutes(api, pylovo.NewPylovoHandler(upstream.URL, nil, nil))
	registerPylovoManagementRoutes(api, pylovo.NewManagementHandler(nil))
	return r, &hits
}

func serve(r *gin.Engine, method, path string) int {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
	return w.Code
}

// PyLovo's pipeline, the PyLovo instance list and the cached-region writes
// change shared data, so only experts may reach them, and a refused request
// never reaches PyLovo.
func TestPylovoAdminRoutes_requireExpert(t *testing.T) {
	adminRoutes := []struct{ method, path string }{
		{http.MethodPost, "/api/v2/pylovo/pipeline/run"},
		{http.MethodGet, "/api/v2/pylovo/pipeline/status/job-1"},
		{http.MethodGet, "/api/v2/pylovo/pipeline/regions"},
		{http.MethodGet, "/api/v2/pylovo/pipeline/history"},
		{http.MethodGet, "/api/v2/pylovo/pipeline/states/germany"},
		{http.MethodDelete, "/api/v2/pylovo/pipeline/states/germany/bremen"},
		{http.MethodGet, "/api/pylovo-services"},
		{http.MethodPost, "/api/pylovo-services"},
		{http.MethodPost, "/api/pylovo-services/1/primary"},
		{http.MethodDelete, "/api/pylovo-services/1"},
		{http.MethodPatch, "/api/v2/pylovo/regions/cached/1"},
		{http.MethodDelete, "/api/v2/pylovo/regions/cached/1"},
	}
	for _, level := range []string{"manager", "intermediate", "very_low"} {
		r, hits := newPylovoRouter(t, level)
		for _, rt := range adminRoutes {
			assert.Equal(t, http.StatusForbidden, serve(r, rt.method, rt.path), "%s %s as %s", rt.method, rt.path, level)
		}
		assert.Zero(t, atomic.LoadInt32(hits), "a refused request must not reach PyLovo (%s)", level)
	}
}

func TestPylovoPipelineRoute_allowsExpert(t *testing.T) {
	r, hits := newPylovoRouter(t, "expert")
	assert.Equal(t, http.StatusOK, serve(r, http.MethodPost, "/api/v2/pylovo/pipeline/run"))
	assert.Equal(t, int32(1), atomic.LoadInt32(hits))
}

// Grid generation and the configurator's other PyLovo calls stay open to
// every signed-in user.
func TestPylovoGridRoutes_openToAllUsers(t *testing.T) {
	r, hits := newPylovoRouter(t, "very_low")
	assert.Equal(t, http.StatusOK, serve(r, http.MethodGet, "/api/v2/pylovo/transformer-sizes"))
	assert.Equal(t, int32(1), atomic.LoadInt32(hits))
}
