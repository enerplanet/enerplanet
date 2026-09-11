package timeseries

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"spatialhub_backend/internal/models"
	tsstore "spatialhub_backend/internal/store/timeseries"
)

const (
	errInvalidID          = "Invalid ID"
	errDatasetNotFound    = "Dataset not found"
	errFailedFetchDataset = "Failed to fetch dataset"
	errAccessDenied       = "Access denied"
	errInvalidRequestData = "Invalid request data"
)

// Handler exposes the time-series dataset API.
type Handler struct {
	store *tsstore.Store
}

// NewHandler creates a new time-series Handler.
func NewHandler(db *gorm.DB) *Handler {
	return &Handler{store: tsstore.NewStore(db)}
}

// access describes what the current user may do with a dataset.
type access struct {
	canRead  bool
	canWrite bool // write data points
	canEdit  bool // update metadata, delete, manage shares
}

// resolveAccess computes the user's access to a dataset. Expert users get full
// access to everything. Otherwise: owner => full; public => read; shared
// "edit" => read+write; shared "view" => read.
func (h *Handler) resolveAccess(ds *models.TimeseriesDataset, userID, accessLevel string) access {
	if accessLevel == constants.AccessLevelExpert {
		return access{canRead: true, canWrite: true, canEdit: true}
	}
	if ds.UserID == userID {
		return access{canRead: true, canWrite: true, canEdit: true}
	}
	if ds.Public {
		return access{canRead: true}
	}
	permission, ok := h.store.HasShare(ds.ID, userID)
	if !ok {
		return access{}
	}
	if permission == "edit" {
		return access{canRead: true, canWrite: true}
	}
	return access{canRead: true}
}

// getDatasetWithAccess loads a dataset and returns it plus the caller's access.
// Responds with an error and returns ok=false when the dataset is missing or
// the user has no read access.
func (h *Handler) getDatasetWithAccess(c *gin.Context, id uint, userID, accessLevel string) (*models.TimeseriesDataset, access, bool) {
	ds, err := h.store.GetDatasetByID(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errDatasetNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchDataset)
		}
		return nil, access{}, false
	}
	acc := h.resolveAccess(ds, userID, accessLevel)
	if !acc.canRead {
		httputil.Forbidden(c, errAccessDenied)
		return nil, access{}, false
	}
	return ds, acc, true
}

// ListDatasets godoc
// @Summary      List accessible time-series datasets
// @Description  Returns datasets the user can read: their own, public ones, and ones shared with them.
// @Tags         TimeSeries
// @Produce      json
// @Success      200  {array}  models.TimeseriesDataset
// @Failure      401  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets [get]
func (h *Handler) ListDatasets(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	datasets, err := h.store.ListAccessibleDatasets(userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch datasets")
		return
	}
	httputil.SuccessResponse(c, datasets)
}

// GetDataset godoc
// @Summary      Get a time-series dataset
// @Description  Returns a single dataset the user can read.
// @Tags         TimeSeries
// @Produce      json
// @Param        id  path  int  true  "Dataset ID"
// @Success      200  {object}  models.TimeseriesDataset
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id} [get]
func (h *Handler) GetDataset(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	ds, _, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	httputil.SuccessResponse(c, ds)
}

