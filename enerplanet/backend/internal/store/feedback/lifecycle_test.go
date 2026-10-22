package feedback

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"
	"spatialhub_backend/internal/testutil"
)

func strPtr(s string) *string { return &s }

func TestImagePaths_keepsOnlyFilesInTheImagesFolder(t *testing.T) {
	fb := models.Feedback{
		ImagePath: strPtr("feedback_images/7_1.png"),
		Images:    strPtr(`[{"path":"feedback_images/7_1.png"},{"path":"feedback_images/7_2.jpg"},{"path":"../../etc/passwd"},{"path":"feedback_images/../other/x.png"},{"path":"models/9/result.zip"}]`),
	}
	assert.Equal(t, []string{"feedback_images/7_1.png", "feedback_images/7_2.jpg"}, imagePaths(fb))
	assert.Empty(t, imagePaths(models.Feedback{Images: strPtr("not json")}))
}

func TestDeleteFeedback_removesTheRowAndItsImages(t *testing.T) {
	t.Chdir(t.TempDir())
	dir := filepath.Join(constants.StorageDataDir, imagesDir)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	kept := filepath.Join(dir, "8_1.png")
	gone := filepath.Join(dir, "7_1.png")
	for _, f := range []string{kept, gone} {
		require.NoError(t, os.WriteFile(f, []byte("png"), 0o600))
	}

	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(`SELECT "id","image_path","images" FROM "feedbacks" WHERE id = \$1`).
		WithArgs(7).
		WillReturnRows(sqlmock.NewRows([]string{"id", "image_path", "images"}).
			AddRow(7, "feedback_images/7_1.png", `[{"path":"feedback_images/7_1.png"}]`))
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "feedbacks" WHERE "feedbacks"."id" = \$1`).WithArgs(7).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, NewStore(db).DeleteFeedback(7))

	assert.NoFileExists(t, gone)
	assert.FileExists(t, kept)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteFeedback_unknownIDIsNotFound(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	mock.ExpectQuery(`SELECT "id","image_path","images" FROM "feedbacks"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "image_path", "images"}))

	assert.ErrorIs(t, NewStore(db).DeleteFeedback(99), errFeedbackNotFound)
}
