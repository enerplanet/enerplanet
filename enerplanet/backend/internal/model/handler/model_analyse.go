package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/jobs"
)

// AnalyseModel godoc
//
//	@Summary		Analyse every building of a model
//	@Description	Starts the BuEM demand analysis of every building in the saved model. Saving a
//	@Description	model does not start it. Poll GET /models/{id}/demand-profiles for progress until
//	@Description	its status is "completed". A request while an analysis of the model is still
//	@Description	running returns status "running" and starts nothing new.
//	@Tags			EnerPlanET
//	@Produce		json
//	@Param			id	path		int	true	"Model ID"
//	@Success		202	{object}	contracts.ModelAnalysisResponse
//	@Failure		403	{object}	contracts.ErrorResponse	"Not allowed to edit the model"
//	@Failure		404	{object}	contracts.ErrorResponse	"Model not found"
//	@Failure		409	{object}	contracts.ErrorResponse	"The model uses the estimated heat demand"
//	@Failure		422	{object}	contracts.ErrorResponse	"The model has no buildings to analyse"
//	@Failure		500	{object}	contracts.ErrorResponse
//	@Failure		503	{object}	contracts.ErrorResponse	"The job queue is not configured"
//	@Security		SessionAuth
//	@Router			/models/{id}/analyse [post]
func (h *ModelHandler) AnalyseModel(c *gin.Context) {
	_, model, _, ok := h.getEditableModelWithContext(c)
	if !ok {
		return
	}
	if h.asynqClient == nil {
		httputil.ErrorResponse(c, http.StatusServiceUnavailable, "building analysis is not available: no job queue is configured")
		return
	}
	if jobs.ModelHeatSource(model.Config) == jobs.HeatSourceEstimate {
		httputil.ErrorResponse(c, http.StatusConflict, fmt.Sprintf("model %d uses the estimated heat demand, so there is nothing to analyse", model.ID))
		return
	}
	osmIDs, refurbishment, err := jobs.DemandBuildings(model)
	if err != nil {
		httputil.ErrorResponse(c, http.StatusUnprocessableEntity, fmt.Sprintf("model %d has no buildings to analyse: %v", model.ID, err))
		return
	}
	if len(osmIDs) == 0 {
		httputil.ErrorResponse(c, http.StatusUnprocessableEntity, fmt.Sprintf("model %d has no buildings to analyse", model.ID))
		return
	}

	err = h.enqueueDemandProfileResolve(model.ID)
	if errors.Is(err, asynq.ErrDuplicateTask) {
		c.JSON(http.StatusAccepted, contracts.ModelAnalysisResponse{Status: "running", Buildings: len(osmIDs)})
		return
	}
	if err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to start the analysis of model %d", model.ID))
		return
	}
	// Reset only after a successful enqueue: a duplicate request must not reset
	// rows the running analysis is filling. Pending rows show progress at once.
	if err := h.profileStore.ResetForRun(model.ID, osmIDs, refurbishment); err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to reset the building analysis of model %d", model.ID))
		return
	}
	c.JSON(http.StatusAccepted, contracts.ModelAnalysisResponse{Status: "queued", Buildings: len(osmIDs)})
}

// enqueueDemandProfileResolve queues the BuEM analysis of a model's buildings.
// Unique for the job's timeout: a second request while one is queued or
// running returns asynq.ErrDuplicateTask.
func (h *ModelHandler) enqueueDemandProfileResolve(modelID uint) error {
	body, err := json.Marshal(jobs.ResolveDemandProfilesPayload{ModelID: modelID})
	if err != nil {
		return fmt.Errorf("marshal resolve_demand_profiles payload for model %d: %w", modelID, err)
	}
	_, err = h.asynqClient.Enqueue(asynq.NewTask(jobs.TypeResolveDemandProfiles, body),
		asynq.Queue("buem"),
		asynq.MaxRetry(3),
		asynq.Timeout(30*time.Minute),
		asynq.Unique(30*time.Minute),
		asynq.Retention(24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("enqueue resolve_demand_profiles for model %d: %w", modelID, err)
	}
	return nil
}
