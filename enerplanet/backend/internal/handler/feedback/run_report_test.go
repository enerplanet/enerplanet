package feedback

import (
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
	"spatialhub_backend/internal/testutil"
)

const failedResultsJSON = `{"error": "model 30: none of the model's 107 buildings has an hourly demand profile", "failed_stage": "queue", "failed_service": "city2tabula"}`

// reportRequest runs runReportFromForm for user on a form with the given
// model_id, the model row being returned by the mock.
func reportRequest(t *testing.T, form string, user httputil.UserContext, row *sqlmock.Rows) (*httptest.ResponseRecorder, bool, func() error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, mock := testutil.NewMockDB(t)
	if row != nil {
		mock.ExpectQuery(`SELECT .* FROM "models"`).WillReturnRows(row)
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
