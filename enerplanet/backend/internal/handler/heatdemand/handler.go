// Package heatdemand is the HTTP handler for the heat-demand resolve endpoint.
// It turns the simple building form's inputs (usage class, floor area,
// building type, construction year and country) into an annual space-heating
// demand plus a flag saying where the number came from.
//
// Effective order: BuEM > ignis > estimate. The BuEM branch is not wired here
// (#57 — it needs a persisted per-building thermal profile to read, which
// does not exist yet). The response shape already carries the fields BuEM
// will fill (tabula_variant_code, hourly_profile) so #57 does not reshape it.
package heatdemand

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	hd "spatialhub_backend/internal/heatdemand"
	ignisclient "spatialhub_backend/internal/ignis"
)

// Handler serves the heat-demand resolve endpoint.
type Handler struct {
	ignis hd.IgnisResolver
}

// NewHandler returns a Handler that resolves the ignis path against the
// ignis service at baseURL.
func NewHandler(baseURL string) *Handler {
	return &Handler{ignis: ignisclient.NewClient(baseURL)}
}

// Resolve godoc
//
//	@Summary		Resolve a building's annual space-heating demand
//	@Description	Given a building's usage class, floor area, and (for a residential building)
//	@Description	its TABULA type / construction year / country, returns its annual space-heating
//	@Description	demand (kWh/a), the specific demand (kWh/m2.a) and a source flag ("ignis" when a
//	@Description	TABULA archetype matched, "estimate" otherwise). tabula_variant_code is set only
//	@Description	for source "ignis". hourly_profile is currently always null (source "buem" is not
//	@Description	yet wired). A residential building that falls back to the estimate carries a
//	@Description	warning naming why.
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

	result := hd.Resolve(c.Request.Context(), h.ignis, hd.Input{
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
