package workflow

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	appModels "spatialhub_backend/internal/models"
	workflowstore "spatialhub_backend/internal/store/workflow"
)

// ── hand-rolled fake, this backend's convention for handler collaborators ────

// fakeStore is an in-memory WorkflowStore: rows are the state, so a create followed by a read
// exercises the same path the clipboard round trip does.
type fakeStore struct {
	rows      []appModels.Workflow
	sessions  int64
	listErr   error
	getErr    error
	createErr error
	updateErr error
	deleteErr error
}

func (f *fakeStore) List() ([]appModels.Workflow, error) { return f.rows, f.listErr }

func (f *fakeStore) Get(workflowID string) (*appModels.Workflow, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	for i := range f.rows {
		if f.rows[i].WorkflowID == workflowID {
			row := f.rows[i]
			return &row, nil
		}
	}
	return nil, nil
}

func (f *fakeStore) Create(row *appModels.Workflow) error {
	if f.createErr != nil {
		return f.createErr
	}
	for i := range f.rows {
		if f.rows[i].WorkflowID == row.WorkflowID {
			return workflowstore.ErrDuplicateWorkflowID
		}
	}
	f.rows = append(f.rows, *row)
	return nil
}

func (f *fakeStore) Update(row *appModels.Workflow) (bool, error) {
	if f.updateErr != nil {
		return false, f.updateErr
	}
	for i := range f.rows {
		if f.rows[i].WorkflowID == row.WorkflowID {
			f.rows[i].Version = row.Version
			f.rows[i].Label = row.Label
			f.rows[i].Definition = row.Definition
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeStore) Delete(workflowID string) (bool, int64, error) {
	if f.deleteErr != nil {
		return false, 0, f.deleteErr
	}
	for i := range f.rows {
		if f.rows[i].WorkflowID == workflowID {
			f.rows = append(f.rows[:i], f.rows[i+1:]...)
			return true, f.sessions, nil
		}
	}
	return false, 0, nil
}

// ── harness ──────────────────────────────────────────────────────────────────

// router mounts the routes behind the user context the real middleware sets (session_context.go sets
// "user_id" and "access_level"; every workflow route sits inside the authenticated group, so both are
// present even though these handlers do not read them).
func router(handler *Handler, userID, accessLevel string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Set("access_level", accessLevel)
		c.Next()
	})
	r.GET("/workflows", handler.ListWorkflows)
	r.GET("/workflows/:id", handler.GetWorkflow)
	r.POST("/workflows", handler.CreateWorkflow)
	r.PUT("/workflows/:id", handler.UpdateWorkflow)
	r.DELETE("/workflows/:id", handler.DeleteWorkflow)
	return r
}

func call(t *testing.T, handler *Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router(handler, "user-1", "user").ServeHTTP(rec, req)
	return rec
}

func newHandler(store *fakeStore) *Handler { return &Handler{store: store} }

// document is a compact definition — the shape the frontend writes, `shell/workflow.dev.json` — used
// where a test does not care about its exact content.
const document = `{"id":"dev-flow","version":1,"label":"Development flow","seed":"testdata/dev-flow.json","nodes":[{"id":"model-start","moduleId":"model-start","label":"Model start"},{"id":"model-save","moduleId":"model-save","label":"Save model"}]}`

// ── GET /workflows ───────────────────────────────────────────────────────────

