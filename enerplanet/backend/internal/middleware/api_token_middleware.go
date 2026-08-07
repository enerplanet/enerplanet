package middleware

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"

	"spatialhub_backend/internal/apitoken"
	backendModels "spatialhub_backend/internal/models"
)

// marks a request authenticated by an API token.
const ctxAPITokenAuthenticated = "api_token_authenticated"

// APITokenValidator checks a plaintext token (implemented by apitoken.Service).
type APITokenValidator interface {
	Validate(plaintext string) (*backendModels.APIToken, error)
}

// APITokenAuth authenticates Bearer token requests; others pass through.
func APITokenAuth(validator APITokenValidator) gin.HandlerFunc {
	return func(c *gin.Context) {
		candidate := apitoken.FromAuthorizationHeader(c.GetHeader("Authorization"))
		if candidate == "" {
			c.Next()
			return
		}

		log := platformlogger.ForComponent("api_token")
		token, err := validator.Validate(candidate)
		if err != nil {
			if !errors.Is(err, apitoken.ErrInvalid) {
				log.Errorf("token validation failed: %v", err)
			}
			httputil.Unauthorized(c, "Invalid API token")
			c.Abort()
			return
		}

		// Read-scoped tokens may only use safe methods.
		if token.Scope != backendModels.APITokenScopeFull &&
			c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.JSON(http.StatusForbidden, gin.H{"error": "This API token is read-only"})
			c.Abort()
			return
		}

		// Set the same context keys the session path sets.
		c.Set("user_id", token.UserID)
		c.Set("user_email", token.UserEmail)
		c.Set("user_name", token.UserEmail)
		c.Set("access_level", token.AccessLevel)
		c.Set("group_id", "")
		c.Set(ctxAPITokenAuthenticated, true)

		log.WithFields(map[string]any{
			"token_id": token.ID,
			"user_id":  token.UserID,
			"method":   c.Request.Method,
			"path":     c.FullPath(),
		}).Info("api token request")

		c.Next()
	}
}
