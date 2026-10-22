package feedback

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"
)

// openStatuses are the statuses of feedback no expert has finished with.
var openStatuses = []string{"pending", "in_progress"}

// imagesDir is where feedback images are stored, relative to constants.StorageDataDir.
const imagesDir = "feedback_images"

// HasOpenRunReport reports whether modelID has a run report whose feedback is still open.
func (fs *Store) HasOpenRunReport(modelID uint) (bool, error) {
	var n int64
	err := fs.db.Table("feedback_run_reports AS r").
		Joins("JOIN feedbacks f ON f.id = r.feedback_id").
		Where("r.model_id = ? AND f.status IN ? AND f.deleted_at IS NULL", modelID, openStatuses).
		Count(&n).Error
	if err != nil {
		return false, fmt.Errorf("check open run report of model %d: %w", modelID, err)
	}
	return n > 0, nil
}

// OpenRunReportModelIDs returns the models with an open run report that userID
// filed or owns the model of.
func (fs *Store) OpenRunReportModelIDs(userID string) ([]uint, error) {
	var ids []uint
	err := fs.db.Table("feedback_run_reports AS r").
		Joins("JOIN feedbacks f ON f.id = r.feedback_id").
		Where("f.status IN ? AND f.deleted_at IS NULL", openStatuses).
		Where("f.user_id = ? OR r.model_id IN (SELECT id FROM models WHERE user_id = ?)", userID, userID).
		Distinct().Pluck("r.model_id", &ids).Error
	if err != nil {
		return nil, fmt.Errorf("list open run reports of user %s: %w", userID, err)
	}
	return ids, nil
}

// DeleteFeedback permanently deletes feedback id with its images.
func (fs *Store) DeleteFeedback(id uint) error {
	n, err := fs.purge("id = ?", id)
	if err != nil {
		return err
	}
	if n == 0 {
		return errFeedbackNotFound
	}
	return nil
}

// DeleteClosedOlderThan permanently deletes resolved and closed feedback not
// updated for days, with its images. Rows with deleted_at set go too,
// whatever their status.
func (fs *Store) DeleteClosedOlderThan(days int) (int64, error) {
	return fs.purge("deleted_at IS NOT NULL OR (status IN (?, ?) AND updated_at < NOW() - INTERVAL '1 day' * ?)", "closed", "resolved", days)
}

// DeleteUserFeedback permanently deletes every feedback entry of a user, by id
// or email, with its images.
func (fs *Store) DeleteUserFeedback(userID, email string) (int64, error) {
	return fs.purge("user_id = ? OR user_email = ?", userID, email)
}

// purge permanently deletes the feedback matching where, the rows that
// reference it (ON DELETE CASCADE) and its image files. The rows go first;
// image files that cannot be removed are reported in the error.
func (fs *Store) purge(where string, args ...interface{}) (int64, error) {
	var rows []models.Feedback
	if err := fs.db.Unscoped().Select("id", "image_path", "images").Where(where, args...).Find(&rows).Error; err != nil {
		return 0, fmt.Errorf("find feedback to delete: %w", err)
	}
	if len(rows) == 0 {
		return 0, nil
	}
	ids := make([]uint, len(rows))
	for i, fb := range rows {
		ids[i] = fb.ID
	}
	result := fs.db.Unscoped().Delete(&models.Feedback{}, ids)
	if result.Error != nil {
		return 0, fmt.Errorf("delete %d feedback entries: %w", len(ids), result.Error)
	}
	var errs []error
	for _, fb := range rows {
		for _, p := range imagePaths(fb) {
			if err := os.Remove(filepath.Join(constants.StorageDataDir, p)); err != nil && !errors.Is(err, os.ErrNotExist) {
				errs = append(errs, fmt.Errorf("remove image of feedback %d: %w", fb.ID, err))
			}
		}
	}
	return result.RowsAffected, errors.Join(errs...)
}

// imagePaths returns the stored image paths of fb, relative to
// constants.StorageDataDir. A path outside imagesDir is left out, so a bad
// row can never point the delete at another file.
func imagePaths(fb models.Feedback) []string {
	var paths []string
	if fb.ImagePath != nil {
		paths = append(paths, *fb.ImagePath)
	}
	if fb.Images != nil {
		var images []struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal([]byte(*fb.Images), &images); err == nil {
			for _, img := range images {
				paths = append(paths, img.Path)
			}
		}
	}
	seen := map[string]bool{}
	var safe []string
	for _, p := range paths {
		clean := filepath.Clean(p)
		if seen[clean] || !strings.HasPrefix(clean, imagesDir+string(filepath.Separator)) {
			continue
		}
		seen[clean] = true
		safe = append(safe, clean)
	}
	return safe
}
