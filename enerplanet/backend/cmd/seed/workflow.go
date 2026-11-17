package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"log"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"spatialhub_backend/internal/models"
)

// defaultWorkflowDocument is the default Model Builder workflow, embedded rather than read from a
// path: the seeder runs inside the container, where the only source file that exists is the binary —
// the same reason migrations are baked rather than mounted. It is the document the editor's clipboard
// emits (§9 of the plan), copied here verbatim, so the two sides of the round trip are equal by
// construction.
//
//go:embed default_workflow.json
var defaultWorkflowDocument []byte

// adjustWorkflowDocument is the adjustment fragment: the building-configurator and technologies steps
// in order, marked isSubflow so the loader refuses it as a flow of its own and a subflow node can
// insert it into a chain. Embedded for the same reason the default flow is — the container has only
// the binary, and this file is pasted over from the editor's clipboard too.
//
//go:embed adjust_workflow.json
var adjustWorkflowDocument []byte

// variantWorkflowDocument is the variant-exploration flow: save, fork a variant, adjust it through the
// adjustment fragment, run Calliope and PyPSA on the copy, then compare it against the original. A flow of
// its own (not a fragment), and not the default. Embedded for the same reason the others are — the
// container has only the binary, and this file is pasted over from the editor's clipboard too.
//
//go:embed variant_workflow.json
var variantWorkflowDocument []byte

// seedWorkflow stores the seeded workflows, each idempotent by workflow_id: re-running `make seed`
// refreshes a row rather than failing on the unique constraint or duplicating it, the way
// seedWebservice keeps its singleton current. The default flow is the one `is_default` row (the
// partial unique index allows at most one); the adjustment fragment is not a flow of its own; the
// variant-exploration flow is a second runnable flow, offered by name rather than by default.
func seedWorkflow(db *gorm.DB) {
	upsertWorkflow(db, defaultWorkflowDocument, true)
	upsertWorkflow(db, adjustWorkflowDocument, false)
	upsertWorkflow(db, variantWorkflowDocument, false)
}

// upsertWorkflow stores one workflow document by its own id, refreshing the row on a second run rather
// than duplicating it.
func upsertWorkflow(db *gorm.DB, document []byte, isDefault bool) {
	// The promoted columns are read OUT of the document — the file's id, version, label, description and
	// isSubflow — not typed in beside it, so the row can never disagree with the document it stores. The
	// bytes themselves go in untouched: this unmarshal only reads, it does not reshape.
	var fields struct {
		ID          string `json:"id"`
		Version     int    `json:"version"`
		Label       string `json:"label"`
		Description string `json:"description"`
		IsSubflow   bool   `json:"isSubflow"`
	}
	if err := json.Unmarshal(document, &fields); err != nil {
		log.Printf("Failed to parse a seeded workflow: %v", err)
		return
	}

	row := models.Workflow{
		WorkflowID:  fields.ID,
		Version:     fields.Version,
		Label:       fields.Label,
		Description: fields.Description,
		Definition:  datatypes.JSON(document),
		IsDefault:   isDefault,
		IsSubflow:   fields.IsSubflow,
	}

	var existing models.Workflow
	result := db.Where("workflow_id = ?", row.WorkflowID).First(&existing)
	switch {
	case errors.Is(result.Error, gorm.ErrRecordNotFound):
		if err := db.Create(&row).Error; err != nil {
			log.Printf("Failed to seed the workflow %s: %v", row.WorkflowID, err)
			return
		}
		log.Printf("Seeded workflow: %s (v%d)", row.WorkflowID, row.Version)
	case result.Error != nil:
		log.Printf("Failed to look up the workflow %s: %v", row.WorkflowID, result.Error)
	default:
		existing.Version = row.Version
		existing.Label = row.Label
		existing.Description = row.Description
		existing.Definition = row.Definition
		existing.IsDefault = row.IsDefault
		existing.IsSubflow = row.IsSubflow
		if err := db.Save(&existing).Error; err != nil {
			log.Printf("Failed to update the workflow %s: %v", existing.WorkflowID, err)
			return
		}
		log.Printf("Updated workflow: %s (v%d)", existing.WorkflowID, existing.Version)
	}
}
