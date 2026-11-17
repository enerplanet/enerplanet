package modelservice

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"
	backendmodels "spatialhub_backend/internal/models"
	"spatialhub_backend/internal/testutil"
)

// A model whose results are still being read is a run in progress, so a
// second run cannot start over it.
func TestPrepareModelRun_rejectsInProgressStatuses(t *testing.T) {
	for _, status := range []string{models.ModelStatusQueue, models.ModelStatusRunning, models.ModelStatusProcessing} {
		t.Run(status, func(t *testing.T) {
			db, mock := testutil.NewMockDB(t)
			mock.ExpectQuery(`SELECT \* FROM "models"`).
				WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "status"}).AddRow(5, "owner", status))

			_, err := NewModelService(db, nil).prepareModelRun(context.Background(), "owner", constants.AccessLevelExpert, "5")

			require.ErrorContains(t, err, "already in progress")
		})
	}
}

// A modular-builder model exists before its flow has finished, so it has no runnable configuration
// yet. This guard is in prepareModelRun, so all three start paths (legacy, MEME Calliope, MEME
// PyPSA) refuse it in one place.
func TestPrepareModelRun_rejectsAnUnfinishedBuilderModel(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(`SELECT \* FROM "models"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "status"}).
			AddRow(5, "owner", backendmodels.ModelStatusIncomplete))

	_, err := NewModelService(db, nil).prepareModelRun(context.Background(), "owner", constants.AccessLevelExpert, "5")

	require.ErrorContains(t, err, "incomplete")
}
