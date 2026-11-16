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

// seedWorkflow stores the default workflow, idempotent by workflow_id: re-running `make seed`
// refreshes it rather than failing on the unique constraint or duplicating it, the way seedWebservice
// keeps its singleton current.
func seedWorkflow(db *gorm.DB) {
	// The promoted columns are read OUT of the document — the file's id, version and label — not typed
	// in beside it, so the row can never disagree with the document it stores. The bytes themselves go
	// in untouched: this unmarshal only reads, it does not reshape.
	var fields struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
		Label   string `json:"label"`
	}
	if err := json.Unmarshal(defaultWorkflowDocument, &fields); err != nil {
		log.Printf("Failed to parse the default workflow: %v", err)
		return
	}

	row := models.Workflow{
		WorkflowID: fields.ID,
		Version:    fields.Version,
		Label:      fields.Label,
		Definition: datatypes.JSON(defaultWorkflowDocument),
		IsDefault:  true,
	}

	var existing models.Workflow
	result := db.Where("workflow_id = ?", row.WorkflowID).First(&existing)
	switch {
	case errors.Is(result.Error, gorm.ErrRecordNotFound):
		if err := db.Create(&row).Error; err != nil {
			log.Printf("Failed to seed the default workflow: %v", err)
			return
		}
		log.Printf("Seeded default workflow: %s (v%d)", row.WorkflowID, row.Version)
	case result.Error != nil:
		log.Printf("Failed to look up the default workflow: %v", result.Error)
	default:
		existing.Version = row.Version
		existing.Label = row.Label
		existing.Definition = row.Definition
		existing.IsDefault = true
		if err := db.Save(&existing).Error; err != nil {
			log.Printf("Failed to update the default workflow: %v", err)
			return
		}
		log.Printf("Updated default workflow: %s (v%d)", existing.WorkflowID, existing.Version)
	}
}
