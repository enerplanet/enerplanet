package result

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/middleware"
	"spatialhub_backend/internal/testutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestNewResultHandler(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)
	assert.NotNil(t, handler)
	assert.NotNil(t, handler.store)
	assert.Equal(t, "secret", handler.callbackSecret)
}

func TestGetModelResults_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/1/results", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.GetModelResults(c)

	// Without user context, should return error
	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetResult_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/results/1", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.GetResult(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestGetLocationTimeSeries_NoUserContext(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "secret", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/models/1/results/location/loc1", nil)
	c.Params = gin.Params{
		{Key: "id", Value: "1"},
		{Key: "location", Value: "loc1"},
	}

	handler.GetLocationTimeSeries(c)

	assert.NotEqual(t, http.StatusOK, w.Code)
}

func TestCallbackUpload_MissingSecret(t *testing.T) {
	t.Setenv("CALLBACK_SECRET", "mysecret")
	t.Setenv("APP_ENV", "production")

	db, _ := testutil.NewMockDB(t)
	handler := NewResultHandler(db, nil, nil, "mysecret", nil)

	router := gin.New()
	router.POST("/callback/:id", middleware.CallbackAuthMiddleware(), handler.CallbackUpload)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/callback/1", nil)
	router.ServeHTTP(w, req)

	// Missing or wrong callback secret should fail
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
