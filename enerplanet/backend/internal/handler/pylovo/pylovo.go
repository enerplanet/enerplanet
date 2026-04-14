package pylovo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "spatialhub_backend/internal/api/contracts" // swagger response types
	"spatialhub_backend/internal/models"
	pylovoinstance "spatialhub_backend/internal/store/pylovo_instance"
	regionstore "spatialhub_backend/internal/store/region"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

// RegionCacheStore defines the interface for region caching operations
type RegionCacheStore interface {
	GetAllCachedRegions() ([]models.CachedRegion, error)
	GetEnabledCachedRegions() ([]models.CachedRegion, error)
	UpsertRegionsFromAPI(responseBody []byte) error
	DeleteCachedRegion(id uint) error
	ToggleCachedRegion(id uint, enabled bool) error
}

type PylovoHandler struct {
	baseURL             string
	regionStore         RegionCacheStore
	pylovoInstanceStore *pylovoinstance.Store
}

func NewPylovoHandler(baseURL string, regionStore RegionCacheStore, instanceStore *pylovoinstance.Store) *PylovoHandler {
	return &PylovoHandler{baseURL: baseURL, regionStore: regionStore, pylovoInstanceStore: instanceStore}
}

// resolveBaseURL returns the base URL of the primary pylovo instance from the DB,
// falling back to the configured env var URL if no primary is found.
func (h *PylovoHandler) resolveBaseURL() string {
	if h.pylovoInstanceStore != nil {
		if primary, err := h.pylovoInstanceStore.GetPrimary(); err == nil {
			return primary.BaseURL()
		}
	}
	return h.baseURL
}

const (
	errInvalidPayload       = "Invalid request payload"
	errFailedMarshalPayload = "Failed to marshal payload"
)

var (
	pylovoHTTPClient      = &http.Client{Timeout: constants.HTTPTimeoutPylovo}
	regionRefreshMu       sync.Mutex
	regionRefreshInFlight bool
	regionRefreshLastRun  time.Time
)

const minRegionRefreshInterval = 2 * time.Minute

func (h *PylovoHandler) bindAndForward(c *gin.Context, method, path string) {
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidPayload)
		return
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}
	h.forwardToPylovo(c, method, path, jsonData)
}

func (h *PylovoHandler) bindWithUserAndForward(c *gin.Context, method, path string) {
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidPayload)
		return
	}
	if payload == nil {
		payload = make(map[string]interface{})
	}
	if userCtx, ok := httputil.GetUserContext(c); ok {
		payload["user_id"] = userCtx.UserID
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}
	h.forwardToPylovo(c, method, path, jsonData)
}

func parsePolygonCoords(payload map[string]interface{}) [][]float64 {
	var polygonCoords [][]float64
	coords, ok := payload["polygon"].([]interface{})
	if !ok {
		return polygonCoords
	}
	for _, p := range coords {
		if point, ok := p.([]interface{}); ok && len(point) == 2 {
			polygonCoords = append(polygonCoords, []float64{point[0].(float64), point[1].(float64)})
		}
	}
	return polygonCoords
}

func ensurePolygonClosed(coords [][]float64) [][]float64 {
	if len(coords) == 0 {
		return coords
	}
	first := coords[0]
	last := coords[len(coords)-1]
	if first[0] != last[0] || first[1] != last[1] {
		coords = append(coords, first)
	}
	return coords
}

func buildGeomPayload(payload map[string]interface{}) map[string]interface{} {
	if geom, ok := payload["geom"].(map[string]interface{}); ok {
		return map[string]interface{}{"geom": geom}
	}
	polygonCoords := ensurePolygonClosed(parsePolygonCoords(payload))
	return map[string]interface{}{
		"geom": map[string]interface{}{
			"type":        "Polygon",
			"coordinates": [][][]float64{polygonCoords},
		},
	}
}

func copyBuildingFilterOptions(src, dst map[string]interface{}) {
	filterKeys := []string{"include_public_buildings", "include_private_buildings", "excluded_building_ids", "model_id", "draft_id"}
	for _, key := range filterKeys {
		if val, ok := src[key]; ok {
			dst[key] = val
		}
	}
}

func (h *PylovoHandler) GenerateGrid(c *gin.Context) {
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidPayload)
		return
	}

	pylovoPayload := buildGeomPayload(payload)
	if userCtx, ok := httputil.GetUserContext(c); ok {
		pylovoPayload["user_id"] = userCtx.UserID
	}
	copyBuildingFilterOptions(payload, pylovoPayload)

	jsonData, err := json.Marshal(pylovoPayload)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}

	h.forwardToPylovo(c, http.MethodPost, "/generate-grid", jsonData)
}

func (h *PylovoHandler) GetTransformerSizes(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/transformer-sizes", nil)
}

