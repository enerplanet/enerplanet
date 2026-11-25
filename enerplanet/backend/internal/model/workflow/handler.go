// Package workflow serves the Model Builder's workflows — the flow documents the editor authors and
// the builder runs. It lists them, reads one, creates, updates and deletes them.
//
// It is deliberately **isolated from the legacy model API**: its own routes (`/api/workflows`), its
// own table (`workflows`), its own request/response shape, exactly as the session API is. The legacy
// endpoints stay lean and unchanged, so a legacy change cannot collide with this one and this one can
// evolve without renegotiating the legacy contract.
//
// What it does NOT do is validate meaning. The module catalogue that would tell it whether a node's
// requirements are met lives in the frontend (§2 of the plan), so the server checks the document's
// **shape** only — id, version, label and a nodes array of identified objects — and stores the rest
// verbatim. The definition is never unmarshalled into a Go type on the read or write path: the client
// copies it to the clipboard and pastes it into the seed file, and anything that reordered a key or
// renamed a field on the way through would silently corrupt that round trip.
package workflow

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"platform.local/common/pkg/httputil"

	appModels "spatialhub_backend/internal/models"
	workflowstore "spatialhub_backend/internal/store/workflow"
)

// WorkflowStore is the persistence seam (`internal/store/workflow` in production).
type WorkflowStore interface {
	List() ([]appModels.Workflow, error)
	// Get returns (nil, nil) when no workflow has that workflow_id.
	Get(workflowID string) (*appModels.Workflow, error)
	Create(row *appModels.Workflow) error
	// Update overwrites the editable columns and reports whether a row existed.
	Update(row *appModels.Workflow) (bool, error)
	// Delete removes the row and reports whether it existed and how many sessions reference the id.
	Delete(workflowID string) (bool, int64, error)
}

// Handler serves the Model Builder workflow endpoints.
type Handler struct {
	store WorkflowStore
}

// NewHandler wires the production collaborator: the workflow store. Tests build a Handler from the
// field directly with a fake — they live in this package and the assertion worth making is about the
// endpoint's behaviour, not about this wiring.
func NewHandler(_ *gorm.DB, store WorkflowStore) *Handler {
	return &Handler{store: store}
}

// ListWorkflows returns every workflow, the whole document included — the list surface copies a row's
// document to the clipboard, so withholding it would force a second read per row.
func (h *Handler) ListWorkflows(c *gin.Context) {
	rows, err := h.store.List()
	if err != nil {
		httputil.InternalError(c, "Failed to list the workflows")
		return
	}
	// An empty set is an empty list, never `null`: the client iterates this unconditionally.
	if rows == nil {
		rows = []appModels.Workflow{}
	}

	responses := make([]workflowResponse, 0, len(rows))
	for i := range rows {
		responses = append(responses, toResponse(&rows[i]))
	}
	httputil.SuccessResponse(c, responses)
}

// GetWorkflow returns the workflow addressed by its workflow_id, or 404 when none exists.
func (h *Handler) GetWorkflow(c *gin.Context) {
	row, err := h.store.Get(c.Param("id"))
	if err != nil {
		httputil.InternalError(c, "Failed to load the workflow")
		return
	}
	if row == nil {
		httputil.NotFound(c, "Workflow not found")
		return
	}

	httputil.SuccessResponse(c, toResponse(row))
}

// CreateWorkflow stores a new workflow.
//
// The request body IS the workflow document, and the row's promoted columns are read out of it, never
// taken as independent input — so a client cannot store a row whose label disagrees with its own
// document. A workflow_id already in use is a 409: a name is the client's to choose, and choosing a
// taken one is a conflict, not a server fault.
func (h *Handler) CreateWorkflow(c *gin.Context) {
	raw, fields, ok := h.readDocument(c)
	if !ok {
		return
	}

	row := &appModels.Workflow{
		WorkflowID:  fields.ID,
		Version:     fields.Version,
		Label:       fields.Label,
		Description: fields.Description,
		IsSubflow:   fields.IsSubflow,
		Definition:  datatypes.JSON(raw),
	}

	if err := h.store.Create(row); err != nil {
		if errors.Is(err, workflowstore.ErrDuplicateWorkflowID) {
			httputil.Conflict(c, "A workflow with this id already exists")
			return
		}
		httputil.InternalError(c, "Failed to save the workflow")
		return
	}

	httputil.SuccessResponse(c, toResponse(row))
}

