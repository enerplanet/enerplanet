package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"platform.local/common/pkg/httputil"
	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	backendModels "spatialhub_backend/internal/models"
	feedbackstore "spatialhub_backend/internal/store/feedback"
)

// RunReportNotifier tells the experts that a user reported a failed run.
type RunReportNotifier interface {
	NotifyRunReported(ctx context.Context, report backendModels.FeedbackRunReport, reporter string)
}

// failedResults are the fields a failed run leaves in models.results.
type failedResults struct {
	Error         string `json:"error"`
	FailedStage   string `json:"failed_stage"`
	FailedService string `json:"failed_service"`
}

// runReportFromForm reads the optional model_id form field: the failed run a
// bug report is about. Only the model's owner, or an expert, can report it,
// and only while it is failed; anyone else gets the not-found response, so
// model ids cannot be probed. The details are copied from the model, never
// taken from the form. ok is false when a response has been written.
func (h *FeedbackHandler) runReportFromForm(c *gin.Context, userCtx *httputil.UserContext) (report *backendModels.FeedbackRunReport, ok bool) {
	raw := c.PostForm("model_id")
	if raw == "" {
		return nil, true
	}
	if c.PostForm("category") != "bug" {
		httputil.BadRequest(c, "Only a bug report can name a failed run")
		return nil, false
	}
	modelID, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		httputil.BadRequest(c, "Invalid model_id "+raw)
		return nil, false
	}
	var model commonModels.Model
	err = h.db.Select("id", "user_id", "title", "status", "results", "calculation_completed_at").First(&model, modelID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		httputil.InternalError(c, "Failed to read model "+raw)
		return nil, false
	}
	if err != nil || (model.UserID != userCtx.UserID && !httputil.IsExpertAccess(userCtx.AccessLevel)) {
		httputil.NotFound(c, "Model "+raw+" not found")
		return nil, false
	}
	if model.Status != commonModels.ModelStatusFailed {
		httputil.BadRequest(c, "Model "+raw+" has no failed run to report")
		return nil, false
	}
	var failed failedResults
	if len(model.Results) > 0 {
		if err := json.Unmarshal(model.Results, &failed); err != nil {
			logger.ForComponent("feedback").Warnf("model %d: results are not a failure record: %v", model.ID, err)
		}
	}
	return &backendModels.FeedbackRunReport{
		ModelID:       model.ID,
		ModelTitle:    model.Title,
		FailedStage:   failed.FailedStage,
		FailedService: failed.FailedService,
		Error:         failed.Error,
		FailedAt:      model.CalculationCompletedAt,
	}, true
}

// attachRunReport stores report for feedback and notifies the experts. The
// feedback itself is already saved, so a failure here is logged, not returned.
func (h *FeedbackHandler) attachRunReport(feedback *commonModels.Feedback, report *backendModels.FeedbackRunReport) {
	if report == nil {
		return
	}
	report.FeedbackID = feedback.ID
	if err := h.feedbackStore.CreateRunReport(report); err != nil {
		logger.ForComponent("feedback").Errorf("feedback %d: %v", feedback.ID, err)
		return
	}
	if h.notifier != nil {
		go h.notifier.NotifyRunReported(context.Background(), *report, feedback.UserName)
	}
}

// GetRunReport returns the failed run attached to a feedback entry. Expert only.
func (h *FeedbackHandler) GetRunReport(c *gin.Context) {
	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}
	report, err := h.feedbackStore.GetRunReport(id)
	if errors.Is(err, feedbackstore.ErrRunReportNotFound) {
		httputil.NotFound(c, "Feedback "+strconv.FormatUint(uint64(id), 10)+" has no run report")
		return
	}
	if err != nil {
		httputil.InternalError(c, "Failed to read run report")
		return
	}
	httputil.SuccessResponse(c, report)
}