func (h *PylovoHandler) GetConsumerCategories(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/consumer-categories", nil)
}

func (h *PylovoHandler) GetGridStatistics(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/grid-statistics")
}

func (h *PylovoHandler) GetCableCosts(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/cable-costs")
}

func (h *PylovoHandler) RunPowerFlow(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/power-flow")
}

func (h *PylovoHandler) GetCableTypes(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/cable-types", nil)
}

func (h *PylovoHandler) GetEquipmentCosts(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/equipment-costs", nil)
}

func (h *PylovoHandler) GetVoltageSettings(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/voltage-settings", nil)
}

func (h *PylovoHandler) AddCustomBuilding(c *gin.Context) {
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidPayload)
		return
	}

	if userCtx, ok := httputil.GetUserContext(c); ok {
		payload["user_id"] = userCtx.UserID
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}

	h.forwardToPylovo(c, http.MethodPost, "/add-custom-building", jsonData)
}

func (h *PylovoHandler) GetCustomBuildings(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		httputil.Unauthorized(c, "Unauthorized")
		return
	}
	h.forwardToPylovo(c, http.MethodGet, fmt.Sprintf("/custom-buildings/%s", userCtx.UserID), nil)
}

func (h *PylovoHandler) DeleteCustomBuilding(c *gin.Context) {
	buildingID := c.Param("id")
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		httputil.Unauthorized(c, "Unauthorized")
		return
	}
	h.forwardToPylovo(c, http.MethodDelete, fmt.Sprintf("/custom-buildings/%s?user_id=%s", buildingID, userCtx.UserID), nil)
}

func (h *PylovoHandler) EstimateEnergy(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/estimate-energy")
}

func (h *PylovoHandler) EstimateEnergyBatch(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/estimate-energy-batch")
}

func (h *PylovoHandler) AddTransformer(c *gin.Context) {
	h.bindWithUserAndForward(c, http.MethodPost, "/add-transformer")
}

func (h *PylovoHandler) DeleteTransformer(c *gin.Context) {
	h.bindWithUserAndForward(c, http.MethodPost, "/delete-transformer")
}

func (h *PylovoHandler) MoveTransformer(c *gin.Context) {
	h.bindWithUserAndForward(c, http.MethodPost, "/move-transformer")
}

func (h *PylovoHandler) AssignBuilding(c *gin.Context) {
	h.bindWithUserAndForward(c, http.MethodPost, "/assign-building")
}

func (h *PylovoHandler) FinalizeTransformers(c *gin.Context) {
	h.bindWithUserAndForward(c, http.MethodPost, "/finalize-transformers")
}

func (h *PylovoHandler) forwardToPylovo(c *gin.Context, method string, path string, payload []byte) {
	ctx := c.Request.Context() // no timeout; large models (750+ buildings) need unlimited time

	body, status, err := forwardPylovoRequest(ctx, h.resolveBaseURL(), method, path, payload)
	if err != nil {
		logger.Logger.Errorf("Error contacting Pylovo (%s %s): %v", method, path, err)
		httputil.InternalError(c, "Internal server error")
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		logger.Logger.Warnf("Failed to parse JSON response: %s", string(body))
		httputil.InternalError(c, "Failed to parse response from Pylovo service")
		return
	}

	if status >= http.StatusBadRequest {
		httputil.InternalError(c, fmt.Sprintf("Pylovo service responded with %d", status))
		return
	}

	httputil.SuccessResponse(c, result)
}

func (h *PylovoHandler) RunPipeline(c *gin.Context) {
	h.bindAndForward(c, http.MethodPost, "/pipeline/run")
}

func (h *PylovoHandler) GetPipelineStatus(c *gin.Context) {
	jobID := c.Param("job_id")
	h.forwardToPylovo(c, http.MethodGet, fmt.Sprintf("/pipeline/status/%s", url.PathEscape(jobID)), nil)
}

func (h *PylovoHandler) GetPipelineRegions(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/pipeline/regions", nil)
}

func (h *PylovoHandler) GetPipelineHistory(c *gin.Context) {
	limit := c.Query("limit")
	path := "/pipeline/history"
	if limit != "" {
		path = fmt.Sprintf("/pipeline/history?limit=%s", url.QueryEscape(limit))
	}
	h.forwardToPylovo(c, http.MethodGet, path, nil)
}

func (h *PylovoHandler) GetCountryStates(c *gin.Context) {
	country := c.Param("country")
	versionID := c.Query("version_id")
	path := fmt.Sprintf("/pipeline/states/%s", url.PathEscape(country))
	if versionID != "" {
		path += fmt.Sprintf("?version_id=%s", url.QueryEscape(versionID))
	}
	h.forwardToPylovo(c, http.MethodGet, path, nil)
}

