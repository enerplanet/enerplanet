package middleware

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"

	"github.com/gin-gonic/gin"
)

// Backend specific public paths
var backendPublicPaths = []string{
	"/api/health",
	"/api/webservices/health",
	"/assets/",
	"/images/",
}

// AuthServiceMiddleware validates sessions via auth-service
func AuthServiceMiddleware() gin.HandlerFunc {
	authServiceURL := os.Getenv("AUTH_SERVICE_URL")
	if authServiceURL == "" {
		authServiceURL = "http://localhost:8001"
	}

	return func(c *gin.Context) {
		if httputil.IsPublicPath(c.Request.URL.Path, backendPublicPaths) {
			c.Next()
			return
		}

		sessionID := httputil.GetSessionCookieOrEmpty(c)
		if sessionID == "" {
			httputil.Unauthorized(c, "Session not found")
			c.Abort()
			return
		}

		validateURL := fmt.Sprintf("%s/internal/validate-session", authServiceURL)
		req, _ := http.NewRequest("GET", validateURL, nil)
		req.AddCookie(&http.Cookie{Name: "session_id", Value: sessionID})

		client := &http.Client{Timeout: constants.HTTPTimeoutAuth}
		resp, err := client.Do(req)
		if err != nil {
			platformlogger.WithFields(map[string]interface{}{
				"component": "backend_auth_middleware",
				"error":     err,
			}).Error("Failed to validate session with auth-service")
			httputil.Unauthorized(c, "Session validation failed")
			c.Abort()
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			httputil.Unauthorized(c, "Invalid session")
			c.Abort()
			return
		}

		body, _ := io.ReadAll(resp.Body)
		var result struct {
			Success bool `json:"success"`
			User    struct {
				ID          string `json:"id"`
				Email       string `json:"email"`
				Name        string `json:"name"`
				AccessLevel string `json:"access_level"`
				GroupID     string `json:"group_id"`
			} `json:"user"`
		}

		if err := json.Unmarshal(body, &result); err != nil {
			platformlogger.WithFields(map[string]interface{}{
				"component": "backend_auth_middleware",
				"error":     err,
			}).Error("Failed to parse auth-service response")
			httputil.Unauthorized(c, "Invalid session response")
			c.Abort()
			return
		}

		sessionData := &platformsession.SessionData{
			UserID:      result.User.ID,
			AccessLevel: result.User.AccessLevel,
			GroupID:     result.User.GroupID,
			UserInfoData: &platformsession.UserInfoData{
				Email:    result.User.Email,
				FullName: result.User.Name,
			},
		}
		httputil.SetSessionContext(c, sessionData)

		c.Next()
	}
}
