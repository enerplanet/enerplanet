package models

import "time"

// ModelCity2TabulaRun is the City2TABULA pipeline run triggered for a model's
// polygon, one row per model (a new polygon replaces it). Status is
// City2TABULA's own run status: pending, running, completed, no_data, failed.
type ModelCity2TabulaRun struct {
	ModelID   uint      `gorm:"primaryKey" json:"model_id"`
	RunID     string    `gorm:"size:255;not null" json:"run_id"`
	Country   string    `gorm:"size:255;not null" json:"country"`
	Status    string    `gorm:"size:32;not null" json:"status"`
	Error     *string   `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelCity2TabulaRun) TableName() string {
	return "model_city2tabula_runs"
}

// City2TabulaRunFinished reports whether a City2TABULA run status is terminal.
func City2TabulaRunFinished(status string) bool {
	switch status {
	case "completed", "no_data", "failed":
		return true
	}
	return false
}
