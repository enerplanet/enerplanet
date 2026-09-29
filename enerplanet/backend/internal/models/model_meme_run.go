package models

import "time"

// ModelMemeRun is the TentaCron MEME job submitted for a model, one row per
// model (a new run replaces it). RunID is the TentaCron request id, persisted
// so a later dispatch retry resumes the SAME job by id instead of resubmitting
// (TentaCron is the durable queue; the backend must never resubmit a job it
// already queued). Status is the run's lifecycle: pending, running, completed,
// failed.
type ModelMemeRun struct {
	ModelID   uint      `gorm:"primaryKey" json:"model_id"`
	RunID     string    `gorm:"size:255;not null" json:"run_id"`
	Status    string    `gorm:"size:32;not null" json:"status"`
	Error     *string   `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelMemeRun) TableName() string {
	return "model_meme_runs"
}

// MemeRunFinished reports whether a MEME run status is terminal.
func MemeRunFinished(status string) bool {
	switch status {
	case "completed", "failed":
		return true
	}
	return false
}