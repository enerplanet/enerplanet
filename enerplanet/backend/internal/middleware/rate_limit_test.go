package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func init() { gin.SetMode(gin.TestMode) }

// engineOverQuota returns an engine whose quota is already spent, so the next
// request is the one the limiter would reject.
func engineOverQuota(t *testing.T) *gin.Engine {
	t.Helper()
	t.Setenv("RATE_LIMIT_PER_MIN", "1")

	r := gin.New()
	r.Use(RateLimit())
	r.GET("/known", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
	})

	spend := httptest.NewRecorder()
	r.ServeHTTP(spend, httptest.NewRequest(http.MethodGet, "/known", nil))
	assert.Equal(t, http.StatusOK, spend.Code, "the first request should be within quota")
	return r
}

// TestRateLimit_UnmatchedPathIs404NotThrottled is the reason the limiter skips
// unmatched paths. A client that retries on failure spends its own quota on a
// path that does not exist and then reads 429, which describes the client
// rather than the missing route.
func TestRateLimit_UnmatchedPathIs404NotThrottled(t *testing.T) {
	r := engineOverQuota(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/does-not-exist", nil))

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestRateLimit_MatchedPathStillThrottles keeps the skip above from becoming a
// hole: a real route over quota is still rejected.
func TestRateLimit_MatchedPathStillThrottles(t *testing.T) {
	r := engineOverQuota(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/known", nil))

	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

// TestRateLimit_UnmatchedPathsDoNotSpendQuota covers the second half of the
// same problem: a burst of 404s must not lock a client out of the routes that
// do exist.
func TestRateLimit_UnmatchedPathsDoNotSpendQuota(t *testing.T) {
	t.Setenv("RATE_LIMIT_PER_MIN", "2")

	r := gin.New()
	r.Use(RateLimit())
	r.GET("/known", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.NoRoute(func(c *gin.Context) { c.Status(http.StatusNotFound) })

	for range 5 {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/nope", nil))
		assert.Equal(t, http.StatusNotFound, w.Code)
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/known", nil))
	assert.Equal(t, http.StatusOK, w.Code, "404s should leave the quota untouched")
}
