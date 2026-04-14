package middleware

import (
	"time"

	platformlogger "platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

// RequestMetrics logs request metrics only for server errors or very slow requests.
func RequestMetrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)
		status := c.Writer.Status()
		path := c.FullPath()

		// Skip logging for SSE endpoints (they are expected to be long-running)
		if path == "/api/notifications/stream" || c.Request.URL.Path == "/api/notifications/stream" {
			return
		}

		// Skip logging for auth-related 401 errors (normal behavior)
		if status == 401 {
			return
		}

		// Only log server errors (5xx) or very slow requests (>5s)
		if status >= 500 || latency > 5*time.Second {
			platformlogger.Logger.WithFields(map[string]interface{}{
				"path":     path,
				"method":   c.Request.Method,
				"status":   status,
				"latency":  latency.String(),
				"clientIP": c.ClientIP(),
			}).Info("request")
		}
	}
}