// CreateDataset godoc
// @Summary      Create a time-series dataset
// @Description  Creates a dataset owned by the authenticated user.
// @Tags         TimeSeries
// @Accept       json
// @Produce      json
// @Param        body  body  object  true  "Dataset payload (name required, public optional)"
// @Success      201  {object}  models.TimeseriesDataset
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets [post]
func (h *Handler) CreateDataset(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	var req struct {
		Name        string  `json:"name" binding:"required"`
		Description *string `json:"description"`
		Public      bool    `json:"public"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}
	ds := &models.TimeseriesDataset{
		UserID:      userCtx.UserID,
		Name:        req.Name,
		Description: req.Description,
		Public:      req.Public,
	}
	if err := h.store.CreateDataset(ds); err != nil {
		httputil.InternalError(c, "Failed to create dataset")
		return
	}
	httputil.Created(c, ds)
}

// UpdateDataset godoc
// @Summary      Update a time-series dataset
// @Description  Updates metadata (name, description, public flag). Owner or expert only.
// @Tags         TimeSeries
// @Accept       json
// @Produce      json
// @Param        id    path  int     true  "Dataset ID"
// @Param        body  body  object  true  "Fields to update"
// @Success      200  {object}  models.TimeseriesDataset
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id} [put]
func (h *Handler) UpdateDataset(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	ds, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canEdit {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Public      *bool   `json:"public"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}
	updates := make(map[string]interface{})
	if req.Name != nil {
		if *req.Name == "" {
			httputil.BadRequest(c, "name cannot be empty")
			return
		}
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Public != nil {
		updates["public"] = *req.Public
	}
	if len(updates) == 0 {
		httputil.SuccessResponse(c, ds)
		return
	}
	if err := h.store.UpdateDataset(id, updates); err != nil {
		httputil.InternalError(c, "Failed to update dataset")
		return
	}
	updated, err := h.store.GetDatasetByID(id)
	if err != nil {
		httputil.InternalError(c, errFailedFetchDataset)
		return
	}
	httputil.SuccessResponse(c, updated)
}

// DeleteDataset godoc
// @Summary      Delete a time-series dataset
// @Description  Deletes a dataset and its data and shares. Owner or expert only.
// @Tags         TimeSeries
// @Param        id  path  int  true  "Dataset ID"
// @Success      200  {object}  contracts.SuccessResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id} [delete]
func (h *Handler) DeleteDataset(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	_, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canEdit {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	if err := h.store.DeleteDataset(id); err != nil {
		httputil.InternalError(c, "Failed to delete dataset")
		return
	}
	httputil.SuccessMessage(c, "Dataset deleted")
}

// WriteData godoc
// @Summary      Write data points to a dataset
// @Description  Bulk-inserts (timestamp, value) samples. Owner, expert, or a user with edit share.
// @Tags         TimeSeries
// @Accept       json
// @Produce      json
// @Param        id    path  int     true  "Dataset ID"
// @Param        body  body  object  true  "Array of {timestamp, value} points"
// @Success      200  {object}  contracts.SuccessResponse
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id}/data [post]
func (h *Handler) WriteData(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	_, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canWrite {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	var req struct {
		Points []struct {
			Timestamp time.Time `json:"timestamp" binding:"required"`
			Value     float64   `json:"value" binding:"required"`
		} `json:"points" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}
	if len(req.Points) == 0 {
		httputil.BadRequest(c, "points must not be empty")
		return
	}
	points := make([]models.TimeseriesDataPoint, len(req.Points))
	for i, p := range req.Points {
		points[i] = models.TimeseriesDataPoint{Timestamp: p.Timestamp, Value: p.Value}
	}
	if err := h.store.WriteDataPoints(id, points); err != nil {
		httputil.InternalError(c, "Failed to write data points")
		return
	}
	httputil.SuccessMessage(c, "Data points written")
}

// ReadData godoc
// @Summary      Read data points from a dataset
// @Description  Returns samples, optionally filtered to a time range.
// @Tags         TimeSeries
// @Produce      json
// @Param        id     path  int     true  "Dataset ID"
// @Param        from   query string  false  "Start time (RFC3339)"
// @Param        to     query string  false  "End time (RFC3339)"
// @Param        limit  query int     false  "Max points to return"
// @Success      200  {array}  models.TimeseriesDataPoint
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id}/data [get]
func (h *Handler) ReadData(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	_, _, ok = h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	var from, to *time.Time
	if v := c.Query("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httputil.BadRequest(c, "invalid from: use RFC3339")
			return
		}
		from = &t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			httputil.BadRequest(c, "invalid to: use RFC3339")
			return
		}
		to = &t
	}
	limit := 0
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			httputil.BadRequest(c, "invalid limit")
			return
		}
		limit = n
	}
	points, err := h.store.ReadDataPoints(id, from, to, limit)
	if err != nil {
		httputil.InternalError(c, "Failed to read data points")
		return
	}
	httputil.SuccessResponse(c, points)
}

// ShareDataset godoc
// @Summary      Share a dataset with a user
// @Description  Grants a user access to a non-public dataset. Owner or expert only.
// @Tags         TimeSeries
// @Accept       json
// @Produce      json
// @Param        id    path  int     true  "Dataset ID"
// @Param        body  body  object  true  "Share payload (email, permission)"
// @Success      201  {object}  models.TimeseriesDatasetShare
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id}/share [post]
func (h *Handler) ShareDataset(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	_, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canEdit {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	var req struct {
		Email      string `json:"email" binding:"required"`
		Permission string `json:"permission"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}
	if req.Permission != "" && req.Permission != "view" && req.Permission != "edit" {
		httputil.BadRequest(c, "permission must be 'view' or 'edit'")
		return
	}
	share, err := h.store.ShareWithUser(id, req.Email, req.Email, req.Permission, userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to share dataset")
		return
	}
	httputil.Created(c, share)
}

// RevokeShare godoc
// @Summary      Revoke a dataset share
// @Description  Removes a user's access to a dataset. Owner or expert only.
// @Tags         TimeSeries
// @Param        id       path  int  true  "Dataset ID"
// @Param        shareId  path  int  true  "Share ID"
// @Success      200  {object}  contracts.SuccessResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id}/shares/{shareId} [delete]
func (h *Handler) RevokeShare(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	shareID, ok := httputil.ParseUintParam(c, "shareId", "Invalid share ID")
	if !ok {
		return
	}
	_, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canEdit {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	revoked, err := h.store.RevokeShare(id, shareID)
	if err != nil {
		httputil.InternalError(c, "Failed to revoke share")
		return
	}
	if !revoked {
		httputil.NotFound(c, "Share not found")
		return
	}
	httputil.SuccessMessage(c, "Share revoked")
}

// ListShares godoc
// @Summary      List a dataset's shares
// @Description  Returns all shares on a dataset. Owner or expert only.
// @Tags         TimeSeries
// @Produce      json
// @Param        id  path  int  true  "Dataset ID"
// @Success      200  {array}  models.TimeseriesDatasetShare
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      403  {object}  contracts.ErrorResponse
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /datasets/{id}/shares [get]
func (h *Handler) ListShares(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}
	_, acc, ok := h.getDatasetWithAccess(c, id, userCtx.UserID, userCtx.AccessLevel)
	if !ok {
		return
	}
	if !acc.canEdit {
		httputil.Forbidden(c, errAccessDenied)
		return
	}
	shares, err := h.store.ListShares(id)
	if err != nil {
		httputil.InternalError(c, "Failed to list shares")
		return
	}
	httputil.SuccessResponse(c, shares)
}
