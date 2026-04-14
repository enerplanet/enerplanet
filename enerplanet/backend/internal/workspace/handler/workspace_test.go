package workspace

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/testutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestNewWorkspaceHandler(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewWorkspaceHandler(db, nil, "http://kc", "realm", nil)
	assert.NotNil(t, handler)
	assert.NotNil(t, handler.service)
}

func TestGetUserWorkspaces_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewWorkspaceHandler(db, nil, "http://kc", "realm", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/workspaces", nil)

	handler.GetUserWorkspaces(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestCreateWorkspace_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewWorkspaceHandler(db, nil, "http://kc", "realm", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/workspaces", nil)

	handler.CreateWorkspace(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetPreferredWorkspace_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewWorkspaceHandler(db, nil, "http://kc", "realm", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/workspaces/preferred", nil)

	handler.GetPreferredWorkspace(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}
