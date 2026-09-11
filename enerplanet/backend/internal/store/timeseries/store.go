package timeseries

import (
	"fmt"
	"time"

	"spatialhub_backend/internal/models"

	"gorm.io/gorm"
)

// Store encapsulates all database operations for the time-series dataset domain.
type Store struct {
	db *gorm.DB
}

// NewStore creates a new time-series Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

// CreateDataset persists a new dataset and returns it with its generated ID.
func (s *Store) CreateDataset(ds *models.TimeseriesDataset) error {
	return s.db.Create(ds).Error
}

// GetDatasetByID loads a dataset by ID.
func (s *Store) GetDatasetByID(id uint) (*models.TimeseriesDataset, error) {
	var ds models.TimeseriesDataset
	err := s.db.Where("id = ?", id).First(&ds).Error
	return &ds, err
}

// ListAccessibleDatasets returns datasets the user can read: their own, public
// ones, and ones shared with them. Owned datasets are listed first.
func (s *Store) ListAccessibleDatasets(userID string) ([]models.TimeseriesDataset, error) {
	var datasets []models.TimeseriesDataset
	err := s.db.
		Where("user_id = ? OR public = ? OR id IN (SELECT dataset_id FROM timeseries_dataset_shares WHERE user_id = ?)",
			userID, true, userID).
		Order(gorm.Expr("user_id = ? DESC, updated_at DESC", userID)).
		Find(&datasets).Error
	return datasets, err
}

// UpdateDataset applies the given column updates to a dataset.
func (s *Store) UpdateDataset(id uint, updates map[string]interface{}) error {
	updates["updated_at"] = time.Now().UTC()
	return s.db.Model(&models.TimeseriesDataset{}).Where("id = ?", id).Updates(updates).Error
}

// DeleteDataset removes a dataset and (via FK cascade) its shares and data.
func (s *Store) DeleteDataset(id uint) error {
	return s.db.Delete(&models.TimeseriesDataset{}, id).Error
}

// ---------------------------------------------------------------------------
// Data points
// ---------------------------------------------------------------------------

// WriteDataPoints bulk-inserts samples for a dataset.
func (s *Store) WriteDataPoints(datasetID uint, points []models.TimeseriesDataPoint) error {
	if len(points) == 0 {
		return nil
	}
	for i := range points {
		points[i].DatasetID = datasetID
	}
	return s.db.Create(&points).Error
}

// ReadDataPoints returns samples for a dataset, optionally filtered to a time
// range, ordered oldest-first.
func (s *Store) ReadDataPoints(datasetID uint, from, to *time.Time, limit int) ([]models.TimeseriesDataPoint, error) {
	q := s.db.Where("dataset_id = ?", datasetID)
	if from != nil {
		q = q.Where("timestamp >= ?", *from)
	}
	if to != nil {
		q = q.Where("timestamp <= ?", *to)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	var points []models.TimeseriesDataPoint
	err := q.Order("timestamp ASC").Find(&points).Error
	return points, err
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

// ShareWithUser creates or updates a user's share on a dataset.
func (s *Store) ShareWithUser(datasetID uint, userID, email, permission, sharedBy string) (*models.TimeseriesDatasetShare, error) {
	if permission == "" {
		permission = "view"
	}
	share := &models.TimeseriesDatasetShare{
		DatasetID:  datasetID,
		UserID:     userID,
		Email:      email,
		Permission: permission,
		SharedBy:   sharedBy,
	}
	result := s.db.Where("dataset_id = ? AND user_id = ?", datasetID, userID).
		Assign(models.TimeseriesDatasetShare{Permission: permission}).
		FirstOrCreate(share)
	if result.Error != nil {
		return nil, fmt.Errorf("share dataset with user: %w", result.Error)
	}
	return share, nil
}

// RevokeShare removes a user's share from a dataset. Returns false if no share
// matched.
func (s *Store) RevokeShare(datasetID, shareID uint) (bool, error) {
	result := s.db.Where("id = ? AND dataset_id = ?", shareID, datasetID).
		Delete(&models.TimeseriesDatasetShare{})
	return result.RowsAffected > 0, result.Error
}

// ListShares returns all shares for a dataset.
func (s *Store) ListShares(datasetID uint) ([]models.TimeseriesDatasetShare, error) {
	var shares []models.TimeseriesDatasetShare
	err := s.db.Where("dataset_id = ?", datasetID).Order("created_at ASC").Find(&shares).Error
	return shares, err
}

// HasShare checks whether a user has a share on a dataset and returns its
// permission. ok is false when the user has no share.
func (s *Store) HasShare(datasetID uint, userID string) (permission string, ok bool) {
	var share models.TimeseriesDatasetShare
	err := s.db.Where("dataset_id = ? AND user_id = ?", datasetID, userID).First(&share).Error
	if err != nil {
		return "", false
	}
	return share.Permission, true
}
