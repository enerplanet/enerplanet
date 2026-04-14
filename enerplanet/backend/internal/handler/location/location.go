package location

import (
	"log"

	"platform.local/common/pkg/httputil"
	"spatialhub_backend/internal/models"
	locationstore "spatialhub_backend/internal/store/location"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	errInvalidLocationID       = "Invalid location ID"
	errFailedRetrieveLocations = "Failed to retrieve locations"
)

// LocationHandler handles HTTP requests for custom locations
type LocationHandler struct {
	locationStore *locationstore.Store
}

// NewLocationHandler creates a new LocationHandler instance
func NewLocationHandler(db *gorm.DB) *LocationHandler {
	return &LocationHandler{locationStore: locationstore.NewStore(db)}
}

func parsePagination(c *gin.Context) locationstore.PaginationParams {
	params := httputil.ParsePagination(c, nil)
	return locationstore.PaginationParams{Page: params.Page, PerPage: params.PerPage}
}

func parseFilters(c *gin.Context) locationstore.Filters {
	var isPublic *bool
	if c.Query("is_public") == "true" {
		t := true
		isPublic = &t
	} else if c.Query("is_public") == "false" {
		f := false
		isPublic = &f
	}

	return locationstore.Filters{
		FClass:   c.Query("f_class"),
		IsPublic: isPublic,
		Status:   c.Query("status"),
	}
}

// CreateLocation creates a new custom location
func (h *LocationHandler) CreateLocation(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var req models.CustomLocationCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreateLocation: binding error: %v", err)
		httputil.BadRequestWithDetails(c, "Invalid request data", err.Error())
		return
	}

	log.Printf("CreateLocation: creating location for user %s, title: %s", userCtx.UserID, req.Title)

	location, err := h.locationStore.CreateLocation(userCtx.UserID, &req)
	if err != nil {
		log.Printf("CreateLocation: store error: %v", err)
		c.JSON(500, gin.H{"success": false, "error": err.Error()})
		return
	}

	log.Printf("CreateLocation: success, id: %d", location.ID)
	httputil.Created(c, gin.H{
		"message":  "Location created successfully",
		"location": location,
	})
}

// GetLocation retrieves a single location by ID
func (h *LocationHandler) GetLocation(c *gin.Context) {
	id, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	location, err := h.locationStore.GetLocationByID(id)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}

	httputil.SuccessResponse(c, location)
}

// GetUserLocations retrieves all locations for the current user
func (h *LocationHandler) GetUserLocations(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	result, err := h.locationStore.GetUserLocations(userCtx.UserID, parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, errFailedRetrieveLocations)
		return
	}

	httputil.SuccessResponse(c, result)
}

// GetPublicLocations retrieves all public locations
func (h *LocationHandler) GetPublicLocations(c *gin.Context) {
	result, err := h.locationStore.GetPublicLocations(parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve public locations")
		return
	}

	httputil.SuccessResponse(c, result)
}

// GetAllAccessibleLocations retrieves all locations accessible to the current user
func (h *LocationHandler) GetAllAccessibleLocations(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	result, err := h.locationStore.GetAllAccessibleLocations(userCtx.UserID, parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, errFailedRetrieveLocations)
		return
	}

	httputil.SuccessResponse(c, result)
}

// UpdateLocation updates an existing location
func (h *LocationHandler) UpdateLocation(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	var req models.CustomLocationUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "Invalid request data", err.Error())
		return
	}

	location, err := h.locationStore.UpdateLocation(id, userCtx.UserID, &req)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}

	httputil.SuccessResponse(c, gin.H{
		"message":  "Location updated successfully",
		"location": location,
	})
}

// DeleteLocation soft-deletes a location
func (h *LocationHandler) DeleteLocation(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	if err := h.locationStore.DeleteLocation(id, userCtx.UserID); err != nil {
		httputil.HandleError(c, err)
		return
	}

	httputil.SuccessMessage(c, "Location deleted successfully")
}

// CopyLocation creates a copy of an existing location
func (h *LocationHandler) CopyLocation(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidLocationID)
	if !ok {
		return
	}

	location, err := h.locationStore.CopyLocation(id, userCtx.UserID)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}

	httputil.Created(c, gin.H{
		"message":  "Location copied successfully",
		"location": location,
	})
}

// GetUserLocationsGeoJSON retrieves all user locations as GeoJSON
func (h *LocationHandler) GetUserLocationsGeoJSON(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	geojson, err := h.locationStore.GetLocationsAsGeoJSON(userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve locations")
		return
	}

	httputil.SuccessResponse(c, geojson)
}
