package model

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/testutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestNewModelHandler(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)
	assert.NotNil(t, handler)
	assert.NotNil(t, handler.store)
}

func TestNewModelHandlerWithCache(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)
	assert.NotNil(t, handler)
	assert.NotNil(t, handler.store)
}

func TestCreateModel_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/models", strings.NewReader(`{"title":"test"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	handler.CreateModel(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetModel_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/1", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.GetModel(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetModels_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models", nil)

	handler.GetModels(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestDeleteModel_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/models/1", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.DeleteModel(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestShareModel_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/models/1/share", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.ShareModel(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetModelStats_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/stats", nil)

	handler.GetModelStats(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}
