package main

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/handler/feedback"
	"spatialhub_backend/internal/testutil"
)

// newFeedbackRouter registers the feedback routes on a router whose requests
// carry the given access level. The mock database expects no query, so a
// handler that runs answers 500 rather than the guard's 403.
func newFeedbackRouter(t *testing.T, accessLevel string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, _ := testutil.NewMockDB(t)
	r := gin.New()
	api := r.Group("/api", func(c *gin.Context) {
		c.Set("user_id", "u1")
		c.Set("access_level", accessLevel)
		c.Next()
	})
	registerFeedbackRoutes(api, feedback.NewFeedbackHandler(db, nil))
	return r
}

// Listing, reading, searching, counting, changing and deleting feedback act on
// other users' entries, so only experts may reach them.
func TestFeedbackAdminRoutes_requireExpert(t *testing.T) {
	adminRoutes := []struct{ method, path string }{
		{http.MethodGet, "/api/feedback"},
		{http.MethodGet, "/api/feedback/search"},
		{http.MethodGet, "/api/feedback/stats"},
		{http.MethodGet, "/api/feedback/user/u2"},
		{http.MethodGet, "/api/feedback/7"},
		{http.MethodGet, "/api/feedback/7/run-report"},
		{http.MethodPut, "/api/feedback/7"},
		{http.MethodDelete, "/api/feedback/7"},
	}
	for _, level := range []string{"manager", "intermediate", "very_low"} {
		r := newFeedbackRouter(t, level)
		for _, rt := range adminRoutes {
			assert.Equal(t, http.StatusForbidden, serve(r, rt.method, rt.path), "%s %s as %s", rt.method, rt.path, level)
		}
	}
}

// A user's own feedback list stays open to every signed-in user.
func TestFeedbackMyRoute_isNotExpertOnly(t *testing.T) {
	r := newFeedbackRouter(t, "very_low")
	assert.NotEqual(t, http.StatusForbidden, serve(r, http.MethodGet, "/api/feedback/my"))
}