// UpdateWorkflow overwrites the workflow addressed by its workflow_id.
//
// The body is the whole document, as on create. Its id must equal the id in the path: an id is the
// identity a session references, so editing a workflow never renames it — a rename would orphan every
// session built against the old name. is_default is not the editor's to change, so it is left as it
// was.
func (h *Handler) UpdateWorkflow(c *gin.Context) {
	id := c.Param("id")

	raw, fields, ok := h.readDocument(c)
	if !ok {
		return
	}
	if fields.ID != id {
		httputil.BadRequest(c, "id in the body must match the id in the path")
		return
	}

	found, err := h.store.Update(&appModels.Workflow{
		WorkflowID:  id,
		Version:     fields.Version,
		Label:       fields.Label,
		Description: fields.Description,
		IsSubflow:   fields.IsSubflow,
		Definition:  datatypes.JSON(raw),
	})
	if err != nil {
		httputil.InternalError(c, "Failed to save the workflow")
		return
	}
	if !found {
		httputil.NotFound(c, "Workflow not found")
		return
	}

	// Re-read so the response carries the server-set columns (is_default, updated_at) rather than a
	// guess at them.
	stored, err := h.store.Get(id)
	if err != nil || stored == nil {
		httputil.InternalError(c, "Failed to load the saved workflow")
		return
	}

	httputil.SuccessResponse(c, toResponse(stored))
}

// DeleteWorkflow removes the workflow addressed by its workflow_id.
//
// There is no foreign key from model_sessions, so deleting a workflow never touches the sessions built
// against it; the response reports how many reference the id, so the UI can warn that copies of the
// definition are now the only way back to it.
func (h *Handler) DeleteWorkflow(c *gin.Context) {
	found, sessions, err := h.store.Delete(c.Param("id"))
	if err != nil {
		httputil.InternalError(c, "Failed to delete the workflow")
		return
	}
	if !found {
		httputil.NotFound(c, "Workflow not found")
		return
	}

	httputil.SuccessResponse(c, gin.H{"sessions": sessions})
}

// readDocument reads the request body as a workflow document and validates its shape. On failure it
// answers 400 naming the field and returns ok=false.
func (h *Handler) readDocument(c *gin.Context) ([]byte, documentFields, bool) {
	raw, err := c.GetRawData()
	if err != nil {
		httputil.BadRequest(c, "Could not read the request body")
		return nil, documentFields{}, false
	}

	fields, err := validateDocument(raw)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return nil, documentFields{}, false
	}
	return raw, fields, true
}

// documentFields are the scalars the server promotes out of the document; the document itself is
// stored untouched, so nothing here is ever written back over it.
type documentFields struct {
	ID          string
	Version     int
	Label       string
	Description string
	IsSubflow   bool
}

// validateDocument checks the document's SHAPE only — the module catalogue that would give its
// meaning lives in the frontend (see the package comment) — and returns the promoted scalars. It
// never fails to identify which field is wrong, because a client authoring a flow has only the 400
// message to go on.
func validateDocument(raw []byte) (documentFields, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return documentFields{}, errors.New("the definition must be a JSON object")
	}

	id, err := requireString("id", object["id"], true)
	if err != nil {
		return documentFields{}, err
	}

	var version int
	rawVersion, present := object["version"]
	if !present {
		return documentFields{}, errors.New("version is required")
	}
	if err := json.Unmarshal(rawVersion, &version); err != nil {
		return documentFields{}, errors.New("version must be an integer")
	}
	if version < 1 {
		return documentFields{}, errors.New("version must be a positive integer")
	}

	label, err := requireString("label", object["label"], true)
	if err != nil {
		return documentFields{}, err
	}

	// description and isSubflow are optional: a document may omit them, but when present a wrong type
	// is a rejection, the same rigour label and version get.
	description, err := optionalString("description", object["description"])
	if err != nil {
		return documentFields{}, err
	}
	isSubflow, err := optionalBool("isSubflow", object["isSubflow"])
	if err != nil {
		return documentFields{}, err
	}

	if err := requireNodes(object["nodes"]); err != nil {
		return documentFields{}, err
	}

	return documentFields{ID: id, Version: version, Label: label, Description: description, IsSubflow: isSubflow}, nil
}

// requireNodes checks that nodes is an array of objects, each carrying a non-empty string id and exactly
// one of the two kinds of step: moduleId (a module at this position) or workflows (a subflow spliced in
// here). The node id is what an error message can name ("which node is wrong"); the step kind is what a
// future reader resolves against the frontend catalogue.
//
// The discriminant is the frontend's own (`workflows/types.ts` `nodeProblem`): a step is a module xor a
// subflow, never both and never neither. Keeping the two halves in step is what makes "a document the
// editor can author is a document this validator accepts" true — it was false while a subflow step was
// rejected here for lacking a moduleId the editor had deliberately left out.
func requireNodes(raw json.RawMessage) error {
	if raw == nil {
		return errors.New("nodes is required")
	}

	var nodes *[]json.RawMessage
	if err := json.Unmarshal(raw, &nodes); err != nil || nodes == nil {
		return errors.New("nodes must be an array")
	}

	for i, rawNode := range *nodes {
		if err := requireNode(i, rawNode); err != nil {
			return err
		}
	}

	return nil
}

