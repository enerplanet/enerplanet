package session

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	commonModels "platform.local/common/pkg/models"

	appModels "spatialhub_backend/internal/models"
)

// ── hand-rolled fakes, this backend's convention for handler collaborators ────

type fakeModels struct {
	model *commonModels.Model
	err   error
}

func (f fakeModels) FindModelWithWorkspace(string) (*commonModels.Model, error) {
	return f.model, f.err
}

type fakeAccess struct{ allow bool }

func (f fakeAccess) UserHasModelAccess(string, *commonModels.Model) bool { return f.allow }

type fakeStore struct {
	row     *appModels.ModelSession
	saved   *appModels.ModelSession
	getErr  error
	saveErr error
}

func (f *fakeStore) Get(uint) (*appModels.ModelSession, error) { return f.row, f.getErr }

func (f *fakeStore) Save(row *appModels.ModelSession) error {
	f.saved = row
	return f.saveErr
}

// ── harness ──────────────────────────────────────────────────────────────────

// router mounts the two routes behind the user context the real middleware sets (session_context.go
// sets "user_id" and "access_level"; httputil.GetUserContext reads exactly those).
func router(handler *Handler, userID, accessLevel string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Set("access_level", accessLevel)
		c.Next()
	})
	r.GET("/models/:id/session", handler.GetModelSession)
	r.PUT("/models/:id/session", handler.PutModelSession)
	return r
}

func call(t *testing.T, handler *Handler, userID, accessLevel, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/models/7/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router(handler, userID, accessLevel).ServeHTTP(rec, req)
	return rec
}

const artefact = `{
	"workflow_id": "wf-core",
	"workflow_version": 3,
	"initial": {},
	"projection": {"modelName": "demo"},
	"log": [{"revision": 1, "primary": [], "cascade": []}],
	"discarded": [],
	"cursor": 1,
	"fingerprint": "fp-abc"
}`

const owner = "owner-1"

func ownedModel() *commonModels.Model {
	return &commonModels.Model{ID: 7, UserID: owner}
}

func newHandler(store *fakeStore, access bool) *Handler {
	return &Handler{models: fakeModels{model: ownedModel()}, access: fakeAccess{allow: access}, store: store}
}

// ── PUT ──────────────────────────────────────────────────────────────────────

func TestPutStoresTheArtefact(t *testing.T) {
	store := &fakeStore{}

	rec := call(t, newHandler(store, false), owner, "user", http.MethodPut, artefact)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if store.saved == nil {
		t.Fatal("nothing was saved")
	}
	if store.saved.ModelID != 7 || store.saved.WorkflowID != "wf-core" || store.saved.WorkflowVersion != 3 {
		t.Errorf("unexpected identity: %+v", store.saved)
	}
	if store.saved.Cursor != 1 || store.saved.Fingerprint != "fp-abc" {
		t.Errorf("unexpected artefact: %+v", store.saved)
	}
	if string(store.saved.Projection) != `{"modelName": "demo"}` {
		t.Errorf("projection not stored verbatim: %s", store.saved.Projection)
	}
	if string(store.saved.Initial) != `{}` {
		t.Errorf("initial not stored: %s", store.saved.Initial)
	}
}

func TestPutDefaultsAnAbsentTailToAnEmptyArray(t *testing.T) {
	store := &fakeStore{}

	rec := call(t, newHandler(store, false), owner, "user", http.MethodPut,
		`{"workflow_id":"wf-core","projection":{},"fingerprint":"fp"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if string(store.saved.Log) != `[]` || string(store.saved.Discarded) != `[]` {
		t.Errorf("want empty arrays, got log=%s discarded=%s", store.saved.Log, store.saved.Discarded)
	}
}

func TestPutRejectsAMalformedArtefact(t *testing.T) {
	cases := map[string]string{
		"log is not an array":        `{"workflow_id":"wf","projection":{},"fingerprint":"fp","log":{}}`,
		"discarded is not an array":  `{"workflow_id":"wf","projection":{},"fingerprint":"fp","discarded":7}`,
		"negative cursor":            `{"workflow_id":"wf","projection":{},"fingerprint":"fp","cursor":-1}`,
		"missing projection":         `{"workflow_id":"wf","fingerprint":"fp"}`,
		"missing fingerprint":        `{"workflow_id":"wf","projection":{}}`,
		"missing workflow reference": `{"projection":{},"fingerprint":"fp"}`,
	}

	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			store := &fakeStore{}

			rec := call(t, newHandler(store, false), owner, "user", http.MethodPut, body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
			}
			if store.saved != nil {
				t.Errorf("a rejected artefact was stored anyway: %+v", store.saved)
			}
		})
	}
}

func TestPutNeedsToBeAllowedToEdit(t *testing.T) {
	store := &fakeStore{}

	rec := call(t, newHandler(store, false), "someone-else", "user", http.MethodPut, artefact)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if store.saved != nil {
		t.Error("a forbidden write reached the store")
	}
}

func TestPutLetsAnExpertWriteAnyModel(t *testing.T) {
	store := &fakeStore{}

	rec := call(t, newHandler(store, false), "an-expert", "expert", http.MethodPut, artefact)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if store.saved == nil {
		t.Error("the expert's write did not reach the store")
	}
}

// ── GET ──────────────────────────────────────────────────────────────────────

func TestGetReportsAModelWithoutASession(t *testing.T) {
	rec := call(t, newHandler(&fakeStore{}, true), owner, "user", http.MethodGet, "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 for a legacy model, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetReturnsTheStoredSession(t *testing.T) {
	store := &fakeStore{row: &appModels.ModelSession{
		ModelID:         7,
		WorkflowID:      "wf-core",
		WorkflowVersion: 3,
		Initial:         []byte(`{}`),
		Projection:      []byte(`{"modelName": "demo"}`),
		Log:             []byte(`[]`),
		Discarded:       []byte(`[]`),
		Cursor:          1,
		Fingerprint:     "fp-abc",
	}}

	rec := call(t, newHandler(store, true), owner, "user", http.MethodGet, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Data struct {
			WorkflowID  string          `json:"workflow_id"`
			Cursor      int             `json:"cursor"`
			Fingerprint string          `json:"fingerprint"`
			Projection  json.RawMessage `json:"projection"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Data.WorkflowID != "wf-core" || envelope.Data.Cursor != 1 || envelope.Data.Fingerprint != "fp-abc" {
		t.Errorf("unexpected response: %+v", envelope.Data)
	}
	// The bytes are not preserved verbatim, and cannot be: `json.Marshal` compacts a RawMessage, and
	// Postgres `jsonb` normalises key order and whitespace on the way through anyway. That is exactly
	// why the artefact's fingerprint ignores key order (core/fingerprint.ts) — the value is what is
	// being stored, not a byte image of it.
	if string(envelope.Data.Projection) != `{"modelName":"demo"}` {
		t.Errorf("unexpected projection: %s", envelope.Data.Projection)
	}
}

func TestGetHonoursReadAccess(t *testing.T) {
	store := &fakeStore{row: &appModels.ModelSession{ModelID: 7, WorkflowID: "wf", Projection: []byte(`{}`), Log: []byte(`[]`), Discarded: []byte(`[]`), Initial: []byte(`{}`)}}
	handler := &Handler{models: fakeModels{model: ownedModel()}, access: fakeAccess{allow: false}, store: store}

	rec := call(t, handler, "someone-else", "user", http.MethodGet, "")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
}
