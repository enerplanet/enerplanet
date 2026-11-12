package models

import (
	"time"

	"gorm.io/datatypes"
)

// ModelSession is the modular (Model Builder) session stored beside a model: the artefact the
// builder writes and reads — workflow reference, projection, log, cursor, redo tail, fingerprint.
//
// One row per model, like ModelMemeRun. The row *is* the artefact: a loader adopts Projection as-is
// and verifies it against Fingerprint, while replaying Log is the recovery path, not the load path.
// Log and Discarded are JSONB on purpose — their shape belongs to the client that writes them, so a
// new transaction field costs a client change and no migration.
//
// Deliberately app-owned and isolated: legacy models simply have no row here, nothing in the legacy
// model path reads this table, and `PUT/GET /api/models/:id/session` is the only way in or out.
type ModelSession struct {
	ModelID uint `gorm:"primaryKey;column:model_id" json:"model_id"`

	WorkflowID      string `gorm:"size:255;not null;column:workflow_id" json:"workflow_id"`
	WorkflowVersion int    `gorm:"not null;column:workflow_version" json:"workflow_version"`

	// Initial is the projection the session started from — the base replay needs.
	Initial datatypes.JSON `gorm:"type:jsonb;not null" json:"initial"`
	// Projection is the state at Cursor.
	Projection datatypes.JSON `gorm:"type:jsonb;not null" json:"projection"`
	// Log is the applied prefix of transactions (revisions 1..Cursor).
	Log datatypes.JSON `gorm:"type:jsonb;not null;column:log" json:"log"`
	// Discarded is the redo tail (revisions Cursor+1..), so redo survives a reload.
	Discarded datatypes.JSON `gorm:"type:jsonb;not null" json:"discarded"`
	// Cursor is how many transactions of Log are applied.
	Cursor int `gorm:"not null" json:"cursor"`

	// Fingerprint covers Projection only; a mismatch makes a loader replay Log instead.
	Fingerprint string `gorm:"size:255;not null" json:"fingerprint"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelSession) TableName() string {
	return "model_sessions"
}

// ModelStatusIncomplete is the status the modular builder creates a model with, until its flow is
// complete and the save node promotes it to `draft`. The run paths refuse it (prepareModelRun), so
// an unfinished model can never be run against a configuration that does not exist yet.
//
// Declared here, not with the shared status constants: those live in the `infrastructure` submodule
// (`common/pkg/models`, re-exported from `common/pkg/contracts`), and nothing in this repo can add
// to them without a submodule edit and a pointer bump. The real authority for what the column
// accepts is the DB's `chk_model_status` CHECK — extended by migration 060 to include this value.
const ModelStatusIncomplete = "incomplete"
