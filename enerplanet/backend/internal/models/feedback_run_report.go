package models

import "time"

// FeedbackRunReport is the failed run attached to a feedback entry, as the
// model's results held it when the user reported it. Only experts read it.
type FeedbackRunReport struct {
	FeedbackID    uint       `gorm:"primaryKey" json:"feedback_id"`
	ModelID       uint       `json:"model_id"`
	ModelTitle    string     `json:"model_title"`
	FailedStage   string     `json:"failed_stage,omitempty"`
	FailedService string     `json:"failed_service,omitempty"`
	Error         string     `json:"error,omitempty"`
	FailedAt      *time.Time `json:"failed_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// TableName pins the table name to the migration's.
func (FeedbackRunReport) TableName() string { return "feedback_run_reports" }
