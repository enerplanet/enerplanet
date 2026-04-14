package middleware

import (
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"
)

// CallbackAuthMiddleware verifies the X-Callback-Secret header or secret query parameter.
// This is used for simulation engine callbacks that don't have a user session.
func CallbackAuthMiddleware() gin.HandlerFunc {
	callbackSecret := os.Getenv("CALLBACK_SECRET")
	appEnv := os.Getenv("APP_ENV")
	log := logger.ForComponent("middleware:callback_auth")

	isInsecure := callbackSecret == "" || callbackSecret == "changeme"
	isProduction := appEnv == "production"

	if isInsecure {
		if isProduction {
			log.Error("CRITICAL: CALLBACK_SECRET is not set or using default 'changeme' in PRODUCTION! All callbacks will be blocked.")
		} else {
			log.Warn("CALLBACK_SECRET is not set or using default 'changeme'. Callback endpoint is insecure!")
		}
	}

	return func(c *gin.Context) {
		// In production, we MUST have a secure secret
		if isProduction && isInsecure {
			httputil.InternalError(c, "Callback authentication is not properly configured")
			c.Abort()
			return
		}

		// Secret Verification
		secret := c.GetHeader("X-Callback-Secret")
		if secret == "" {
			secret = c.Query("secret")
		}

		// If no secret is configured (and not in production), we allow it but log a warning
		if callbackSecret == "" {
			c.Next()
			return
		}

		if subtle.ConstantTimeCompare([]byte(secret), []byte(callbackSecret)) != 1 {
			log.WithField("ip", c.ClientIP()).Warn("Unauthorized callback attempt: invalid secret")
			httputil.ErrorResponse(c, http.StatusUnauthorized, "Unauthorized")
			c.Abort()
			return
		}

		c.Next()
	}
}
