package services

import (
	"context"
	"fmt"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"
	authplatform "platform.local/platform/auth"
	"platform.local/platform/logger"
	backendModels "spatialhub_backend/internal/models"
	usersstore "spatialhub_backend/internal/store/users"
)

// runStageNames names the stage a run failed in (results.failed_stage).
var runStageNames = map[string]string{
	"queue":      "preparation",
	"running":    "simulation",
	"processing": "processing",
}

// FeedbackNotifier sends the in-app notifications of the feedback flow: every
// expert hears of new feedback, and the author hears when an expert resolves
// or closes it. Failures are logged; the feedback itself is stored either way.
type FeedbackNotifier struct {
	Notifications *NotificationService
	Users         *usersstore.Store
	Tokens        *authplatform.AdminTokenProvider
}

// NotifyFeedbackReceived tells every expert about fb, naming the failed run when report is set.
func (n FeedbackNotifier) NotifyFeedbackReceived(ctx context.Context, fb models.Feedback, report *backendModels.FeedbackRunReport) {
	log := logger.ForComponent("feedback")
	token, err := n.Tokens.GetToken()
	if err != nil {
		log.Errorf("feedback %d: no admin token to find the experts: %v", fb.ID, err)
		return
	}
	experts, err := n.Users.ListUserIDsByAttribute(token, "access_level", constants.AccessLevelExpert)
	if err != nil {
		log.Errorf("feedback %d: %v", fb.ID, err)
		return
	}
	title, message := "New feedback", fmt.Sprintf("%s sent feedback: '%s'. It is in Feedback Management.", fb.UserName, fb.Subject)
	if report != nil {
		stage := runStageNames[report.FailedStage]
		if stage == "" {
			stage = "run"
		}
		title = "Run reported"
		message = fmt.Sprintf("%s reported the failed %s of model '%s'. The details are in Feedback Management.", fb.UserName, stage, report.ModelTitle)
	}
	for _, id := range experts {
		if err := n.Notifications.NotifyUser(ctx, id, title, message, "warning"); err != nil {
			log.Errorf("feedback %d: notify expert %s: %v", fb.ID, id, err)
		}
	}
}

// NotifyFeedbackClosed tells the author of fb that an expert set it to status
// (resolved or closed), with the next step for a reported run.
func (n FeedbackNotifier) NotifyFeedbackClosed(ctx context.Context, fb models.Feedback, status string, report *backendModels.FeedbackRunReport) {
	title, kind := "Your feedback was closed", "info"
	if status == "resolved" {
		title, kind = "Your feedback was resolved", "success"
	}
	message := fmt.Sprintf("Your feedback '%s' is marked %s.", fb.Subject, status)
	if report != nil {
		message = fmt.Sprintf("Your report on model '%s' is marked %s. Run the model again; if it still fails, report it again.", report.ModelTitle, status)
	}
	if err := n.Notifications.NotifyUser(ctx, fb.UserID, title, message, kind); err != nil {
		logger.ForComponent("feedback").Errorf("feedback %d: notify author %s: %v", fb.ID, fb.UserID, err)
	}
}
