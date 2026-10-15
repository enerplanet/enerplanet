package pylovo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// A browser that reloads or navigates away cancels its request, and with it
// the forwarded pylovo call. That is the client leaving, not pylovo failing,
// so it must not be answered or logged as a server error.
func TestForwardToPylovo_cancelledClientIsNotAServerError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pylovo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"sizes":[]}`))
	}))
	defer pylovo.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v2/pylovo/transformer-sizes", nil).WithContext(ctx)

	NewPylovoHandler(pylovo.URL, nil, nil).forwardToPylovo(c, http.MethodGet, "/transformer-sizes", nil)

	if got := c.Writer.Status(); got != 499 {
		t.Fatalf("status = %d, want 499 (client closed request) for a cancelled client request", got)
	}
}

// pylovo itself not answering in time is a server-side failure and stays a 500.
func TestForwardToPylovo_pylovoTimeoutIsAServerError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	release := make(chan struct{})
	pylovo := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { <-release }))
	defer pylovo.Close()
	defer close(release)

	original := pylovoHTTPClient
	pylovoHTTPClient = &http.Client{Timeout: 50 * time.Millisecond}
	defer func() { pylovoHTTPClient = original }()

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v2/pylovo/transformer-sizes", nil)

	NewPylovoHandler(pylovo.URL, nil, nil).forwardToPylovo(c, http.MethodGet, "/transformer-sizes", nil)

	if got := c.Writer.Status(); got != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 when pylovo times out", got)
	}
}
