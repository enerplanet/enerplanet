package model

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	backendModels "spatialhub_backend/internal/models"
	"spatialhub_backend/internal/store/heatprofile"
)

// GetModelHeatProfiles godoc
//
//	@Summary		Get a model's per-building BuEM energy profiles
//	@Description	Returns every building's resolved annual energy profile for a model, along with
//	@Description	resolution progress. Profiles are produced automatically whenever the model's
//	@Description	config is saved with a non-empty building list; poll this endpoint until status
//	@Description	is "completed" to show a progress bar. A building with status "failed" carries
//	@Description	error_message explaining why (no envelope match, BuEM rejected it, etc.) - that is
//	@Description	a per-building outcome, not an endpoint error.
//	@Tags			EnerPlanET
//	@Produce		json
//	@Param			id	path		int	true	"Model ID"
//	@Success		200	{object}	contracts.ModelHeatProfilesResponse
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Failure		500	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/heat-profiles [get]
func (h *ModelHandler) GetModelHeatProfiles(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id := c.Param("id")
	model, ok := h.fetchModel(c, id)
	if !ok {
		return
	}

	if userCtx.AccessLevel != constants.AccessLevelExpert && !h.newModelService().UserHasModelAccessByEmail(userCtx.UserID, userCtx.Email, model) {
		httputil.Forbidden(c, errAccessDenied)
		return
	}

	rows, err := h.profileStore.GetByModel(model.ID)
	if err != nil {
		httputil.InternalError(c, "failed to load heat profiles")
		return
	}
	counts, err := h.profileStore.GetStatusCounts(model.ID)
	if err != nil {
		httputil.InternalError(c, "failed to load heat profile status")
		return
	}

	c.JSON(http.StatusOK, contracts.ModelHeatProfilesResponse{
		Status:    overallHeatProfileStatus(counts),
		Total:     counts.Total(),
		Resolved:  counts.Resolved,
		Pending:   counts.Pending,
		Failed:    counts.Failed,
		Buildings: mapHeatProfiles(rows),
	})
}

// overallHeatProfileStatus summarizes a model's resolution run from its row
// counts: idle (nothing tracked yet), resolving (some rows still pending), or
// completed (every row reached a terminal outcome).
func overallHeatProfileStatus(counts heatprofile.StatusCounts) string {
	switch {
	case counts.Total() == 0:
		return "idle"
	case counts.Pending > 0:
		return "resolving"
	default:
		return "completed"
	}
}

func mapHeatProfiles(rows []backendModels.BuildingHeatProfile) []contracts.BuildingHeatProfile {
	out := make([]contracts.BuildingHeatProfile, len(rows))
	for i, r := range rows {
		out[i] = contracts.BuildingHeatProfile{
			OSMID:              r.OSMID,
			Status:             r.Status,
			TabulaVariantCode:  r.TabulaVariantCode,
			RefurbishmentLevel: r.RefurbishmentLevel,
			HeatingKwhA:        r.HeatingKwhA,
			CoolingKwhA:        r.CoolingKwhA,
			ElectricityKwhA:    r.ElectricityKwhA,
			HotWaterKwhA:       r.HotWaterKwhA,
			KitchenKwhA:        r.KitchenKwhA,
			ErrorMessage:       r.ErrorMessage,
		}
	}
	return out
}
