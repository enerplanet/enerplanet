package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/webservice"
)

// newWebserviceRouter registers the webservice proxy on a router whose requests
// carry the given access level, forwarding to a fake webservice that counts its hits.
func newWebserviceRouter(t *testing.T, accessLevel string) (*gin.Engine, *int32) {
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
	registerWebserviceProxyRoutes(api, webservice.NewClient(upstream.URL))
	return r, &hits
}

var webserviceReads = []struct{ method, path string }{
	{http.MethodGet, "/api/webservices"},
	{http.MethodGet, "/api/webservices/summary"},
	{http.MethodGet, "/api/webservices/1/health"},
}

// Changing a worker's URL, state or existence redirects or stops every user's
// simulations, so only experts may do it.
var webserviceWrites = []struct{ method, path string }{
	{http.MethodPost, "/api/webservices"},
	{http.MethodPut, "/api/webservices/1"},
	{http.MethodDelete, "/api/webservices/1"},
	{http.MethodPost, "/api/webservices/1/unavailable"},
	{http.MethodPost, "/api/webservices/1/request"},
}

func TestWebserviceRoutes_basicUsersAreRefused(t *testing.T) {
	for _, level := range []string{"very_low", "intermediate"} {
		r, hits := newWebserviceRouter(t, level)
		for _, rt := range append(webserviceReads, webserviceWrites...) {
			assert.Equal(t, http.StatusForbidden, serve(r, rt.method, rt.path), "%s %s as %s", rt.method, rt.path, level)
		}
		assert.Zero(t, atomic.LoadInt32(hits), "a refused request must not reach the webservice (%s)", level)
	}
}

func TestWebserviceRoutes_managersReadOnly(t *testing.T) {
	r, hits := newWebserviceRouter(t, "manager")
	for _, rt := range webserviceReads {
		assert.Equal(t, http.StatusOK, serve(r, rt.method, rt.path), "%s %s", rt.method, rt.path)
	}
	for _, rt := range webserviceWrites {
		assert.Equal(t, http.StatusForbidden, serve(r, rt.method, rt.path), "%s %s", rt.method, rt.path)
	}
	assert.Equal(t, int32(len(webserviceReads)), atomic.LoadInt32(hits))
}

func TestWebserviceRoutes_expertsReadAndWrite(t *testing.T) {
	r, hits := newWebserviceRouter(t, "expert")
	for _, rt := range append(webserviceReads, webserviceWrites...) {
		assert.Equal(t, http.StatusOK, serve(r, rt.method, rt.path), "%s %s", rt.method, rt.path)
	}
	assert.Equal(t, int32(len(webserviceReads)+len(webserviceWrites)), atomic.LoadInt32(hits))
}