func TestListWorkflowsReturnsTheRows(t *testing.T) {
	store := &fakeStore{rows: []appModels.Workflow{
		{WorkflowID: "a", Version: 1, Label: "A", Definition: []byte(document)},
		{WorkflowID: "b", Version: 2, Label: "B", Definition: []byte(document)},
	}}

	rec := call(t, newHandler(store), http.MethodGet, "/workflows", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body struct {
		Data []struct {
			WorkflowID string `json:"workflow_id"`
			Version    int    `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
	if len(body.Data) != 2 || body.Data[0].WorkflowID != "a" || body.Data[1].Version != 2 {
		t.Fatalf("unexpected data: %+v", body.Data)
	}
}

func TestListWorkflowsIsAnEmptyListNotEmpty(t *testing.T) {
	// `null` would make the client's own guard the only thing between it and a crash, and the list
	// surface iterates this before it knows whether anything was saved at all.
	rec := call(t, newHandler(&fakeStore{}), http.MethodGet, "/workflows", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
	if got := string(raw["data"]); got != "[]" {
		t.Fatalf("data = %s, want []", got)
	}
}

// ── GET /workflows/:id ───────────────────────────────────────────────────────

func TestGetWorkflowReturnsTheStoredDocument(t *testing.T) {
	store := &fakeStore{rows: []appModels.Workflow{
		{WorkflowID: "dev-flow", Version: 1, Label: "Development flow", IsDefault: true, Definition: []byte(document)},
	}}

	rec := call(t, newHandler(store), http.MethodGet, "/workflows/dev-flow", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			WorkflowID string          `json:"workflow_id"`
			IsDefault  bool            `json:"is_default"`
			Definition json.RawMessage `json:"definition"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
	if envelope.Data.WorkflowID != "dev-flow" || !envelope.Data.IsDefault {
		t.Errorf("unexpected response: %+v", envelope.Data)
	}
	if string(envelope.Data.Definition) != document {
		t.Errorf("definition not returned verbatim: %s", envelope.Data.Definition)
	}
}

func TestGetWorkflowReportsAnUnknownID(t *testing.T) {
	rec := call(t, newHandler(&fakeStore{}), http.MethodGet, "/workflows/nope", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

// ── POST /workflows ──────────────────────────────────────────────────────────

func TestCreateWorkflowDerivesTheRowFromTheDocument(t *testing.T) {
	store := &fakeStore{}

	rec := call(t, newHandler(store), http.MethodPost, "/workflows", document)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(store.rows) != 1 {
		t.Fatalf("want one row, got %d", len(store.rows))
	}
	// The promoted columns come out of the document, never the request as independent input.
	if store.rows[0].WorkflowID != "dev-flow" || store.rows[0].Version != 1 || store.rows[0].Label != "Development flow" {
		t.Errorf("promoted columns not derived from the document: %+v", store.rows[0])
	}
	if string(store.rows[0].Definition) != document {
		t.Errorf("definition not stored verbatim: %s", store.rows[0].Definition)
	}
}

func TestCreateWorkflowRejectsADuplicateID(t *testing.T) {
	store := &fakeStore{rows: []appModels.Workflow{{WorkflowID: "dev-flow"}}}

	rec := call(t, newHandler(store), http.MethodPost, "/workflows", document)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
}

func TestCreateWorkflowRejectsAMalformedDocument(t *testing.T) {
	cases := map[string]struct{ body, want string }{
		"not an object":      {`[]`, "must be a JSON object"},
		"missing id":         {`{"version":1,"label":"x","nodes":[]}`, "id is required"},
		"empty id":           {`{"id":"","version":1,"label":"x","nodes":[]}`, "id must not be empty"},
		"missing version":    {`{"id":"a","label":"x","nodes":[]}`, "version is required"},
		"version not an int": {`{"id":"a","version":"1","label":"x","nodes":[]}`, "version must be an integer"},
		"version not positive": {`{"id":"a","version":0,"label":"x","nodes":[]}`,
			"version must be a positive integer"},
		"missing label": {`{"id":"a","version":1,"nodes":[]}`, "label is required"},
		"nodes not an array": {`{"id":"a","version":1,"label":"x","nodes":{}}`,
			"nodes must be an array"},
		"node without moduleId": {`{"id":"a","version":1,"label":"x","nodes":[{"id":"n1"}]}`,
			"nodes[0].moduleId is required"},
		"node without id": {`{"id":"a","version":1,"label":"x","nodes":[{"moduleId":"m"}]}`,
			"nodes[0].id is required"},
		"node not an object": {`{"id":"a","version":1,"label":"x","nodes":[7]}`,
			"nodes[0] must be an object"},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			store := &fakeStore{}

			rec := call(t, newHandler(store), http.MethodPost, "/workflows", tc.body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.want) {
				t.Errorf("message %q does not name the field (want %q)", rec.Body.String(), tc.want)
			}
			if len(store.rows) != 0 {
				t.Errorf("a rejected document was stored anyway: %+v", store.rows)
			}
		})
	}
}

// ── PUT /workflows/:id ───────────────────────────────────────────────────────

func TestUpdateWorkflowOverwritesTheStoredDocument(t *testing.T) {
	store := &fakeStore{rows: []appModels.Workflow{
		{WorkflowID: "dev-flow", Version: 1, Label: "Old", IsDefault: true, Definition: []byte(`{"id":"dev-flow"}`)},
	}}
	edited := `{"id":"dev-flow","version":2,"label":"Edited","nodes":[{"id":"model-start","moduleId":"model-start"}]}`

	rec := call(t, newHandler(store), http.MethodPut, "/workflows/dev-flow", edited)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if store.rows[0].Version != 2 || store.rows[0].Label != "Edited" || string(store.rows[0].Definition) != edited {
		t.Errorf("update did not overwrite: %+v", store.rows[0])
	}
	// is_default is the server's, not the editor's — an edit must not clear it.
	if !store.rows[0].IsDefault {
		t.Error("update cleared is_default")
	}
}

func TestUpdateWorkflowRejectsAnIDMismatch(t *testing.T) {
	store := &fakeStore{rows: []appModels.Workflow{{WorkflowID: "dev-flow"}}}

	rec := call(t, newHandler(store), http.MethodPut, "/workflows/other", document)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestUpdateWorkflowReportsAnUnknownID(t *testing.T) {
	rec := call(t, newHandler(&fakeStore{}), http.MethodPut, "/workflows/nope", strings.Replace(document, `"id":"dev-flow"`, `"id":"nope"`, 1))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

// ── DELETE /workflows/:id ────────────────────────────────────────────────────

func TestDeleteWorkflowRemovesTheRowAndCountsSessions(t *testing.T) {
	store := &fakeStore{
		rows:     []appModels.Workflow{{WorkflowID: "dev-flow"}},
		sessions: 3,
	}

	rec := call(t, newHandler(store), http.MethodDelete, "/workflows/dev-flow", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(store.rows) != 0 {
		t.Errorf("the row survived the delete: %+v", store.rows)
	}
	var envelope struct {
		Data struct {
			Sessions int64 `json:"sessions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
	if envelope.Data.Sessions != 3 {
		t.Errorf("sessions = %d, want 3", envelope.Data.Sessions)
	}
}

func TestDeleteWorkflowReportsAnUnknownID(t *testing.T) {
	rec := call(t, newHandler(&fakeStore{}), http.MethodDelete, "/workflows/nope", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

// ── the round trip the clipboard depends on ──────────────────────────────────

func TestDefinitionRoundTripsByteForByte(t *testing.T) {
	// The editor copies a workflow's stored document to the clipboard and pastes it into the seed
	// file, so create→read must not reorder a key or rename a field. The document is compact because
	// the JSON encoder compacts insignificant whitespace on the way out (and Postgres `jsonb`
	// normalises it on the way in regardless) — the value is preserved exactly; only whitespace the
	// encoder is free to drop is not. Any key reordering or field renaming would fail this.
	store := &fakeStore{}
	doc := `{"id":"dev-flow","version":1,"label":"Development flow","seed":"testdata/dev-flow.json","nodes":[{"id":"model-start","moduleId":"model-start","label":"Model start","auto":true},{"id":"grid-generation","moduleId":"grid-generation","label":"Grid generation"},{"id":"model-save","moduleId":"model-save","label":"Save model"}]}`

	if rec := call(t, newHandler(store), http.MethodPost, "/workflows", doc); rec.Code != http.StatusOK {
		t.Fatalf("create status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	rec := call(t, newHandler(store), http.MethodGet, "/workflows/dev-flow", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("read status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var envelope struct {
		Data struct {
			Definition json.RawMessage `json:"definition"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
	if got := string(envelope.Data.Definition); got != doc {
		t.Errorf("definition did not round-trip byte for byte\n got: %s\nwant: %s", got, doc)
	}
}
