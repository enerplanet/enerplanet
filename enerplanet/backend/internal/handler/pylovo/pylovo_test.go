package pylovo

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pylovo/transformer-sizes", nil).WithContext(ctx)

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
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pylovo/transformer-sizes", nil)

	NewPylovoHandler(pylovo.URL, nil, nil).forwardToPylovo(c, http.MethodGet, "/transformer-sizes", nil)

	if got := c.Writer.Status(); got != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 when pylovo times out", got)
	}
}

// Custom locations are private to their owner, so a grid request never asks
// pylovo for other users' public buildings, whatever the client sends.
func TestCopyBuildingFilterOptions_dropsPublicBuildings(t *testing.T) {
	src := map[string]interface{}{
		"include_public_buildings":  true,
		"include_private_buildings": true,
		"excluded_building_ids":     []interface{}{"custom_1"},
	}
	dst := map[string]interface{}{}

	copyBuildingFilterOptions(src, dst)

	if _, ok := dst["include_public_buildings"]; ok {
		t.Errorf("include_public_buildings forwarded to pylovo: %v", dst)
	}
	if dst["include_private_buildings"] != true || dst["excluded_building_ids"] == nil {
		t.Errorf("private filter options not forwarded: %v", dst)
	}
}

// serveGenerateGrid posts body to GenerateGrid and returns the response and
// every request body pylovo received.
func serveGenerateGrid(t *testing.T, body string) (*httptest.ResponseRecorder, []string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	var received []string
	pylovo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		received = append(received, string(b))
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	t.Cleanup(pylovo.Close)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "owner") }) // the auth middleware does this in production
	r.POST("/generate-grid", NewPylovoHandler(pylovo.URL, nil, nil).GenerateGrid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/generate-grid", strings.NewReader(body)))
	return rec, received
}

// An area that is not a valid polygon is refused with the reason and never reaches pylovo.
func TestGenerateGrid_rejectsInvalidAreaBeforePylovo(t *testing.T) {
	for name, body := range map[string]string{
		"latitude out of range": `{"geom":{"type":"Polygon","coordinates":[[[12.9,95],[13,48],[13,49]]]}}`,
		"wrong geometry type":   `{"geom":{"type":"Point","coordinates":[12.9,48.8]}}`,
		"malformed polygon":     `{"polygon":[["x",1],[2,2],[3,3]]}`,
	} {
		rec, received := serveGenerateGrid(t, body)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid area geometry") || len(received) != 0 {
			t.Errorf("%s: status %d body %s, pylovo got %d requests; want 400 and none", name, rec.Code, rec.Body, len(received))
		}
	}
}

// A body over the cap is refused as too large.
func TestGenerateGrid_rejectsOversizedBody(t *testing.T) {
	rec, received := serveGenerateGrid(t, `{"pad":"`+strings.Repeat("x", maxAreaRequestBytes)+`"}`)
	if rec.Code != http.StatusRequestEntityTooLarge || len(received) != 0 {
		t.Fatalf("status %d, pylovo got %d requests; want 413 and none", rec.Code, len(received))
	}
}

// pylovo receives the geometry rebuilt by validation, not the client's text.
func TestGenerateGrid_forwardsValidatedArea(t *testing.T) {
	rec, received := serveGenerateGrid(t, `{"geom":{"type":"Polygon","coordinates":[[[12.95,48.83,300],[12.96,48.83,300],[12.96,48.84,300]]]}}`)
	if rec.Code != http.StatusOK || len(received) != 1 || !strings.Contains(received[0], `"geom":{"type":"Polygon","coordinates":[[[12.95,48.83],[12.96,48.83],[12.96,48.84]]]}`) {
		t.Fatalf("status %d, pylovo got %v; want the area without altitudes", rec.Code, received)
	}
}

// The count route validates the area like generate-grid and sends pylovo only
// the rebuilt geometry.
func TestCountBuildings_forwardsValidatedAreaOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var received []string
	pylovo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		received = append(received, r.URL.Path+" "+string(b))
		_, _ = w.Write([]byte(`{"count":312}`))
	}))
	t.Cleanup(pylovo.Close)
	r := gin.New()
	r.POST("/building-count", NewPylovoHandler(pylovo.URL, nil, nil).CountBuildings)
	serve := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/building-count", strings.NewReader(body)))
		return rec
	}

	if rec := serve(`{"geom":{"type":"Point","coordinates":[12.9,48.8]}}`); rec.Code != http.StatusBadRequest || len(received) != 0 {
		t.Fatalf("invalid area: status %d, pylovo got %v; want 400 and nothing", rec.Code, received)
	}
	rec := serve(`{"geom":{"type":"Polygon","coordinates":[[[12.95,48.83],[12.96,48.83],[12.96,48.84]]]},"user_id":"x"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"count":312`) {
		t.Fatalf("status %d body %s; want 200 with the count", rec.Code, rec.Body)
	}
	if len(received) != 1 || received[0] != `/building-count {"geom":{"type":"Polygon","coordinates":[[[12.95,48.83],[12.96,48.83],[12.96,48.84]]]}}` {
		t.Errorf("pylovo got %v; want only the validated geometry", received)
	}
}

func TestForwardPylovoError(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name       string
		status     int
		body       string
		wantStatus int
		wantBody   string
	}{
		{"not found passes through with detail", http.StatusNotFound, `{"detail":"Grid not found"}`,
			http.StatusNotFound, `{"error":"Grid not found"}`},
		{"bad request passes through with detail", http.StatusBadRequest, `{"detail":"Invalid coordinates"}`,
			http.StatusBadRequest, `{"error":"Invalid coordinates"}`},
		{"422 with list detail falls back to generic", http.StatusUnprocessableEntity, `{"detail":[{"loc":["body"]}]}`,
			http.StatusUnprocessableEntity, `{"error":"Pylovo service responded with 422"}`},
		{"401 is clamped to 500", http.StatusUnauthorized, `{"detail":"Not authenticated"}`,
			http.StatusInternalServerError, `{"error":"Pylovo service responded with 401"}`},
		{"502 is clamped to 500", http.StatusBadGateway, `{"detail":"upstream down"}`,
			http.StatusInternalServerError, `{"error":"Pylovo service responded with 502"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)

			forwardPylovoError(c, tc.status, []byte(tc.body))

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if rec.Body.String() != tc.wantBody {
				t.Errorf("body = %s, want %s", rec.Body.String(), tc.wantBody)
			}
		})
	}
}
