// Package session serves the modular builder's session for a model — the artefact the builder
// writes and reads: the workflow reference, the projection, the log, the cursor, the redo tail and
// the fingerprint.
//
// It is deliberately **isolated from the legacy model API**: its own routes
// (`/api/models/:id/session`), its own table (`model_sessions`), its own request/response shape.
// The legacy endpoints stay lean and unchanged, so a legacy change cannot collide with this one and
// this one can evolve without renegotiating the legacy contract — the feature flag switches clients
// between the two, and the only cross-over is an optional `modular` parameter on the legacy reads.
//
// What it does NOT re-implement is authorisation: loading a model and answering "may this user touch
// it" are shared with the legacy API on purpose. Two answers to that question would drift, and the
// isolation bought here is about the session's format, not about a second permissions model.
package session

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	commonModels "platform.local/common/pkg/models"
	platformkeycloak "platform.local/platform/keycloak"

	modelservice "spatialhub_backend/internal/model/service"
	appModels "spatialhub_backend/internal/models"
	modelstore "spatialhub_backend/internal/store/model"
)

// ModelReader loads a model by the id in the route — the shared model store in production.
type ModelReader interface {
	FindModelWithWorkspace(modelIDParam string) (*commonModels.Model, error)
}

// Access answers the one authorisation question the reads ask — the same rule the legacy model API
// applies, injected rather than reimplemented (see the package comment).
type Access interface {
	UserHasModelAccess(userID string, model *commonModels.Model) bool
}

// SessionStore is the persistence seam (`internal/store/modelsession` in production).
type SessionStore interface {
	// Get returns (nil, nil) when the model has no session.
	Get(modelID uint) (*appModels.ModelSession, error)
	Save(row *appModels.ModelSession) error
}

// Handler serves the modular builder session endpoints.
type Handler struct {
	models ModelReader
	access Access
	store  SessionStore
}

// NewHandler wires the production collaborators: the shared model store, the shared access rule
// (the same service the legacy model API uses, so the rule cannot drift) and the session store.
//
// Tests build a Handler from the fields directly with fakes — they live in this package and the
// assertion worth making is about the endpoint's behaviour, not about this wiring.
func NewHandler(db *gorm.DB, kc *platformkeycloak.Client, store SessionStore) *Handler {
	return &Handler{
		models: modelstore.NewStore(db),
		access: modelservice.NewModelService(db, kc),
		store:  store,
	}
}

// PutModelSession stores the session for a model, replacing any earlier one.
//
// The whole artefact arrives in one request — the client owns the shape inside it — and is checked
// only at the boundary: the workflow reference, the projection and the fingerprint are required, the
// cursor cannot be negative, and the log and the redo tail must be arrays. Anything deeper is the
// client's business, which is what keeps this endpoint evolvable.
func (h *Handler) PutModelSession(c *gin.Context) {
	model, ok := h.load(c, true)
	if !ok {
		return
	}

	var req putRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid request data: "+err.Error())
		return
	}
	if err := req.validate(); err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	row := &appModels.ModelSession{
		ModelID:         model.ID,
		WorkflowID:      req.WorkflowID,
		WorkflowVersion: req.WorkflowVersion,
		Initial:         datatypes.JSON(defaultJSON(req.Initial, `{}`)),
		Projection:      datatypes.JSON(req.Projection),
		Log:             datatypes.JSON(defaultJSON(req.Log, `[]`)),
		Discarded:       datatypes.JSON(defaultJSON(req.Discarded, `[]`)),
		Cursor:          req.Cursor,
		Fingerprint:     req.Fingerprint,
	}

	if err := h.store.Save(row); err != nil {
		httputil.InternalError(c, "Failed to save the model session")
		return
	}

	httputil.SuccessResponse(c, toResponse(row))
}

