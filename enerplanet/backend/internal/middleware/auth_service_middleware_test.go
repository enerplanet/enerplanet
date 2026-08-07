package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthServiceMiddlewareRefreshesSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const sessionID = "session-123"
	authService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/internal/validate-session", r.URL.Path)

		cookie, err := r.Cookie("session_id")
		require.NoError(t, err)
		assert.Equal(t, sessionID, cookie.Value)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"user": map[string]string{
				"id":           "user-1",
				"email":        "user@example.com",
				"name":         "Test User",
				"access_level": "high",
				"group_id":     "group-1",
			},
		}))
	}))
	defer authService.Close()

	router := gin.New()
	router.Use(AuthServiceMiddleware(AuthServiceOptions{
		AuthServiceURL:             authService.URL,
		SessionCookieMaxAgeSeconds: 3600,
		CookieDomain:               "localhost",
		IsProduction:               false,
	}))
	router.GET("/api/private", func(c *gin.Context) {
		assert.Equal(t, "user-1", c.GetString("user_id"))
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/private", nil)
	req.AddCookie(&http.Cookie{Name: "session_id", Value: sessionID})
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusNoContent, w.Code)

	cookie := findResponseCookie(w.Result().Cookies(), "session_id")
	require.NotNil(t, cookie)
	assert.Equal(t, sessionID, cookie.Value)
	assert.Equal(t, 3600, cookie.MaxAge)
	assert.Equal(t, "/", cookie.Path)
	assert.Empty(t, cookie.Domain)
	assert.False(t, cookie.Secure)
	assert.True(t, cookie.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
}

func TestAuthServiceMiddlewareClearsSessionCookieWhenValidationFails(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "invalid", http.StatusUnauthorized)
	}))
	defer authService.Close()

	router := gin.New()
	router.Use(AuthServiceMiddleware(AuthServiceOptions{
		AuthServiceURL:             authService.URL,
		SessionCookieMaxAgeSeconds: 3600,
	}))
	router.GET("/api/private", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/private", nil)
	req.AddCookie(&http.Cookie{Name: "session_id", Value: "session-123"})
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	cookie := findResponseCookie(w.Result().Cookies(), "session_id")
	require.NotNil(t, cookie)
	assert.Empty(t, cookie.Value)
	assert.Equal(t, -1, cookie.MaxAge)
	assert.Equal(t, "/", cookie.Path)
	assert.True(t, cookie.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
}

func findResponseCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}
