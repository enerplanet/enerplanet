package settings

import (
	"strings"

	"spatialhub_backend/internal/geo"
	backendModels "spatialhub_backend/internal/models"

	"platform.local/common/pkg/httputil"
	applogger "platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

// GetGridPrices returns the default grid electricity prices of every country.
func (h *SettingsHandler) GetGridPrices(c *gin.Context) {
	prices, err := h.store.ListGridPrices()
	if err != nil {
		applogger.ForComponent("settings").Errorf("Failed to list grid prices: %v", err)
		httputil.InternalError(c, "Failed to fetch grid prices")
		return
	}
	httputil.SuccessResponse(c, prices)
}

// UpdateGridPrice creates or replaces one country's default grid prices
// (managers and experts only).
func (h *SettingsHandler) UpdateGridPrice(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	if userCtx.AccessLevel != backendModels.AccessLevelManager && userCtx.AccessLevel != backendModels.AccessLevelExpert {
		httputil.Forbidden(c, "Only managers and experts can update grid prices")
		return
	}

	var req struct {
		Country        string  `json:"country" binding:"required"`
		ImportCtPerKWh float64 `json:"import_ct_per_kwh"`
		ExportCtPerKWh float64 `json:"export_ct_per_kwh"`
		Source         string  `json:"source"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, errInvalidRequestData)
		return
	}
	country := strings.ToLower(strings.TrimSpace(req.Country))
	if country != backendModels.GridPriceFallbackCountry {
		country = geo.NormalizeCountry(country)
	}
	if country == "" {
		httputil.BadRequest(c, "Unknown country: "+req.Country)
		return
	}
	if err := backendModels.ValidateGridPrices(req.ImportCtPerKWh, req.ExportCtPerKWh); err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	price := backendModels.GridElectricityPrice{
		Country:        country,
		ImportCtPerKWh: req.ImportCtPerKWh,
		ExportCtPerKWh: req.ExportCtPerKWh,
		Source:         strings.TrimSpace(req.Source),
		UpdatedBy:      &userCtx.Email,
	}
	if err := h.store.UpsertGridPrice(&price); err != nil {
		applogger.ForComponent("settings").Errorf("Failed to save grid prices for %s: %v", country, err)
		httputil.InternalError(c, "Failed to save grid prices for "+country)
		return
	}
	httputil.SuccessResponse(c, price)
}
