package location

import (
	"log"

	"platform.local/common/pkg/httputil"
	"spatialhub_backend/internal/models"
	locationstore "spatialhub_backend/internal/store/location"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// LocationShareHandler handles HTTP requests for location sharing
type LocationShareHandler struct {
	locationStore      *locationstore.Store
	locationShareStore *locationstore.ShareStore
}

// NewLocationShareHandler creates a new LocationShareHandler instance
func NewLocationShareHandler(db *gorm.DB) *LocationShareHandler {
	return &LocationShareHandler{
		locationStore:      locationstore.NewStore(db),
		locationShareStore: locationstore.NewShareStore(db),
	}
}

// checkLocationOwnership verifies the user owns the location
func (h *LocationShareHandler) checkLocationOwnership(c *gin.Context, locationID uint, userID string) (*models.CustomLocation, bool) {
	location, err := h.locationStore.GetLocationByID(locationID)
	if err != nil {
		httputil.NotFound(c, "Location not found")
		return nil, false
	}

	if location.UserID != userID {
		httputil.Forbidden(c, "You do not have permission to share this location")
		return nil, false
	}

	return location, true
}

// ShareWithUser shares a location with a specific user
func (h *LocationShareHandler) ShareWithUser(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	locationID, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	// Check ownership
	if _, ok := h.checkLocationOwnership(c, locationID, userCtx.UserID); !ok {
		return
	}

	var req models.ShareLocationWithUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "Invalid request data", err.Error())
		return
	}

	log.Printf("ShareWithUser: sharing location %d with %s", locationID, req.Email)

	// TODO: Look up user ID by email if they exist in the system
	// For now, we just store the email
	userID := ""

	share, err := h.locationShareStore.ShareWithUser(locationID, req.Email, userID, req.Permission, userCtx.UserID)
	if err != nil {
		log.Printf("ShareWithUser: error: %v", err)
		httputil.InternalError(c, "Failed to share location")
		return
	}

	httputil.Created(c, gin.H{
		"message": "Location shared successfully",
		"share":   share,
	})
}

// ShareWithWorkspace shares a location with a workspace
func (h *LocationShareHandler) ShareWithWorkspace(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	locationID, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	// Check ownership
	if _, ok := h.checkLocationOwnership(c, locationID, userCtx.UserID); !ok {
		return
	}

	var req models.ShareLocationWithWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "Invalid request data", err.Error())
		return
	}

	log.Printf("ShareWithWorkspace: sharing location %d with workspace %d", locationID, req.WorkspaceID)

	share, err := h.locationShareStore.ShareWithWorkspace(locationID, req.WorkspaceID, req.Permission, userCtx.UserID)
	if err != nil {
		log.Printf("ShareWithWorkspace: error: %v", err)
		httputil.InternalError(c, "Failed to share location with workspace")
		return
	}

	httputil.Created(c, gin.H{
		"message": "Location shared with workspace successfully",
		"share":   share,
	})
}

// ShareWithGroup shares a location with a user group
func (h *LocationShareHandler) ShareWithGroup(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	locationID, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	// Check ownership
	if _, ok := h.checkLocationOwnership(c, locationID, userCtx.UserID); !ok {
		return
	}

	var req models.ShareLocationWithGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "Invalid request data", err.Error())
		return
	}

	log.Printf("ShareWithGroup: sharing location %d with group %s", locationID, req.GroupID)

	share, err := h.locationShareStore.ShareWithGroup(locationID, req.GroupID, req.Permission, userCtx.UserID)
	if err != nil {
		log.Printf("ShareWithGroup: error: %v", err)
		httputil.InternalError(c, "Failed to share location with group")
		return
	}

	httputil.Created(c, gin.H{
		"message": "Location shared with group successfully",
		"share":   share,
	})
}

// GetShares returns all shares for a location
func (h *LocationShareHandler) GetShares(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	locationID, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	// Check ownership
	if _, ok := h.checkLocationOwnership(c, locationID, userCtx.UserID); !ok {
		return
	}

	shares, err := h.locationShareStore.GetLocationShares(locationID)
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve shares")
		return
	}

	httputil.SuccessResponse(c, shares)
}

// RemoveUserShare removes a user share from a location
func (h *LocationShareHandler) RemoveUserShare(c *gin.Context) {
	h.removeShare(c, "user", h.locationShareStore.RemoveUserShare)
}

// RemoveWorkspaceShare removes a workspace share from a location
func (h *LocationShareHandler) RemoveWorkspaceShare(c *gin.Context) {
	h.removeShare(c, "workspace", h.locationShareStore.RemoveWorkspaceShare)
}

// RemoveGroupShare removes a group share from a location
func (h *LocationShareHandler) RemoveGroupShare(c *gin.Context) {
	h.removeShare(c, "group", h.locationShareStore.RemoveGroupShare)
}

// removeShare is a helper that handles the common remove-share flow
func (h *LocationShareHandler) removeShare(c *gin.Context, shareType string, removeFn func(uint, uint) error) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	locationID, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	shareID, ok := httputil.ParseUintParam(c, "shareId", "Invalid share ID")
	if !ok {
		return
	}

	if _, ok := h.checkLocationOwnership(c, locationID, userCtx.UserID); !ok {
		return
	}

	if err := removeFn(locationID, shareID); err != nil {
		httputil.HandleError(c, err)
		return
	}

	httputil.SuccessMessage(c, "Share removed successfully")
}
