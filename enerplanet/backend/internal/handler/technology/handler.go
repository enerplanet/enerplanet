package technology

import (
	"encoding/json"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	techstore "spatialhub_backend/internal/store/technology"
)

const (
	errInvalidID                = "Invalid ID"
	errTechnologyNotFound       = "Technology not found"
	errFailedFetchTechnology    = "Failed to fetch technology"
	errInvalidRequestData       = "Invalid request data"
	errCannotModifySystem       = "Cannot modify system technologies"
	errCannotModifyOtherUsers   = "Cannot modify other users' technologies"
)

type Handler struct {
	store *techstore.Store
}

func NewHandler(db *gorm.DB) *Handler {
	return &Handler{store: techstore.NewStore(db)}
}

func isValidFloat(v *float64) bool {
	return v != nil && !math.IsInf(*v, 0) && !math.IsNaN(*v)
}

func (h *Handler) getTechnologyByAccess(id uint, userID, accessLevel string) (*techstore.Technology, error) {
	if accessLevel == constants.AccessLevelExpert {
		return h.store.GetByIDUnfiltered(id)
	}
	return h.store.GetByID(id, userID)
}

func (h *Handler) getTechWithPermission(c *gin.Context, id uint, userCtx *httputil.UserContext) (*techstore.Technology, bool) {
	tech, err := h.getTechnologyByAccess(id, userCtx.UserID, userCtx.AccessLevel)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errTechnologyNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchTechnology)
		}
		return nil, false
	}
	if !checkModifyPermission(c, tech, userCtx.UserID, userCtx.AccessLevel) {
		return nil, false
	}
	return tech, true
}

func checkModifyPermission(c *gin.Context, tech *techstore.Technology, userID, accessLevel string) bool {
	if accessLevel == constants.AccessLevelExpert {
		return true
	}
	if tech.UserID == nil {
		httputil.Forbidden(c, errCannotModifySystem)
		return false
	}
	if *tech.UserID != userID {
		httputil.Forbidden(c, errCannotModifyOtherUsers)
		return false
	}
	return true
}

type TechnologyDTO struct {
	ID          uint             `json:"id,omitempty"`
	Key         string           `json:"key"`
	Alias       string           `json:"alias"`
	Icon        string           `json:"icon"`
	Description string           `json:"description"`
	UserID      *string          `json:"user_id,omitempty"`
	Constraints []ConstraintDTO  `json:"constraints"`
}

type ConstraintDTO struct {
	ID           uint            `json:"id,omitempty"`
	Key          string          `json:"key"`
	Alias        string          `json:"alias"`
	Description  string          `json:"description,omitempty"`
	DefaultValue interface{}     `json:"default_value"`
	Unit         *string         `json:"unit"`
	Min          *float64        `json:"min"`
	Max          interface{}     `json:"max"`
	RelationData json.RawMessage `json:"relationData,omitempty"`
	Options      json.RawMessage `json:"options,omitempty"`
}

func toTechnologyDTO(tech *techstore.Technology) TechnologyDTO {
	dto := TechnologyDTO{
		ID:          tech.ID,
		Key:         tech.Key,
		Alias:       tech.Alias,
		UserID:      tech.UserID,
		Constraints: make([]ConstraintDTO, len(tech.Constraints)),
	}

	if tech.Icon != nil {
		dto.Icon = *tech.Icon
	}
	if tech.Description != nil {
		dto.Description = *tech.Description
	}

	for i, c := range tech.Constraints {
		dto.Constraints[i] = toConstraintDTO(&c)
	}

	return dto
}

func toConstraintDTO(c *techstore.TechnologyConstraint) ConstraintDTO {
	dto := ConstraintDTO{
		ID:    c.ID,
		Key:   c.Key,
		Alias: c.Alias,
		Unit:  c.Unit,
	}

	if isValidFloat(c.MinValue) {
		dto.Min = c.MinValue
	}

	if c.Description != nil {
		dto.Description = *c.Description
	}

	if isValidFloat(c.DefaultValue) {
		dto.DefaultValue = *c.DefaultValue
	}

	if c.MaxValue != nil {
		if math.IsInf(*c.MaxValue, 0) || math.IsNaN(*c.MaxValue) {
			dto.Max = "INF"
		} else {
			dto.Max = *c.MaxValue
		}
	}

	if c.RelationData != nil {
		dto.RelationData = *c.RelationData
	}

	if c.Options != nil {
		dto.Options = *c.Options
	}

	return dto
}