// GetModelSession returns the model's session, or 404 when it has none — which is the normal answer
// for every legacy model, not an error.
func (h *Handler) GetModelSession(c *gin.Context) {
	model, ok := h.load(c, false)
	if !ok {
		return
	}

	row, err := h.store.Get(model.ID)
	if err != nil {
		httputil.InternalError(c, "Failed to load the model session")
		return
	}
	if row == nil {
		httputil.NotFound(c, "This model has no modular builder session")
		return
	}

	httputil.SuccessResponse(c, toResponse(row))
}

// load resolves the model and applies the same permission rule the legacy paths use: a read needs
// model access, a write needs to be an expert or the model's owner.
func (h *Handler) load(c *gin.Context, write bool) (*commonModels.Model, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, false
	}

	model, err := h.models.FindModelWithWorkspace(c.Param("id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httputil.NotFound(c, "Model not found")
			return nil, false
		}
		httputil.InternalError(c, "Failed to load the model")
		return nil, false
	}

	if userCtx.AccessLevel == constants.AccessLevelExpert {
		return model, true
	}

	if write {
		if !model.CanBeEditedByUser(userCtx.UserID) {
			httputil.Forbidden(c, "You don't have permission to edit this model")
			return nil, false
		}
		return model, true
	}

	if !h.access.UserHasModelAccess(userCtx.UserID, model) {
		httputil.Forbidden(c, "Access denied")
		return nil, false
	}

	return model, true
}

type putRequest struct {
	WorkflowID string `json:"workflow_id" binding:"required"`
	// WorkflowVersion is the flow version the session was built against; 0 means "unversioned".
	WorkflowVersion int             `json:"workflow_version"`
	Initial         json.RawMessage `json:"initial"`
	Projection      json.RawMessage `json:"projection" binding:"required"`
	Log             json.RawMessage `json:"log"`
	Discarded       json.RawMessage `json:"discarded"`
	Cursor          int             `json:"cursor"`
	Fingerprint     string          `json:"fingerprint" binding:"required"`
}

func (r putRequest) validate() error {
	if r.Cursor < 0 {
		return errors.New("cursor cannot be negative")
	}
	if err := requireJSONArray("log", r.Log); err != nil {
		return err
	}
	if err := requireJSONArray("discarded", r.Discarded); err != nil {
		return err
	}
	if err := requireJSONObject("initial", r.Initial); err != nil {
		return err
	}
	if err := requireJSONObject("projection", r.Projection); err != nil {
		return err
	}
	return nil
}

type sessionResponse struct {
	ModelID         uint            `json:"model_id"`
	WorkflowID      string          `json:"workflow_id"`
	WorkflowVersion int             `json:"workflow_version"`
	Initial         json.RawMessage `json:"initial"`
	Projection      json.RawMessage `json:"projection"`
	Log             json.RawMessage `json:"log"`
	Discarded       json.RawMessage `json:"discarded"`
	Cursor          int             `json:"cursor"`
	Fingerprint     string          `json:"fingerprint"`
}

func toResponse(row *appModels.ModelSession) sessionResponse {
	return sessionResponse{
		ModelID:         row.ModelID,
		WorkflowID:      row.WorkflowID,
		WorkflowVersion: row.WorkflowVersion,
		Initial:         json.RawMessage(row.Initial),
		Projection:      json.RawMessage(row.Projection),
		Log:             json.RawMessage(row.Log),
		Discarded:       json.RawMessage(row.Discarded),
		Cursor:          row.Cursor,
		Fingerprint:     row.Fingerprint,
	}
}

func defaultJSON(value json.RawMessage, fallback string) []byte {
	if len(value) == 0 {
		return []byte(fallback)
	}
	return value
}

func requireJSONArray(field string, value json.RawMessage) error {
	if len(value) == 0 {
		return nil // absent means empty; the store writes the default
	}
	var items []json.RawMessage
	if err := json.Unmarshal(value, &items); err != nil {
		return fmt.Errorf("%s must be a JSON array", field)
	}
	return nil
}

func requireJSONObject(field string, value json.RawMessage) error {
	if len(value) == 0 {
		return nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(value, &object); err != nil {
		return fmt.Errorf("%s must be a JSON object", field)
	}
	return nil
}