// requireNode checks one node: its id, and exactly one step kind.
func requireNode(index int, rawNode json.RawMessage) error {
	var node map[string]json.RawMessage
	if err := json.Unmarshal(rawNode, &node); err != nil || node == nil {
		return fmt.Errorf("nodes[%d] must be an object", index)
	}
	if _, err := requireString(fmt.Sprintf("nodes[%d].id", index), node["id"], true); err != nil {
		return err
	}

	_, hasModule := node["moduleId"]
	_, hasWorkflows := node["workflows"]

	switch {
	case hasModule && hasWorkflows:
		return fmt.Errorf(
			"nodes[%d] carries both moduleId and workflows; a step is a module or a subflow, never both", index)
	case !hasModule && !hasWorkflows:
		return fmt.Errorf(
			"nodes[%d] carries neither moduleId nor workflows; every step is a module or a subflow", index)
	case hasModule:
		if _, err := requireString(fmt.Sprintf("nodes[%d].moduleId", index), node["moduleId"], true); err != nil {
			return err
		}
		return nil
	default:
		return requireWorkflowIDs(index, node["workflows"])
	}
}

// requireWorkflowIDs checks a subflow step's workflows: a non-empty array of non-empty workflow ids.
func requireWorkflowIDs(index int, raw json.RawMessage) error {
	var ids *[]json.RawMessage
	if err := json.Unmarshal(raw, &ids); err != nil || ids == nil {
		return fmt.Errorf("nodes[%d].workflows must be an array", index)
	}
	if len(*ids) == 0 {
		return fmt.Errorf("nodes[%d].workflows must not be empty", index)
	}

	for j, rawID := range *ids {
		if _, err := requireString(fmt.Sprintf("nodes[%d].workflows[%d]", index, j), rawID, true); err != nil {
			return err
		}
	}

	return nil
}

// requireString unmarshals a field that must be a string, and — when nonEmpty — must not be blank.
func requireString(field string, raw json.RawMessage, nonEmpty bool) (string, error) {
	if raw == nil {
		return "", fmt.Errorf("%s is required", field)
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", field)
	}
	if nonEmpty && value == "" {
		return "", fmt.Errorf("%s must not be empty", field)
	}
	return value, nil
}

// optionalString unmarshals a field that is absent or a string; a present non-string is a rejection.
func optionalString(field string, raw json.RawMessage) (string, error) {
	if raw == nil {
		return "", nil
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", field)
	}
	return value, nil
}

// optionalBool unmarshals a field that is absent or a boolean; a present non-boolean is a rejection.
func optionalBool(field string, raw json.RawMessage) (bool, error) {
	if raw == nil {
		return false, nil
	}

	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, fmt.Errorf("%s must be a boolean", field)
	}
	return value, nil
}

type workflowResponse struct {
	WorkflowID  string          `json:"workflow_id"`
	Version     int             `json:"version"`
	Label       string          `json:"label"`
	Description string          `json:"description"`
	IsDefault   bool            `json:"is_default"`
	IsSubflow   bool            `json:"is_subflow"`
	Definition  json.RawMessage `json:"definition"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

// toResponse hands the stored definition back as the bytes it arrived as. json.RawMessage is a
// pass-through: it is not unmarshalled and re-marshalled, so key order and field names survive the
// round trip the clipboard depends on. (Insignificant whitespace may be compacted by the encoder,
// and Postgres `jsonb` normalises it on the way in regardless; the value, not a byte image, is what
// is stored.)
func toResponse(row *appModels.Workflow) workflowResponse {
	return workflowResponse{
		WorkflowID:  row.WorkflowID,
		Version:     row.Version,
		Label:       row.Label,
		Description: row.Description,
		IsDefault:   row.IsDefault,
		IsSubflow:   row.IsSubflow,
		Definition:  json.RawMessage(row.Definition),
		CreatedAt:   row.CreatedAt.Format(timeLayout),
		UpdatedAt:   row.UpdatedAt.Format(timeLayout),
	}
}

// timeLayout matches the timestamp format the rest of the API emits.
const timeLayout = "2006-01-02T15:04:05Z07:00"