func fromTechnologyDTO(dto *TechnologyDTO, userID string) *techstore.Technology {
	tech := &techstore.Technology{
		Key:         dto.Key,
		Alias:       dto.Alias,
		Constraints: make([]techstore.TechnologyConstraint, len(dto.Constraints)),
	}

	if dto.Icon != "" {
		tech.Icon = &dto.Icon
	}
	if dto.Description != "" {
		tech.Description = &dto.Description
	}
	if userID != "" {
		tech.UserID = &userID
	}

	for i, c := range dto.Constraints {
		tech.Constraints[i] = fromConstraintDTO(&c)
	}

	return tech
}

func fromConstraintDTO(dto *ConstraintDTO) techstore.TechnologyConstraint {
	c := techstore.TechnologyConstraint{
		Key:      dto.Key,
		Alias:    dto.Alias,
		Unit:     dto.Unit,
		MinValue: dto.Min,
		Required: true,
	}

	if dto.Description != "" {
		c.Description = &dto.Description
	}

	if dto.DefaultValue != nil {
		switch v := dto.DefaultValue.(type) {
		case float64:
			c.DefaultValue = &v
		case int:
			val := float64(v)
			c.DefaultValue = &val
		}
	}

	if dto.Max != nil {
		switch v := dto.Max.(type) {
		case float64:
			c.MaxValue = &v
		case int:
			val := float64(v)
			c.MaxValue = &val
		}
	}

	return c
}

func (h *Handler) GetAll(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var technologies []techstore.Technology
	var err error

	if userCtx.AccessLevel == constants.AccessLevelExpert {
		technologies, err = h.store.GetAllIncludingUserDefined()
	} else {
		technologies, err = h.store.GetAll(userCtx.UserID)
	}

	if err != nil {
		httputil.InternalError(c, "Failed to fetch technologies")
		return
	}

	dtos := make([]TechnologyDTO, len(technologies))
	for i, tech := range technologies {
		dtos[i] = toTechnologyDTO(&tech)
	}

	httputil.SuccessResponse(c, dtos)
}

func (h *Handler) GetByID(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	var tech *techstore.Technology
	var err error

	if userCtx.AccessLevel == constants.AccessLevelExpert {
		tech, err = h.store.GetByIDUnfiltered(id)
	} else {
		tech, err = h.store.GetByID(id, userCtx.UserID)
	}

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errTechnologyNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchTechnology)
		}
		return
	}

	httputil.SuccessResponse(c, toTechnologyDTO(tech))
}

func (h *Handler) Create(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var dto TechnologyDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if dto.Key == "" || dto.Alias == "" {
		httputil.BadRequest(c, "Key and Alias are required")
		return
	}

	if h.store.KeyExistsAny(dto.Key, userCtx.UserID) {
		httputil.BadRequest(c, "Technology with this key already exists")
		return
	}

	tech := fromTechnologyDTO(&dto, userCtx.UserID)
	if err := h.store.Create(tech); err != nil {
		httputil.InternalError(c, "Failed to create technology")
		return
	}

	created, _ := h.store.GetByID(tech.ID, userCtx.UserID)
	if created != nil {
		tech = created
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": toTechnologyDTO(tech)})
}

func (h *Handler) Update(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	tech, err := h.store.GetByID(id, userCtx.UserID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errTechnologyNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchTechnology)
		}
		return
	}

	if !checkModifyPermission(c, tech, userCtx.UserID, userCtx.AccessLevel) {
		return
	}

	var dto TechnologyDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if dto.Alias != "" {
		tech.Alias = dto.Alias
	}
	if dto.Icon != "" {
		tech.Icon = &dto.Icon
	}
	if dto.Description != "" {
		tech.Description = &dto.Description
	}

	if err := h.store.Update(tech); err != nil {
		httputil.InternalError(c, "Failed to update technology")
		return
	}

	httputil.SuccessResponse(c, toTechnologyDTO(tech))
}

func (h *Handler) Delete(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	var tech *techstore.Technology
	var err error
	
	if userCtx.AccessLevel == constants.AccessLevelExpert {
		tech, err = h.store.GetByIDUnfiltered(id)
	} else {
		tech, err = h.store.GetByID(id, userCtx.UserID)
	}
	
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errTechnologyNotFound)
		} else {
			httputil.InternalError(c, errFailedFetchTechnology)
		}
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert {
		if tech.UserID == nil || *tech.UserID != userCtx.UserID {
			httputil.Forbidden(c, "You can only delete your own technologies")
			return
		}
	}

	if err := h.store.Delete(id); err != nil {
		httputil.InternalError(c, "Failed to delete technology")
		return
	}

	httputil.NoContent(c)
}

