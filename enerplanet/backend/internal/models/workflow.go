package models

import (
	"time"

	"gorm.io/datatypes"
)

// Workflow is a Model Builder flow the editor authors and the builder runs: the whole definition
// document in one row, with a thin scalar surface promoted for lookup.
//
// The shape of Definition belongs to the frontend that writes it — the seed copies it from the
// editor's clipboard verbatim — so it is JSONB and a new node field costs a client change and no
// migration. WorkflowID is the document's own id and the only reference anything else holds: a
// session records the workflow it was built against by that string, which is why it is the key the
// API addresses and ModelSessions never point at the serial.
//
// Deliberately app-owned and isolated, like ModelSession: nothing in the legacy model path reads
// this table, and `/api/workflows` is the only way in or out. There is no foreign key from
// model_sessions on purpose — a workflow is a document a session references, not a row it owns, so
// deleting one must not cascade into the sessions built against it.
type Workflow struct {
	ID uint `gorm:"primaryKey" json:"id"`

	// WorkflowID is the definition's own id, e.g. "dev-flow"; the name sessions reference.
	WorkflowID string `gorm:"size:255;not null;unique;column:workflow_id" json:"workflow_id"`
	// Version is the definition's version; the definition declares it, so it is derived, never input.
	Version int `gorm:"not null" json:"version"`
	// Label is the human-readable name; the definition declares it, so it is derived, never input.
	Label string `gorm:"size:255;not null" json:"label"`
	// Description is the human line shown where a workflow is chosen; the definition declares it, so
	// it is derived, never input.
	Description string `gorm:"size:255;not null" json:"description"`
	// Definition is the whole document, stored exactly as the client wrote it.
	Definition datatypes.JSON `gorm:"type:jsonb;not null" json:"definition"`
	// IsDefault marks the seeded flow; at most one row, enforced by a partial unique index.
	IsDefault bool `gorm:"not null;default:false;column:is_default" json:"is_default"`
	// IsSubflow marks the document as a fragment inserted into another flow; the definition declares it,
	// so it is derived, never input, and such a row is never offered as a flow of its own.
	IsSubflow bool `gorm:"not null;default:false;column:is_subflow" json:"is_subflow"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Workflow) TableName() string {
	return "workflows"
}
