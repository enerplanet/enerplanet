package result

import (
	"encoding/json"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"
	resultservice "spatialhub_backend/internal/result/service"
	"spatialhub_backend/internal/services"
	resultStore "spatialhub_backend/internal/store/result"
	"spatialhub_backend/internal/webservice"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"
)

const (
	errAccessDenied         = "Access denied"
	errModelNotFound        = "Model not found"
	errFailedToFetchModel   = "Failed to fetch model"
	maxCallbackZipSizeBytes = int64(500 * 1024 * 1024) // 500 MB
)

type ResultHandler struct {
	store               *resultStore.Store
	notificationService *services.NotificationService
	wsClient            *webservice.Client
	callbackSecret      string
	asynqClient         *asynq.Client
}

func NewResultHandler(db *gorm.DB, notificationService *services.NotificationService, wsClient *webservice.Client, callbackSecret string, asynqClient *asynq.Client) *ResultHandler {
	return &ResultHandler{
		store:               resultStore.NewStore(db),
		notificationService: notificationService,
		wsClient:            wsClient,
		callbackSecret:      callbackSecret,
		asynqClient:         asynqClient,
	}
}
func (h *ResultHandler) GetModelResults(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	results, err := h.fetchResults(c, modelID)
	if err != nil {
		return
	}

	httputil.SuccessResponse(c, results)
}

func (h *ResultHandler) DownloadModelResult(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")
	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	results, err := h.fetchResults(c, modelID)
	if err != nil {
		return
	}

	if len(results) == 0 {
		httputil.NotFound(c, "No results found for this model")
		return
	}

	latestResult := results[0]

	// Try multiple strategies to find the downloadable file
	if h.tryDownloadFromTifPath(c, modelID, latestResult.TifFilePath) {
		return
	}

	if h.tryDownloadFromStorageDir(c, modelID) {
		return
	}

	if h.tryDownloadTifFile(c, latestResult) {
		return
	}

	httputil.NotFound(c, "No downloadable file found for this model")
}
func (h *ResultHandler) GetResult(c *gin.Context) {
	result, ok := h.getResultFromRequest(c)
	if !ok {
		return
	}
	httputil.SuccessResponse(c, result)
}

func (h *ResultHandler) GetResultLayer(c *gin.Context) {
	result, ok := h.getResultFromRequest(c)
	if !ok {
		return
	}

	// Return parsed results metadata
	response := gin.H{
		"result_id":    result.ID,
		"model_id":     result.ModelID,
		"status":       result.ExtractionStatus,
		"extracted_at": result.CreatedAt,
	}

	// Include metadata if available
	if len(result.Metadata) > 0 {
		var metadata map[string]interface{}
		if err := json.Unmarshal(result.Metadata, &metadata); err == nil {
			response["metadata"] = metadata
		}
	}

	httputil.SuccessResponse(c, response)
}

// GetStructuredResults returns model results from separate database tables
func (h *ResultHandler) GetStructuredResults(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	modelIDUint := parseUint(modelID)
	response := h.buildStructuredResultsResponse(modelIDUint)
	httputil.SuccessResponse(c, response)
}
func (h *ResultHandler) GetCarrierTimeSeries(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	modelIDUint := parseUint(modelID)
	aggregate := c.Query("aggregate")

	response := gin.H{}
	if aggregate == "daily" {
		response["carrier_prod"] = h.store.GetDailyCarrierProdTimeSeries(modelIDUint)
		response["carrier_con"] = h.store.GetDailyCarrierConTimeSeries(modelIDUint)
	} else {
		response["carrier_prod"] = h.store.GetCarrierProdTimeSeries(modelIDUint)
		response["carrier_con"] = h.store.GetCarrierConTimeSeries(modelIDUint)
	}

	httputil.SuccessResponse(c, response)
}

// GetSystemTimeSeries returns system-level data pre-aggregated to reduce payload:
// - system_balance: daily average (same SystemBalanceRecord shape)
// - unmet_demand: daily sum (same UnmetDemandRecord shape)
// - resource_con: total per tech (same ResourceConRecord shape)
// - line_flows / trafo_flows: raw rows (already small per model)
func (h *ResultHandler) GetSystemTimeSeries(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	modelIDUint := parseUint(modelID)

	response := gin.H{}
	response["system_balance"] = h.store.GetDailySystemBalance(modelIDUint)
	response["unmet_demand"] = h.store.GetDailyUnmetDemand(modelIDUint)
	response["resource_con"] = h.store.GetResourceConTotals(modelIDUint)

	if lineFlows, err := h.store.GetLineFlows(modelIDUint); err == nil {
		response["line_flows"] = lineFlows
	}
	if trafoFlows, err := h.store.GetTransformerFlows(modelIDUint); err == nil {
		response["trafo_flows"] = trafoFlows
	}

	httputil.SuccessResponse(c, response)
}

