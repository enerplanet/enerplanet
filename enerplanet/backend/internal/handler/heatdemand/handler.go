// Package heatdemand is the HTTP handler for the heat-demand resolve endpoint.
// It turns the simple building form's inputs (usage class, floor area, and -
// once wired - building type, construction year and country) into an annual
// space-heating demand plus a flag saying where the number came from.
//
// Effective order today: the usage-class estimate only. The TABULA archetype
// path (ignis) lands with #50; the 3D thermal path (BuEM) needs per-building
// thermal blocks to be persisted first (#57). The response shape already
// carries every field those will fill.
package heatdemand

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	hd "spatialhub_backend/internal/heatdemand"
)

// Handler serves the heat-demand resolve endpoint. It holds no state - the
// resolution is a pure function of the request body.
type Handler struct{}

// NewHandler returns a heat-demand Handler.
func NewHandler() *Handler {
	return &Handler{}
}

// Resolve godoc
//
//	@Summary		Resolve a building's annual space-heating demand
//	@Description	Given a building's usage class and floor area, returns its annual space-heating
//	@Description	demand (kWh/a), the specific demand (kWh/m2.a) and a source flag. The source is
//	@Description	"estimate", a specific-demand-by-usage-class lookup. tabula_variant_code and
//	@Description	hourly_profile are currently always null; a residential building carries a warning.
//	@Tags			HeatDemand
//	@Accept			json
//	@Produce		json
//	@Param			request	body		contracts.HeatDemandResolveRequest	true	"Building inputs"
//	@Success		200		{object}	contracts.HeatDemandResolveResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/heat-demand/resolve [post]
func (h *Handler) Resolve(c *gin.Context) {
	var req contracts.HeatDemandResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid request payload")
		return
	}
	if req.FClass == "" {
		httputil.BadRequest(c, "f_class is required")
		return
	}

	result := hd.Resolve(hd.Input{
		FClass:           req.FClass,
		BuildingType:     req.BuildingType,
		Country:          req.Country,
		ConstructionYear: req.ConstructionYear,
		FloorAreaM2:      req.FloorAreaM2,
	})

	c.JSON(http.StatusOK, contracts.HeatDemandResolveResponse{
		OSMID:                       req.OSMID,
		Source:                      result.Source,
		HeatingDemandKwhA:           result.HeatingDemandKwhA,
		SpecificHeatingDemandKwhM2a: result.SpecificHeatingDemandKwhM2a,
		TabulaVariantCode:           result.TabulaVariantCode,
		HourlyProfile:               nil,
		InputsEchoed: contracts.HeatDemandInputsEcho{
			FClass:           req.FClass,
			BuildingType:     req.BuildingType,
			ConstructionYear: req.ConstructionYear,
			FloorAreaM2:      req.FloorAreaM2,
			Country:          req.Country,
		},
		Warnings: result.Warnings,
	})
}
