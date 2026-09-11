package models

import "time"

// TimeseriesDataset is a user-owned collection of time-series data points.
// A dataset is either private (only the owner and explicitly shared users can
// read it) or public (any authenticated user can read it). Only the owner can
// update metadata, write data, or manage shares.
type TimeseriesDataset struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserID      string    `gorm:"size:255;not null;index" json:"user_id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description *string   `gorm:"size:1024" json:"description,omitempty"`
	Public      bool      `gorm:"not null;default:false;index" json:"public"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName specifies the table name for TimeseriesDataset.
func (TimeseriesDataset) TableName() string {
	return "timeseries_datasets"
}

// TimeseriesDatasetShare grants a specific user access to a dataset that is
// not public. Permission is "view" (read-only) or "edit" (read + write data).
type TimeseriesDatasetShare struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	DatasetID  uint      `gorm:"not null;index" json:"dataset_id"`
	UserID     string    `gorm:"size:255;not null" json:"user_id"`
	Email      string    `gorm:"size:255;not null" json:"email"`
	Permission string    `gorm:"size:32;not null;default:view" json:"permission"`
	SharedBy   string    `gorm:"size:255;not null" json:"shared_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// TableName specifies the table name for TimeseriesDatasetShare.
func (TimeseriesDatasetShare) TableName() string {
	return "timeseries_dataset_shares"
}

// TimeseriesDataPoint is a single (timestamp, value) sample belonging to a
// dataset. Stored in a TimescaleDB hypertable partitioned on timestamp.
type TimeseriesDataPoint struct {
	DatasetID uint      `gorm:"not null;index" json:"dataset_id"`
	Timestamp time.Time `gorm:"not null" json:"timestamp"`
	Value     float64   `gorm:"not null" json:"value"`
}

// TableName specifies the table name for TimeseriesDataPoint.
func (TimeseriesDataPoint) TableName() string {
	return "timeseries_data"
}
