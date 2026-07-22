// Package ignis proxies requests to the ignis heat-demand microservice
// (THD-Spatial-AI/ignis), which calculates annual heating energy demand
// from TABULA building typology data.
package ignis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

// IgnisHandler proxies HTTP requests to the ignis service and reshapes
// its responses for EnerPlanET clients.
type IgnisHandler struct {
	baseURL string
}

// NewIgnisHandler creates a handler that forwards requests to the ignis
// instance at baseURL.
func NewIgnisHandler(baseURL string) *IgnisHandler {
	return &IgnisHandler{baseURL: baseURL}
}

// HTTPTimeoutComputeEngine (10s, GitLab infrastructure submodule) is not yet
// present in this repo's infrastructure-utilities pin; HTTPTimeoutDefault is
// the same 10s value and is used here until the submodule catches up.
var ignisHTTPClient = &http.Client{Timeout: constants.HTTPTimeoutDefault}

// forwardIgnisRequest sends method/path to baseURL and returns the raw response body and status code.
func forwardIgnisRequest(ctx context.Context, baseURL, method, path string, payload []byte) ([]byte, int, error) {
	reqURL := fmt.Sprintf("%s%s", baseURL, path)
	var body io.Reader
	if payload != nil {
		body = bytes.NewBuffer(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, 0, err
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := ignisHTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	return respBody, resp.StatusCode, nil
}

// forwardToIgnis forwards a request to ignis and writes the (unmarshalled) JSON response
// back onto c, wrapped in the standard success envelope.
func (h *IgnisHandler) forwardToIgnis(c *gin.Context, method, path string, payload []byte) {
	body, status, err := forwardIgnisRequest(c.Request.Context(), h.baseURL, method, path, payload)
	if err != nil {
		logger.Logger.Errorf("Error contacting ignis (%s %s): %v", method, path, err)
		httputil.InternalError(c, "Internal server error")
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		logger.Logger.Warnf("Failed to parse JSON response from ignis: %s", string(body))
		httputil.InternalError(c, "Failed to parse response from ignis service")
		return
	}

	if status >= http.StatusBadRequest {
		httputil.InternalError(c, fmt.Sprintf("ignis service responded with %d", status))
		return
	}

	httputil.SuccessResponse(c, result)
}

// GetVariants lists all TABULA variant codes for a country.
// GET /v2/ignis/variants/:country_iso2 -> ignis GET /api/v1/variants/:country_iso2
func (h *IgnisHandler) GetVariants(c *gin.Context) {
	countryIso2 := c.Param("country_iso2")
	path := fmt.Sprintf("/api/v1/variants/%s", url.PathEscape(countryIso2))
	h.forwardToIgnis(c, http.MethodGet, path, nil)
}

// MatchVariants lists the refurbishment-level variants for a building type and construction period.
// GET /v2/ignis/variants/:country_iso2/match?type=&period= -> ignis GET /api/v1/variants/:country_iso2/match?type=&period=
func (h *IgnisHandler) MatchVariants(c *gin.Context) {
	countryIso2 := c.Param("country_iso2")
	buildingType := c.Query("type")
	period := c.Query("period")

	if buildingType == "" || period == "" {
		httputil.BadRequest(c, "type and period query parameters are required")
		return
	}

	path := fmt.Sprintf("/api/v1/variants/%s/match?type=%s&period=%s",
		url.PathEscape(countryIso2), url.QueryEscape(buildingType), url.QueryEscape(period))
	h.forwardToIgnis(c, http.MethodGet, path, nil)
}

// CalculateHeatDemand runs the ISO 13790 pipeline for a TABULA variant code.
// POST /v2/ignis/calculate/:code -> ignis POST /api/v1/calculate/:code
// The request body is optional ({"A_ref": 150.0} overrides the reference floor area);
// an empty or absent body is forwarded as-is.
func (h *IgnisHandler) CalculateHeatDemand(c *gin.Context) {
	code := c.Param("code")
	path := fmt.Sprintf("/api/v1/calculate/%s", url.PathEscape(code))

	var payload []byte
	raw, err := io.ReadAll(c.Request.Body)
	if err == nil && len(raw) > 0 {
		payload = raw
	}

	h.forwardToIgnis(c, http.MethodPost, path, payload)
}
