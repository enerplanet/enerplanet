package pylovo

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"spatialhub_backend/internal/models"
	pylovoinstance "spatialhub_backend/internal/store/pylovo_instance"

	"platform.local/common/pkg/httputil"

	"github.com/gin-gonic/gin"
)

type ManagementHandler struct {
	store *pylovoinstance.Store
}

func NewManagementHandler(store *pylovoinstance.Store) *ManagementHandler {
	return &ManagementHandler{store: store}
}

func (h *ManagementHandler) parseID(c *gin.Context) (uint, bool) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		httputil.BadRequest(c, "Invalid instance ID")
		return 0, false
	}
	return uint(id), true
}

func (h *ManagementHandler) List(c *gin.Context) {
	instances, err := h.store.GetAll()
	if err != nil {
		httputil.InternalError(c, "Failed to load pylovo instances")
		return
	}
	httputil.SuccessResponse(c, gin.H{
		"items": instances,
		"total": len(instances),
	})
}

func (h *ManagementHandler) GetByID(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	instance, err := h.store.GetByID(id)
	if err != nil {
		httputil.NotFound(c, "Pylovo instance not found")
		return
	}
	httputil.SuccessResponse(c, instance)
}

func (h *ManagementHandler) Create(c *gin.Context) {
	var input struct {
		Name     string `json:"name" binding:"required"`
		IP       string `json:"ip" binding:"required"`
		Port     int    `json:"port" binding:"required"`
		Protocol string `json:"protocol"`
		Endpoint string `json:"endpoint"`
		Status   string `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httputil.BadRequest(c, "Invalid request payload")
		return
	}

	if input.Protocol == "" {
		input.Protocol = "http"
	}
	if input.Status == "" {
		input.Status = "active"
	}

	instance := &models.PylovoInstance{
		Name:     input.Name,
		IP:       input.IP,
		Port:     input.Port,
		Protocol: input.Protocol,
		Endpoint: input.Endpoint,
		Status:   input.Status,
	}

	if err := h.store.Create(instance); err != nil {
		httputil.InternalError(c, "Failed to create pylovo instance")
		return
	}
	httputil.SuccessResponse(c, instance)
}

func (h *ManagementHandler) Update(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}

	instance, err := h.store.GetByID(id)
	if err != nil {
		httputil.NotFound(c, "Pylovo instance not found")
		return
	}

	var input struct {
		Name     *string `json:"name"`
		IP       *string `json:"ip"`
		Port     *int    `json:"port"`
		Protocol *string `json:"protocol"`
		Endpoint *string `json:"endpoint"`
		Status   *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httputil.BadRequest(c, "Invalid request payload")
		return
	}

	if input.Name != nil {
		instance.Name = *input.Name
	}
	if input.IP != nil {
		instance.IP = *input.IP
	}
	if input.Port != nil {
		instance.Port = *input.Port
	}
	if input.Protocol != nil {
		instance.Protocol = *input.Protocol
	}
	if input.Endpoint != nil {
		instance.Endpoint = *input.Endpoint
	}
	if input.Status != nil {
		instance.Status = *input.Status
	}

	if err := h.store.Update(instance); err != nil {
		httputil.InternalError(c, "Failed to update pylovo instance")
		return
	}
	httputil.SuccessResponse(c, instance)
}

func (h *ManagementHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.store.Delete(id); err != nil {
		httputil.InternalError(c, "Failed to delete pylovo instance")
		return
	}
	httputil.SuccessMessage(c, "Pylovo instance deleted")
}

func (h *ManagementHandler) GetSummary(c *gin.Context) {
	summary, err := h.store.GetSummary()
	if err != nil {
		httputil.InternalError(c, "Failed to load summary")
		return
	}
	httputil.SuccessResponse(c, summary)
}

func (h *ManagementHandler) Ping(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	instance, err := h.store.GetByID(id)
	if err != nil {
		httputil.NotFound(c, "Pylovo instance not found")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	healthURL := fmt.Sprintf("%s/health", instance.BaseURL())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		_ = h.store.UpdateLastCheck(id)
		httputil.SuccessResponse(c, gin.H{"available": false, "details": nil})
		return
	}

	resp, err := pylovoHTTPClient.Do(req)
	_ = h.store.UpdateLastCheck(id)

	if err != nil {
		_ = h.store.UpdateAvailability(id, false)
		httputil.SuccessResponse(c, gin.H{"available": false, "details": nil})
		return
	}
	defer resp.Body.Close()

	available := resp.StatusCode >= 200 && resp.StatusCode < 400
	_ = h.store.UpdateAvailability(id, available)

	if available {
		now := time.Now()
		instance.Available = true
		instance.LastHeartbeat = &now
		_ = h.store.Update(instance)
	}

	httputil.SuccessResponse(c, gin.H{"available": available, "details": nil})
}

func (h *ManagementHandler) SetPrimary(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.store.SetPrimary(id); err != nil {
		httputil.InternalError(c, "Failed to set primary instance")
		return
	}
	instance, _ := h.store.GetByID(id)
	httputil.SuccessResponse(c, instance)
}

func (h *ManagementHandler) MarkAvailable(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.store.UpdateAvailability(id, true); err != nil {
		httputil.InternalError(c, "Failed to update availability")
		return
	}
	instance, _ := h.store.GetByID(id)
	httputil.SuccessResponse(c, instance)
}

func (h *ManagementHandler) MarkUnavailable(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if err := h.store.UpdateAvailability(id, false); err != nil {
		httputil.InternalError(c, "Failed to update availability")
		return
	}
	instance, _ := h.store.GetByID(id)
	httputil.SuccessResponse(c, instance)
}
