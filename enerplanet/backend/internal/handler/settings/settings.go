package settings

import (
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	backendModels "spatialhub_backend/internal/models"
	settingsStore "spatialhub_backend/internal/store/settings"

	"github.com/gin-gonic/gin"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"gorm.io/gorm"
)

const (
	errInvalidRequestData = "Invalid request data"
)

type SettingsHandler struct {
	store *settingsStore.Store
}

func NewSettingsHandler(db *gorm.DB) *SettingsHandler {
	return &SettingsHandler{store: settingsStore.NewStore(db)}
}

func (h *SettingsHandler) GetUserSettings(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	settings, err := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch settings")
		return
	}

	httputil.SuccessResponse(c, settings)
}

func (h *SettingsHandler) UpdatePrivacyAccepted(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req struct {
		Accepted bool `json:"accepted"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, _ := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	settings.PrivacyAccepted = req.Accepted
	if err := h.store.SaveUserSettings(settings); err != nil {
		httputil.InternalError(c, "Failed to save settings")
		return
	}

	httputil.SuccessMessage(c, "Privacy updated")
}

func (h *SettingsHandler) UpdateProductTourCompleted(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req struct {
		Completed bool `json:"completed"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, _ := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	settings.ProductTourCompleted = req.Completed
	if err := h.store.SaveUserSettings(settings); err != nil {
		httputil.InternalError(c, "Failed to save settings")
		return
	}

	httputil.SuccessMessage(c, "Tour status updated")
}

// updateLocationSetting is a helper function to update location settings (map or weather)
func (h *SettingsHandler) updateLocationSetting(c *gin.Context, jsonKey, successMsg string, updateFn func(*models.UserSetting, *string)) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, _ := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)

	location := req[jsonKey]
	if location == "" {
		updateFn(settings, nil)
	} else {
		updateFn(settings, &location)
	}

	if err := h.store.SaveUserSettings(settings); err != nil {
		httputil.InternalError(c, "Failed to save settings")
		return
	}
	httputil.SuccessMessage(c, successMsg)
}

func (h *SettingsHandler) UpdateMapLocation(c *gin.Context) {
	h.updateLocationSetting(c, "map_location", "Map location updated",
		func(s *models.UserSetting, val *string) { s.MapLocation = val })
}

func (h *SettingsHandler) UpdateWeatherLocation(c *gin.Context) {
	h.updateLocationSetting(c, "weather_location", "Weather location updated",
		func(s *models.UserSetting, val *string) { s.WeatherLocation = val })
}

