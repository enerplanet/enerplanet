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

// FeedbackNotifier sends the feedback flow's in-app notifications: new
// feedback to the experts, and a resolved or closed entry to its author.
type FeedbackNotifier interface {
	NotifyFeedbackReceived(ctx context.Context, fb commonModels.Feedback, report *backendModels.FeedbackRunReport)
	NotifyFeedbackClosed(ctx context.Context, fb commonModels.Feedback, status string, report *backendModels.FeedbackRunReport)
}

// failedResults are the fields a failed run leaves in models.results.
type failedResults struct {
	Error         string `json:"error"`
	FailedStage   string `json:"failed_stage"`
	FailedService string `json:"failed_service"`
}

// runReportFromForm reads the optional model_id form field: the failed run a
// bug report is about. Only the model's owner, or an expert, can report it,
// only while it is failed and has no open report; anyone else gets the
// not-found response, so model ids cannot be probed. The details are copied
// from the model, never taken from the form. ok is false when a response has been written.
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
	open, err := h.feedbackStore.HasOpenRunReport(model.ID)
	if err != nil {
		httputil.InternalError(c, "Failed to check the reports of model "+raw)
		return nil, false
	}
	if open {
		httputil.Conflict(c, "Model "+raw+" already has an open report")
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

// afterCreate stores the run report of a new feedback entry, if any, and
// notifies the experts. The feedback itself is already saved, so a failure
// here is logged, not returned.
func (h *FeedbackHandler) afterCreate(feedback *commonModels.Feedback, report *backendModels.FeedbackRunReport) {
	if report != nil {
		report.FeedbackID = feedback.ID
		if err := h.feedbackStore.CreateRunReport(report); err != nil {
			logger.ForComponent("feedback").Errorf("feedback %d: %v", feedback.ID, err)
			report = nil
		}
	}
	if h.notifier != nil {
		go h.notifier.NotifyFeedbackReceived(context.Background(), *feedback, report)
	}
}

// notifyIfClosed tells the author of before that an expert has just resolved
// or closed it. Feedback from the public contact form has no author to tell.
func (h *FeedbackHandler) notifyIfClosed(before commonModels.Feedback, status string) {
	if h.notifier == nil || before.UserID == "" || before.Status == status || (status != "resolved" && status != "closed") {
		return
	}
	report, err := h.feedbackStore.GetRunReport(before.ID)
	if errors.Is(err, feedbackstore.ErrRunReportNotFound) {
		report = nil
	} else if err != nil {
		logger.ForComponent("feedback").Errorf("feedback %d: %v", before.ID, err)
		report = nil
	}
	go h.notifier.NotifyFeedbackClosed(context.Background(), before, status, report)
}

// GetMyOpenRunReports returns the models with an open report that the signed-in user filed or owns.
func (h *FeedbackHandler) GetMyOpenRunReports(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	ids, err := h.feedbackStore.OpenRunReportModelIDs(userCtx.UserID)
	if err != nil {
		httputil.InternalError(c, "Failed to read your open reports")
		return
	}
	httputil.SuccessResponse(c, gin.H{"model_ids": ids})
}

// GetUnseenFeedback returns the ids of the feedback no expert has opened yet. Expert only.
func (h *FeedbackHandler) GetUnseenFeedback(c *gin.Context) {
	ids, err := h.feedbackStore.UnseenIDs()
	if err != nil {
		httputil.InternalError(c, "Failed to read unseen feedback")
		return
	}
	httputil.SuccessResponse(c, gin.H{"ids": ids})
}

// MarkFeedbackSeen records that the signed-in expert opened a feedback entry. Expert only.
func (h *FeedbackHandler) MarkFeedbackSeen(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}
	if _, err := h.feedbackStore.GetFeedbackByID(id); err != nil {
		httputil.HandleError(c, err)
		return
	}
	if err := h.feedbackStore.MarkSeen(id, userCtx.UserID); err != nil {
		httputil.InternalError(c, "Failed to mark feedback seen")
		return
	}
	httputil.SuccessMessage(c, "Feedback marked seen")
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
