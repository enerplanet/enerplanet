package models

import "time"

// MemeLeg is the framework leg a MEME run belongs to. One row per (model, leg)
// so the Calliope and PyPSA legs never share a run record (a PyPSA dispatch
// must never "resume by id" the Calliope leg's TentaCron job, and vice versa).
// Both legs run over MEME/TentaCron, so a single table with a leg discriminator
// is the reuse-maximising shape (migration 048).
const (
	MemeLegCalliope = "calliope" // the default electricity dispatch leg
	MemeLegPyPSA    = "pypsa"    // the optional power-flow add-on leg
)

// ModelMemeRun is the TentaCron MEME job submitted for a model's leg, one row
// per (model, leg). RunID is the TentaCron request id, persisted so a later
// dispatch retry resumes the SAME job by id instead of resubmitting (TentaCron
// is the durable queue; the backend must never resubmit a job it already
// queued). Status is the run's lifecycle: pending, running, completed, failed.
type ModelMemeRun struct {
	ModelID   uint   `gorm:"primaryKey" json:"model_id"`
	Leg       string `gorm:"primaryKey;size:32;default:calliope" json:"leg"`
	RunID     string `gorm:"size:255;not null" json:"run_id"`
	Status    string `gorm:"size:32;not null" json:"status"`
	Error     *string `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelMemeRun) TableName() string {
	return "model_meme_runs"
}

// MEME run lifecycle statuses (model_meme_runs.status).
const (
	// MemeRunStatusPending is a run recorded but not yet dispatched.
	MemeRunStatusPending = "pending"
	// MemeRunStatusRunning is a run dispatched and in-flight (MEME solving
	// through the TentaCron durable queue).
	MemeRunStatusRunning = "running"
	// MemeRunStatusCompleted is a run whose result zip was stored AND ingested
	// into the R2 result tables. It is terminal.
	MemeRunStatusCompleted = "completed"
	// MemeRunStatusFailed is a run whose dispatch failed or whose result-ingest
	// (Coati/R2 parse) failed. It is terminal.
	MemeRunStatusFailed = "failed"
)

// MemeRunFinished reports whether a MEME run status is terminal. Only
// MemeRunStatusCompleted and MemeRunStatusFailed are terminal; a run in either
// state can only be re-run by a user-initiated re-solve (a fresh dispatch).
func MemeRunFinished(status string) bool {
	switch status {
	case MemeRunStatusCompleted, MemeRunStatusFailed:
		return true
	}
	return false
}