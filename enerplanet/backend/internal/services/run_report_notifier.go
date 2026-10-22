package services

import (
	"context"
	"fmt"

	"platform.local/common/pkg/constants"
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

// RunReportNotifier sends every expert user an in-app notification when a
// failed run is reported.
type RunReportNotifier struct {
	Notifications *NotificationService
	Users         *usersstore.Store
	Tokens        *authplatform.AdminTokenProvider
}

// NotifyRunReported notifies the experts about report. Failures are logged:
// the report is stored either way and listed in Feedback Management.
func (n RunReportNotifier) NotifyRunReported(ctx context.Context, report backendModels.FeedbackRunReport, reporter string) {
	log := logger.ForComponent("feedback")
	token, err := n.Tokens.GetToken()
	if err != nil {
		log.Errorf("feedback %d: no admin token to find the experts: %v", report.FeedbackID, err)
		return
	}
	experts, err := n.Users.ListUserIDsByAttribute(token, "access_level", constants.AccessLevelExpert)
	if err != nil {
		log.Errorf("feedback %d: %v", report.FeedbackID, err)
		return
	}
	stage := runStageNames[report.FailedStage]
	if stage == "" {
		stage = "run"
	}
	message := fmt.Sprintf("%s reported the failed %s of model '%s'. The details are in Feedback Management.", reporter, stage, report.ModelTitle)
	for _, id := range experts {
		if err := n.Notifications.NotifyUser(ctx, id, "Run reported", message, "warning"); err != nil {
			log.Errorf("feedback %d: notify expert %s: %v", report.FeedbackID, id, err)
		}
	}
}