func (h *PylovoHandler) DeleteStateData(c *gin.Context) {
	country := c.Param("country")
	state := c.Param("state")
	dryRun := c.DefaultQuery("dry_run", "false")
	dropStateRow := c.DefaultQuery("drop_state_row", "true")
	path := fmt.Sprintf("/pipeline/states/%s/%s?dry_run=%s&drop_state_row=%s",
		url.PathEscape(country), url.PathEscape(state),
		url.QueryEscape(dryRun), url.QueryEscape(dropStateRow))
	h.forwardToPylovo(c, http.MethodDelete, path, nil)
}
func (h *PylovoHandler) GetCachedRegions(c *gin.Context) {
	regions, err := h.regionStore.GetAllCachedRegions()
	if err != nil {
		httputil.InternalError(c, "Failed to load cached regions")
		return
	}
	httputil.SuccessResponse(c, regions)
}

func (h *PylovoHandler) DeleteCachedRegion(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		httputil.BadRequest(c, "Invalid region ID")
		return
	}
	if err := h.regionStore.DeleteCachedRegion(uint(id)); err != nil {
		httputil.InternalError(c, "Failed to delete cached region")
		return
	}
	httputil.SuccessMessage(c, "Region deleted")
}

func (h *PylovoHandler) ToggleCachedRegion(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		httputil.BadRequest(c, "Invalid region ID")
		return
	}
	var payload struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, "Invalid payload: expected {enabled: bool}")
		return
	}
	if err := h.regionStore.ToggleCachedRegion(uint(id), payload.Enabled); err != nil {
		httputil.InternalError(c, "Failed to toggle region")
		return
	}
	httputil.SuccessMessage(c, "Region updated")
}

// GetBoundary godoc
// @Summary      Get administrative boundary by coordinates
// @Description  Returns the administrative boundary polygon (GeoJSON) for a given lat/lon.
// @Description  This is a public endpoint — no authentication required.
// @Tags         EnerPlanET
// @Produce      json
// @Param        lat          query  number  true   "Latitude"                          example(48.137)
// @Param        lon          query  number  true   "Longitude"                         example(11.575)
// @Param        admin_level  query  int     false  "OSM admin level (default 4)"       default(4)
// @Success      200  {object}  contracts.GetBoundaryResponse
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      500  {object}  contracts.ErrorResponse
// @Router       /v2/pylovo/boundary [get]
func (h *PylovoHandler) GetBoundary(c *gin.Context) {
	lat := c.Query("lat")
	lon := c.Query("lon")
	adminLevel := c.DefaultQuery("admin_level", "4")

	if lat == "" || lon == "" {
		httputil.BadRequest(c, "lat and lon query parameters are required")
		return
	}

	path := fmt.Sprintf("/boundary?lat=%s&lon=%s&admin_level=%s", url.QueryEscape(lat), url.QueryEscape(lon), url.QueryEscape(adminLevel))
	h.forwardToPylovo(c, http.MethodGet, path, nil)
}

func (h *PylovoHandler) GetSupportedRegions(c *gin.Context) {
	h.forwardToPylovo(c, http.MethodGet, "/boundary/regions", nil)
}

