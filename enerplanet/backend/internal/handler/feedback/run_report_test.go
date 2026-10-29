package feedback

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"platform.local/common/pkg/httputil"
	commonModels "platform.local/common/pkg/models"
	backendModels "spatialhub_backend/internal/models"
	"spatialhub_backend/internal/testutil"
)

const failedResultsJSON = `{"error": "model 30: none of the model's 107 buildings has an hourly demand profile", "failed_stage": "queue", "failed_service": "city2tabula"}`

// reportRequest runs runReportFromForm for user on a form with the given
// model_id, the model row being returned by the mock and the model having no
// open report.
func reportRequest(t *testing.T, form string, user httputil.UserContext, row *sqlmock.Rows) (*httptest.ResponseRecorder, bool, func() error) {
	t.Helper()
	return reportRequestWithOpen(t, form, user, row, 0)
}

// reportRequestWithOpen is reportRequest for a model with the given number of open reports.
func reportRequestWithOpen(t *testing.T, form string, user httputil.UserContext, row *sqlmock.Rows, open int) (*httptest.ResponseRecorder, bool, func() error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, mock := testutil.NewMockDB(t)
	if row != nil {
		mock.ExpectQuery(`SELECT .* FROM "models"`).WillReturnRows(row)
		mock.ExpectQuery(`SELECT count\(\*\) FROM feedback_run_reports AS r JOIN feedbacks f`).
			WithArgs(30, "pending", "in_progress").
			WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(open))
	}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/feedback", strings.NewReader(form))
	c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	h := NewFeedbackHandler(db, nil)

	report, ok := h.runReportFromForm(c, &user)
	if ok && row != nil {
		require.NotNil(t, report)
		assert.Equal(t, uint(30), report.ModelID)
		assert.Equal(t, "Mainkofen Hospital - Baseline", report.ModelTitle)
		assert.Equal(t, "queue", report.FailedStage)
		assert.Equal(t, "city2tabula", report.FailedService)
		assert.Contains(t, report.Error, "has an hourly demand profile")
		require.NotNil(t, report.FailedAt)
	}
	return rec, ok, mock.ExpectationsWereMet
}

func modelRow(owner, status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "user_id", "title", "status", "results", "calculation_completed_at"}).
		AddRow(30, owner, "Mainkofen Hospital - Baseline", status, []byte(failedResultsJSON), time.Date(2026, 10, 22, 19, 6, 0, 0, time.UTC))
}

func TestRunReportFromForm(t *testing.T) {
	owner := httputil.UserContext{UserID: "u-owner"}

	t.Run("no model_id is plain feedback", func(t *testing.T) {
		_, ok, met := reportRequest(t, "subject=x", owner, nil)
		assert.True(t, ok)
		require.NoError(t, met())
	})

	t.Run("the owner reports a failed run, details copied from the model", func(t *testing.T) {
		_, ok, met := reportRequest(t, "category=bug&model_id=30&failed_service=meme", owner, modelRow("u-owner", "failed"))
		assert.True(t, ok)
		require.NoError(t, met())
	})

	t.Run("another user gets not found, so model ids cannot be probed", func(t *testing.T) {
		rec, ok, _ := reportRequest(t, "category=bug&model_id=30", httputil.UserContext{UserID: "u-other"}, modelRow("u-owner", "failed"))
		assert.False(t, ok)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("only a bug report can name a run", func(t *testing.T) {
		rec, ok, _ := reportRequest(t, "category=general&model_id=30", owner, nil)
		assert.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("a model with an open report cannot be reported again", func(t *testing.T) {
		rec, ok, met := reportRequestWithOpen(t, "category=bug&model_id=30", owner, modelRow("u-owner", "failed"), 1)
		assert.False(t, ok)
		assert.Equal(t, http.StatusConflict, rec.Code)
		require.NoError(t, met())
	})

	t.Run("an expert can report it", func(t *testing.T) {
		_, ok, _ := reportRequest(t, "category=bug&model_id=30", httputil.UserContext{UserID: "u-admin", AccessLevel: "expert"}, modelRow("u-owner", "failed"))
		assert.True(t, ok)
	})

	t.Run("a run that did not fail cannot be reported", func(t *testing.T) {
		rec, ok, _ := reportRequest(t, "category=bug&model_id=30", owner, modelRow("u-owner", "completed"))
		assert.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("a model_id that is not a number is rejected", func(t *testing.T) {
		rec, ok, _ := reportRequest(t, "category=bug&model_id=abc", owner, nil)
		assert.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

// closedNotice is one NotifyFeedbackClosed call seen by fakeNotifier.
type closedNotice struct {
	status string
	report *backendModels.FeedbackRunReport
}

type fakeNotifier struct{ closed chan closedNotice }

func (fakeNotifier) NotifyFeedbackReceived(context.Context, commonModels.Feedback, *backendModels.FeedbackRunReport) {
}

func (f fakeNotifier) NotifyFeedbackClosed(_ context.Context, _ commonModels.Feedback, status string, report *backendModels.FeedbackRunReport) {
	f.closed <- closedNotice{status, report}
}

func TestNotifyIfClosed(t *testing.T) {
	entry := func(userID, status string) commonModels.Feedback {
		fb := commonModels.Feedback{UserID: userID, Status: status}
		fb.ID = 5
		return fb
	}

	t.Run("the author of a run report hears it was resolved", func(t *testing.T) {
		db, mock := testutil.NewMockDB(t)
		mock.ExpectQuery(`SELECT \* FROM "feedback_run_reports"`).WithArgs(5, 1).
			WillReturnRows(sqlmock.NewRows([]string{"feedback_id", "model_id", "model_title"}).AddRow(5, 30, "Mainkofen Hospital - Baseline"))
		notifier := fakeNotifier{make(chan closedNotice, 1)}
		NewFeedbackHandler(db, notifier).notifyIfClosed(entry("u-owner", "in_progress"), "resolved")

		got := <-notifier.closed
		assert.Equal(t, "resolved", got.status)
		require.NotNil(t, got.report)
		assert.Equal(t, uint(30), got.report.ModelID)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("plain feedback is closed without a report", func(t *testing.T) {
		db, mock := testutil.NewMockDB(t)
		mock.ExpectQuery(`SELECT \* FROM "feedback_run_reports"`).WillReturnRows(sqlmock.NewRows([]string{"feedback_id"}))
		notifier := fakeNotifier{make(chan closedNotice, 1)}
		NewFeedbackHandler(db, notifier).notifyIfClosed(entry("u-owner", "pending"), "closed")

		got := <-notifier.closed
		assert.Equal(t, "closed", got.status)
		assert.Nil(t, got.report)
	})

	for name, tc := range map[string]struct {
		before commonModels.Feedback
		status string
	}{
		"nobody to tell for the public contact form": {entry("", "pending"), "resolved"},
		"no change of status":                        {entry("u-owner", "resolved"), "resolved"},
		"work in progress is not a closing status":   {entry("u-owner", "pending"), "in_progress"},
	} {
		t.Run(name, func(t *testing.T) {
			db, _ := testutil.NewMockDB(t)
			notifier := fakeNotifier{make(chan closedNotice, 1)}
			NewFeedbackHandler(db, notifier).notifyIfClosed(tc.before, tc.status)
			assert.Never(t, func() bool { return len(notifier.closed) > 0 }, 100*time.Millisecond, 5*time.Millisecond)
		})
	}
}