// GetLocationTimeSeries returns hourly energy data (production/consumption) for a specific location
func (h *ResultHandler) GetLocationTimeSeries(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")
	location := c.Param("location")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	modelIDUint := parseUint(modelID)
	dateRange := dateRangeFilter{begin: c.Query("begin"), end: c.Query("end")}

	response := gin.H{"location": location}
	h.fetchLocationTimeSeriesData(modelIDUint, location, dateRange, response)
	httputil.SuccessResponse(c, response)
}

// GetPyPSAResults returns PyPSA power flow results for the entire model (all buses)
func (h *ResultHandler) GetPyPSAResults(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	model, ok := h.fetchModelByID(c, modelID)
	if !ok {
		return
	}

	if !h.userHasModelAccess(c, model, userCtx) {
		return
	}

	modelIDUint := parseUint(modelID)

	response := gin.H{}

	if voltage, err := h.store.GetPyPSAVoltage(modelIDUint); err == nil {
		response["voltage"] = voltage
	}

	if power, err := h.store.GetPyPSAPower(modelIDUint); err == nil {
		response["power"] = power
	}

	if lineLoading, err := h.store.GetPyPSALineLoading(modelIDUint); err == nil {
		response["line_loading"] = lineLoading
	}

	if trafoFlows, err := h.store.GetTransformerFlows(modelIDUint); err == nil {
		response["transformer_flows"] = trafoFlows
	}

	if settings, err := h.store.GetResultsPyPSASettings(modelIDUint); err == nil {
		response["settings"] = settings
	}

	response["locations"] = h.store.GetPyPSAVoltageLocations(modelIDUint)

	extractDir := h.latestExtractedPath(modelIDUint)
	if extractDir != "" {
		if convergence, err := readPyPSAConvergenceSummary(extractDir); err == nil && convergence != nil {
			response["convergence"] = convergence
		}
		if curtailment, err := readPyPSACurtailment(extractDir); err == nil && len(curtailment) > 0 {
			response["curtailment"] = curtailment
		}
		if transformerLoading, err := readPyPSATransformerLoading(extractDir); err == nil && len(transformerLoading) > 0 {
			response["transformer_loading"] = transformerLoading
		}
		if lineRatings, err := readPyPSALineRatings(extractDir); err == nil && len(lineRatings) > 0 {
			response["line_ratings"] = lineRatings
		}
	}

	httputil.SuccessResponse(c, response)
}

func (h *ResultHandler) ReprocessModelResults(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	modelID := c.Param("id")

	var model struct {
		ID      uint
		UserID  string
		Config  []byte `gorm:"type:jsonb"`
		Results struct {
			FilePath string `json:"file_path"`
		} `gorm:"type:jsonb"`
	}

	reprocessRow, err := h.store.GetReprocessModel(modelID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httputil.NotFound(c, errModelNotFound)
		} else {
			httputil.InternalError(c, errFailedToFetchModel)
		}
		return
	}
	model.ID = reprocessRow.ID
	model.UserID = reprocessRow.UserID
	model.Config = reprocessRow.Config
	model.Results = reprocessRow.Results

	if model.UserID != userCtx.UserID {
		httputil.Forbidden(c, "Access denied")
		return
	}

	zipPath := model.Results.FilePath
	if zipPath == "" {
		httputil.BadRequest(c, "No result file found for this model")
		return
	}

	resultService := resultservice.NewResultService(h.store.DB())

	// Check if results already exist
	existingResults, _ := resultService.GetModelResults(c.Request.Context(), model.ID)
	if len(existingResults) > 0 {
		// If results exist, delete them to allow reprocessing
		for _, res := range existingResults {
			_ = resultService.DeleteResult(c.Request.Context(), res.ID)
		}
	}

	// Check if PyPSA is enabled in model config
	pypsaEnabled := isPyPSAEnabledInConfig(model.Config)

	modelResult, err := resultService.ProcessModelResult(c.Request.Context(), model.ID, userCtx.UserID, zipPath, pypsaEnabled)
	if err != nil {
		httputil.InternalError(c, "Failed to process result")
		return
	}

	httputil.SuccessResponse(c, gin.H{
		"message":   "Result processed successfully",
		"result_id": modelResult.ID,
	})
}
func (h *ResultHandler) CallbackUpload(c *gin.Context) {
	log := logger.ForComponent("callback")

	model, ok := h.findModelForCallback(c, log)
	if !ok {
		return
	}

	if respondIfAlreadyProcessed(c, model) {
		return
	}

	if h.handleFailureStatusIfNeeded(c, model, log) {
		return
	}

	targetPath, ok := h.saveResultFile(c, model, log)
	if !ok {
		return
	}

	h.processResultUpload(c, model, targetPath, log)
}