func (h *SettingsHandler) UpdateTheme(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req struct {
		Theme string `json:"theme"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, _ := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	settings.Theme = req.Theme
	if err := h.store.SaveUserSettings(settings); err != nil {
		httputil.InternalError(c, "Failed to save settings")
		return
	}

	httputil.SuccessMessage(c, "Theme updated")
}

func (h *SettingsHandler) UpdateLanguage(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req struct {
		Language string `json:"language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, _ := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	settings.Language = req.Language
	if err := h.store.SaveUserSettings(settings); err != nil {
		httputil.InternalError(c, "Failed to save settings")
		return
	}

	httputil.SuccessMessage(c, "Language updated")
}

func (h *SettingsHandler) UpdateSettings(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	settings, err := h.store.GetOrCreateUserSettings(userCtx.UserID, userCtx.Email)
	if err != nil {
		httputil.InternalError(c, "Failed to get settings")
		return
	}

	// Update fields that are present in the request
	updates := make(map[string]interface{})

	if val, ok := req["onboarding_completed"].(bool); ok {
		updates["onboarding_completed"] = val
	}
	if val, ok := req["privacy_accepted"].(bool); ok {
		updates["privacy_accepted"] = val
	}
	if val, ok := req["product_tour_completed"].(bool); ok {
		updates["product_tour_completed"] = val
	}
	if val, ok := req["area_select_tour_completed"].(bool); ok {
		updates["area_select_tour_completed"] = val
	}
	if val, ok := req["theme"].(string); ok {
		updates["theme"] = val
	}
	if val, ok := req["language"].(string); ok {
		updates["language"] = val
	}
	if val, ok := req["email_notifications"].(bool); ok {
		updates["email_notifications"] = val
	}
	if val, ok := req["browser_notifications"].(bool); ok {
		updates["browser_notifications"] = val
	}

	if len(updates) > 0 {
		if err := h.store.UpdateUserSettingsPartial(settings, updates); err != nil {
			httputil.InternalError(c, "Failed to update settings")
			return
		}
	}

	httputil.SuccessMessage(c, "Settings updated")
}

func (h *SettingsHandler) DeleteAllSettings(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	h.store.DeleteUserSettings(userID)
	httputil.SuccessMessage(c, "Settings deleted")
}

// GetPolygonLimits returns all polygon limits for all access levels
func (h *SettingsHandler) GetPolygonLimits(c *gin.Context) {
	limits, err := h.store.GetAllPolygonLimits()
	if err != nil {
		httputil.InternalError(c, "Failed to fetch polygon limits")
		return
	}

	// Convert to map for easier frontend consumption
	// Start with defaults, then override with database values
	limitsMap := make(map[string]int)
	for level, defaultLimit := range backendModels.DefaultPolygonLimits {
		limitsMap[level] = defaultLimit
	}
	for _, limit := range limits {
		limitsMap[limit.AccessLevel] = limit.BuildingLimit
	}

	httputil.SuccessResponse(c, limitsMap)
}

// GetMyPolygonLimit returns the polygon limit for the current user's access level
func (h *SettingsHandler) GetMyPolygonLimit(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	accessLevel := userCtx.AccessLevel
	if accessLevel == "" {
		accessLevel = backendModels.AccessLevelVeryLow
	}

	var limit backendModels.PolygonLimit
	polyLimit, err := h.store.GetPolygonLimitByAccessLevel(accessLevel)
	if err != nil {
		// Return default if not found
		defaultLimit := backendModels.DefaultPolygonLimits[accessLevel]
		httputil.SuccessResponse(c, map[string]interface{}{
			"access_level":   accessLevel,
			"building_limit": defaultLimit,
		})
		return
	}
	limit = *polyLimit

	httputil.SuccessResponse(c, limit)
}

// upsertFn is a function that upserts a single limit within a transaction
type upsertFn func(tx *gorm.DB, accessLevel string, limit int) error

// validAccessLevels is the set of valid access levels for limit operations
var validAccessLevels = map[string]bool{
	backendModels.AccessLevelVeryLow:      true,
	backendModels.AccessLevelIntermediate: true,
	backendModels.AccessLevelManager:      true,
	backendModels.AccessLevelExpert:       true,
}

// UpdatePolygonLimit updates the polygon limit for a specific access level (experts only)
func (h *SettingsHandler) UpdatePolygonLimit(c *gin.Context) {
	h.updateSingleLimit(c, "polygon limit", "building_limit", h.store.UpsertPolygonLimit)
}

// UpdateModelLimit updates the model limit for a specific access level (experts only)
func (h *SettingsHandler) UpdateModelLimit(c *gin.Context) {
	h.updateSingleLimit(c, "model limit", "model_limit", h.store.UpsertModelLimit)
}

// updateSingleLimit handles the common pattern of updating a single access-level limit
func (h *SettingsHandler) updateSingleLimit(c *gin.Context, limitName, jsonField string, upsert upsertFn) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if userCtx.AccessLevel != backendModels.AccessLevelExpert {
		httputil.Forbidden(c, "Only experts can update "+limitName+"s")
		return
	}

	var req struct {
		AccessLevel string `json:"access_level" binding:"required"`
		Limit       int    `json:"limit" binding:"gte=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if !validAccessLevels[req.AccessLevel] {
		httputil.BadRequest(c, "Invalid access level")
		return
	}

	tx := h.store.BeginTx()
	if err := upsert(tx, req.AccessLevel, req.Limit); err != nil {
		tx.Rollback()
		httputil.InternalError(c, "Failed to update "+limitName)
		return
	}
	if err := tx.Commit().Error; err != nil {
		httputil.InternalError(c, "Failed to save "+limitName)
		return
	}

	httputil.SuccessMessage(c, cases.Title(language.English).String(limitName)+" updated")
}

// UpdatePolygonLimits updates all polygon limits at once (experts only)
func (h *SettingsHandler) UpdatePolygonLimits(c *gin.Context) {
	h.updateBatchLimits(c, "polygon limits", "building limit", h.store.UpsertPolygonLimit)
}

// GetModelLimits returns all model limits for all access levels
func (h *SettingsHandler) GetModelLimits(c *gin.Context) {
	limits, err := h.store.GetAllModelLimits()
	if err != nil {
		httputil.InternalError(c, "Failed to fetch model limits")
		return
	}

	// Convert to map for easier frontend consumption
	// Start with defaults, then override with database values
	limitsMap := make(map[string]int)
	for level, defaultLimit := range backendModels.DefaultModelLimits {
		limitsMap[level] = defaultLimit
	}
	for _, limit := range limits {
		limitsMap[limit.AccessLevel] = limit.ModelLimit
	}

	httputil.SuccessResponse(c, limitsMap)
}

// GetMyModelLimit returns the model limit for the current user's access level along with usage
func (h *SettingsHandler) GetMyModelLimit(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	accessLevel := userCtx.AccessLevel
	if accessLevel == "" {
		accessLevel = backendModels.AccessLevelVeryLow
	}

	// Get the effective limit (check user custom limit first, then access level default)
	effectiveLimit := h.getEffectiveModelLimit(accessLevel)

	// Count current usage (non-deleted models owned by user)
	currentUsage, _ := h.store.CountUserModels(userCtx.UserID)

	// Calculate remaining
	remaining := effectiveLimit - int(currentUsage)
	if effectiveLimit == 0 {
		// Unlimited
		remaining = -1 // -1 indicates unlimited
	} else if remaining < 0 {
		remaining = 0
	}

	httputil.SuccessResponse(c, map[string]interface{}{
		"access_level":    accessLevel,
		"model_limit":     effectiveLimit,
		"current_usage":   currentUsage,
		"remaining":       remaining,
		"is_unlimited":    effectiveLimit == 0,
	})
}

// getEffectiveModelLimit returns the effective model limit for a user
// It first checks for a custom user attribute, then falls back to access level default
func (h *SettingsHandler) getEffectiveModelLimit(accessLevel string) int {
	// For now, just return the access level default
	// Custom per-user limits will be handled via Keycloak attributes in user management
	limit, err := h.store.GetModelLimitByAccessLevel(accessLevel)
	if err != nil {
		// Return default if not found in database
		return backendModels.DefaultModelLimits[accessLevel]
	}
	return limit.ModelLimit
}

// UpdateModelLimits updates all model limits at once (experts only)
func (h *SettingsHandler) UpdateModelLimits(c *gin.Context) {
	h.updateBatchLimits(c, "model limits", "model limit", h.store.UpsertModelLimit)
}

// updateBatchLimits handles the common pattern of updating all limits at once
func (h *SettingsHandler) updateBatchLimits(c *gin.Context, limitName, itemName string, upsert upsertFn) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if userCtx.AccessLevel != backendModels.AccessLevelExpert {
		httputil.Forbidden(c, "Only experts can update "+limitName)
		return
	}

	var req map[string]int
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	tx := h.store.BeginTx()
	for accessLevel, limit := range req {
		if !validAccessLevels[accessLevel] {
			tx.Rollback()
			httputil.BadRequest(c, "Invalid access level: "+accessLevel)
			return
		}
		if limit < 0 {
			tx.Rollback()
			httputil.BadRequest(c, cases.Title(language.English).String(itemName)+" cannot be negative")
			return
		}

		if err := upsert(tx, accessLevel, limit); err != nil {
			tx.Rollback()
			httputil.InternalError(c, "Failed to update "+limitName)
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		httputil.InternalError(c, "Failed to save "+limitName)
		return
	}

	httputil.SuccessMessage(c, cases.Title(language.English).String(limitName)+" updated")
}