func (h *Handler) UpdateConstraints(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	tech, ok := h.getTechWithPermission(c, id, userCtx)
	if !ok {
		return
	}

	var payload struct {
		Constraints []ConstraintDTO `json:"constraints"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	constraints := make([]techstore.TechnologyConstraint, len(payload.Constraints))
	for i, dto := range payload.Constraints {
		constraints[i] = fromConstraintDTO(&dto)
	}

	if err := h.store.UpdateConstraints(id, constraints); err != nil {
		httputil.InternalError(c, "Failed to update constraints")
		return
	}

	if updated, _ := h.store.GetByIDUnfiltered(id); updated != nil {
		tech = updated
	}

	httputil.SuccessResponse(c, toTechnologyDTO(tech))
}

func (h *Handler) AddConstraint(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	tech, ok := h.getTechWithPermission(c, id, userCtx)
	if !ok {
		return
	}

	var dto ConstraintDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if dto.Key == "" || dto.Alias == "" {
		httputil.BadRequest(c, "Key and Alias are required")
		return
	}

	constraint := fromConstraintDTO(&dto)
	constraint.TechnologyID = id

	if err := h.store.AddConstraint(&constraint); err != nil {
		httputil.InternalError(c, "Failed to add constraint")
		return
	}

	if updated, _ := h.store.GetByIDUnfiltered(id); updated != nil {
		tech = updated
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": toTechnologyDTO(tech)})
}

func (h *Handler) DeleteConstraint(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	techID, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	constraintID, ok := httputil.ParseUintParam(c, "constraintId", "Invalid constraint ID")
	if !ok {
		return
	}

	tech, ok := h.getTechWithPermission(c, techID, userCtx)
	if !ok {
		return
	}

	if err := h.store.DeleteConstraint(constraintID, techID); err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, "Constraint not found")
		} else {
			httputil.InternalError(c, "Failed to delete constraint")
		}
		return
	}

	if updated, _ := h.store.GetByIDUnfiltered(techID); updated != nil {
		tech = updated
	}

	httputil.SuccessResponse(c, toTechnologyDTO(tech))
}

func (h *Handler) Reseed(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !httputil.RequireExpertAccessFromContext(userCtx, c) {
		return
	}

	count, err := h.store.ReseedFromDefaults()
	if err != nil {
		httputil.InternalError(c, "Failed to reseed technologies: "+err.Error())
		return
	}

	httputil.SuccessResponse(c, gin.H{
		"message": "Technologies reseeded successfully",
		"count":   count,
	})
}

func (h *Handler) Import(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	var payload struct {
		Technologies []TechnologyDTO `json:"technologies"`
		AsSystem     bool            `json:"as_system"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}

	if payload.AsSystem && userCtx.AccessLevel != constants.AccessLevelExpert {
		httputil.Forbidden(c, "Only experts can import system technologies")
		return
	}

	imported := 0
	skipped := 0

	for _, dto := range payload.Technologies {
		if dto.Key == "" || dto.Alias == "" {
			skipped++
			continue
		}

		if h.store.KeyExistsAny(dto.Key, userCtx.UserID) {
			skipped++
			continue
		}

		var tech *techstore.Technology
		if payload.AsSystem {
			tech = fromTechnologyDTO(&dto, userCtx.UserID)
			tech.UserID = nil
		} else {
			tech = fromTechnologyDTO(&dto, userCtx.UserID)
		}
		
		if err := h.store.Create(tech); err != nil {
			skipped++
			continue
		}
		imported++
	}

	httputil.SuccessResponse(c, gin.H{
		"imported": imported,
		"skipped":  skipped,
	})
}

func (h *Handler) UpdateType(c *gin.Context) {
	id, ok := httputil.ParseUintParam(c, "id", errInvalidID)
	if !ok {
		return
	}

	userCtx, exists := httputil.GetUserContext(c)
	if !exists {
		httputil.ErrorResponse(c, http.StatusUnauthorized, "Unauthorized")
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert {
		httputil.ErrorResponse(c, http.StatusForbidden, "Only experts can change technology type")
		return
	}

	var payload struct {
		IsSystem bool `json:"is_system"`
	}

	if err := c.ShouldBindJSON(&payload); err != nil {
		httputil.ErrorResponse(c, http.StatusBadRequest, "Invalid request payload")
		return
	}

	tech, err := h.store.GetByIDUnfiltered(id)
	if err != nil {
		httputil.ErrorResponse(c, http.StatusNotFound, errTechnologyNotFound)
		return
	}

	if payload.IsSystem {
		tech.UserID = nil
	} else {
		tech.UserID = &userCtx.UserID
	}

	if err := h.store.Update(tech); err != nil {
		httputil.ErrorResponse(c, http.StatusInternalServerError, "Failed to update technology type")
		return
	}

	httputil.SuccessResponse(c, toTechnologyDTO(tech))
}
