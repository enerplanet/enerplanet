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

// Embedded rather than read from a path: the seeder runs inside the container, where the only file that
// exists is the binary — the same reason migrations are baked rather than mounted. Each is what the
// editor's clipboard emits, pasted here verbatim, so the two sides of the round trip are equal by
// construction.

// The default flow: build a model, save it, run it on Calliope and PyPSA, see the results.
//
//go:embed default_workflow.json
var defaultWorkflowDocument []byte

// The adjustment fragment: building-configurator then technologies, marked isSubflow so a subflow node
// can insert it into a chain.
//
//go:embed adjust_workflow.json
var adjustWorkflowDocument []byte

// The variant-exploration flow: save, fork a variant, adjust it through the fragment, run the copy,
// compare it with the original. A flow of its own, not a fragment, not the default.
//
//go:embed variant_workflow.json
var variantWorkflowDocument []byte

// Stores the seeded workflows, each idempotent by workflow_id: a second run refreshes the row rather
// than duplicating it. The default flow is the one `is_default` row; the fragment is not a flow of its
// own; the variant flow is offered by name.
func seedWorkflow(db *gorm.DB) {
	upsertWorkflow(db, defaultWorkflowDocument, true)
	upsertWorkflow(db, adjustWorkflowDocument, false)
	upsertWorkflow(db, variantWorkflowDocument, false)
}

// upsertWorkflow stores one workflow document by its own id, refreshing the row on a second run rather
// than duplicating it.
func upsertWorkflow(db *gorm.DB, document []byte, isDefault bool) {
	// The promoted columns are read out of the document, never typed in beside it, so the row cannot
	// disagree with the document it stores. The bytes go in untouched: this reads, it does not reshape.
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
