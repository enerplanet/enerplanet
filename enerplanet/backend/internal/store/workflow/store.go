// Package workflow persists the Model Builder's workflows (internal/models.Workflow — the flow
// document the editor authors and the builder runs).
//
// It is deliberately isolated from the legacy model store: the builder owns this table and the shape
// inside it, so a change here can never collide with a legacy model change, and a legacy request
// never pays for these columns. The only thing it reaches outside its own table is a count of the
// sessions that reference a workflow by id — for the delete warning — and that read is by string,
// not by foreign key, because sessions reference a document rather than own a row.
package workflow

import (
	"errors"

	"github.com/lib/pq"
	"gorm.io/gorm"

	"spatialhub_backend/internal/models"
)

// ErrDuplicateWorkflowID is the sentinel a create returns when the workflow_id already exists — the
// API turns it into a 409 rather than a 500, since a duplicate name is the client's mistake, not a
// server fault.
var ErrDuplicateWorkflowID = errors.New("a workflow with this id already exists")

// Store reads and writes Model Builder workflows.
type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// List returns every workflow, oldest first — the order the list surface shows, and a stable one so
// a saved edit does not make rows jump.
func (s *Store) List() ([]models.Workflow, error) {
	var rows []models.Workflow
	err := s.db.Order("id").Find(&rows).Error
	return rows, err
}

// Get returns the workflow with that workflow_id, or (nil, nil) when none exists — a missing row is a
// normal answer for a read (the caller answers 404), not an error.
func (s *Store) Get(workflowID string) (*models.Workflow, error) {
	var row models.Workflow
	err := s.db.Where("workflow_id = ?", workflowID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Create inserts a workflow. A workflow_id that is already taken comes back as ErrDuplicateWorkflowID
// rather than a raw driver error, so the caller can answer 409 without knowing this is Postgres.
func (s *Store) Create(row *models.Workflow) error {
	if err := s.db.Create(row).Error; err != nil {
		if isUniqueViolation(err) {
			return ErrDuplicateWorkflowID
		}
		return err
	}
	return nil
}

// Update overwrites the editable columns of the workflow identified by row.WorkflowID and reports
// whether it found a row.
//
// The columns are overwritten wholesale, not patched: the definition is a whole document, so a save
// that omitted a field would leave the row describing a workflow that no longer exists. workflow_id
// is NOT among them — the API addresses a row by that string and a session references it, so a
// rename would orphan every session built against it; an id is an identity, not a field. is_default
// is left alone for the same reason: the seeded flag is the server's, not the editor's.
func (s *Store) Update(row *models.Workflow) (bool, error) {
	result := s.db.Model(&models.Workflow{}).
		Where("workflow_id = ?", row.WorkflowID).
		Updates(map[string]any{
			"version":     row.Version,
			"label":       row.Label,
			"description": row.Description,
			"is_subflow":  row.IsSubflow,
			"definition":  row.Definition,
			"updated_at":  gorm.Expr("CURRENT_TIMESTAMP"),
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

// Delete removes the workflow with that workflow_id and reports whether it existed, along with how
// many sessions reference that id.
//
// The count is taken after the delete and from `model_sessions` directly: there is no foreign key
// between the two tables (see internal/models.Workflow), so removing a workflow deliberately leaves
// its sessions untouched — the count exists so the UI can warn before the id stops resolving, not so
// the store can cascade.
func (s *Store) Delete(workflowID string) (bool, int64, error) {
	result := s.db.Where("workflow_id = ?", workflowID).Delete(&models.Workflow{})
	if result.Error != nil {
		return false, 0, result.Error
	}
	if result.RowsAffected == 0 {
		return false, 0, nil
	}

	var sessions int64
	if err := s.db.Table("model_sessions").Where("workflow_id = ?", workflowID).Count(&sessions).Error; err != nil {
		return true, 0, err
	}
	return true, sessions, nil
}

// isUniqueViolation reports whether err is Postgres' unique-constraint violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23505"
}