func normalizeRegionCountryCode(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func normalizeRegionStateCode(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func sanitizeAvailableRegionsPayload(result map[string]interface{}) {
	regions, ok := result["regions"].([]interface{})
	if !ok {
		return
	}

	filtered := make([]interface{}, 0, len(regions))
	for _, r := range regions {
		rm, ok := r.(map[string]interface{})
		if !ok {
			continue
		}

		gc, hasGC := rm["grid_count"].(float64)
		regionRaw, hasRegion := rm["region"].(map[string]interface{})
		if !hasGC || gc <= 0 || !hasRegion {
			continue
		}

		name, hasName := regionRaw["name"].(string)
		if !hasName || strings.TrimSpace(name) == "" {
			continue
		}

		topCC, _ := rm["country_code"].(string)
		regionCC, _ := regionRaw["country_code"].(string)
		countryCode := normalizeRegionCountryCode(topCC)
		if countryCode == "" {
			countryCode = normalizeRegionCountryCode(regionCC)
		}
		if countryCode == "" {
			continue
		}

		topStateCode, _ := rm["state_code"].(string)
		regionStateCode, _ := regionRaw["state_code"].(string)
		stateCode := normalizeRegionStateCode(topStateCode)
		if stateCode == "" {
			stateCode = normalizeRegionStateCode(regionStateCode)
		}
		if stateCode == "" {
			continue
		}

		rm["country_code"] = countryCode
		rm["state_code"] = stateCode
		regionRaw["country_code"] = countryCode
		regionRaw["state_code"] = stateCode
		filtered = append(filtered, rm)
	}

	result["regions"] = filtered
}

func (h *PylovoHandler) triggerRegionCacheRefresh() {
	if h.regionStore == nil {
		return
	}

	regionRefreshMu.Lock()
	if regionRefreshInFlight || time.Since(regionRefreshLastRun) < minRegionRefreshInterval {
		regionRefreshMu.Unlock()
		return
	}
	regionRefreshInFlight = true
	regionRefreshLastRun = time.Now()
	regionRefreshMu.Unlock()

	go func() {
		defer func() {
			regionRefreshMu.Lock()
			regionRefreshInFlight = false
			regionRefreshMu.Unlock()
		}()
		h.refreshRegionCache()
	}()
}

func (h *PylovoHandler) GetAvailableRegions(c *gin.Context) {
	// Cache-first for fast responses. Refresh cache in background.
	if h.regionStore != nil {
		cachedRegions, cacheErr := h.regionStore.GetEnabledCachedRegions()
		if cacheErr != nil {
			logger.Logger.Warnf("Failed to read cached regions: %v", cacheErr)
		} else if len(cachedRegions) > 0 {
			if data, ok := buildCachedRegionsJSON(cachedRegions); ok {
				httputil.SuccessResponse(c, data)
				h.triggerRegionCacheRefresh()
				return
			}
		}
	}

	// No cache available (or cache unreadable): fetch live data.
	ctx := c.Request.Context() // no timeout; large models need unlimited time
	resolvedURL := h.resolveBaseURL()
	body, status, err := forwardPylovoRequest(ctx, resolvedURL, http.MethodGet, "/boundary/available", nil)
	if err != nil {
		logger.Logger.Errorf("Error contacting Pylovo (GET /boundary/available): %v (baseURL=%s)", err, resolvedURL)
		httputil.InternalError(c, fmt.Sprintf("Pylovo service unreachable: %v", err))
		return
	}
	if status >= http.StatusBadRequest {
		logger.Logger.Errorf("Pylovo (GET /boundary/available) responded with status %d: %s", status, string(body))
		httputil.InternalError(c, fmt.Sprintf("Pylovo service responded with %d", status))
		return
	}

	var result map[string]interface{}
	if unmarshalErr := json.Unmarshal(body, &result); unmarshalErr != nil {
		logger.Logger.Warnf("Failed to parse JSON response from Pylovo: %s", string(body))
		httputil.InternalError(c, "Failed to parse response from Pylovo service")
		return
	}

	sanitizeAvailableRegionsPayload(result)
	httputil.SuccessResponse(c, result)

	if h.regionStore != nil {
		go func() {
			if cacheErr := h.regionStore.UpsertRegionsFromAPI(body); cacheErr != nil {
				logger.Logger.Warnf("Failed to cache regions: %v", cacheErr)
			}
		}()
	}
}

// buildCachedRegionsJSON converts cached regions to the response data payload.
func buildCachedRegionsJSON(regions []models.CachedRegion) (interface{}, bool) {
	responseBytes, err := regionstore.BuildAvailableRegionsResponse(regions)
	if err != nil {
		logger.Logger.Warnf("Failed to build cached regions response: %v", err)
		return nil, false
	}
	var wrapper map[string]interface{}
	if err := json.Unmarshal(responseBytes, &wrapper); err != nil {
		logger.Logger.Warnf("Failed to unmarshal cached regions response: %v", err)
		return nil, false
	}
	data, ok := wrapper["data"]
	if !ok {
		logger.Logger.Warn("Cached regions response missing 'data' key")
		return nil, false
	}
	return data, true
}

// refreshRegionCache fetches regions from PyLovo and updates the DB cache
func (h *PylovoHandler) refreshRegionCache() {
	ctx := context.Background() // no timeout; large models need unlimited time

	body, status, err := forwardPylovoRequest(ctx, h.resolveBaseURL(), http.MethodGet, "/boundary/available", nil)
	if err != nil {
		logger.Logger.Warnf("Background region cache refresh failed: %v", err)
		return
	}
	if status >= http.StatusBadRequest {
		logger.Logger.Warnf("Background region cache refresh got status %d", status)
		return
	}

	if err := h.regionStore.UpsertRegionsFromAPI(body); err != nil {
		logger.Logger.Warnf("Failed to update region cache: %v", err)
	}
}

func forwardPylovoRequest(ctx context.Context, baseURL string, method string, path string, payload []byte) ([]byte, int, error) {
	url := fmt.Sprintf("%s%s", baseURL, path)
	var body io.Reader
	if payload != nil {
		body = bytes.NewBuffer(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, 0, err
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := pylovoHTTPClient.Do(req)
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
