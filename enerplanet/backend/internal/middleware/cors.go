package middleware

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// split cors policies.
func CORS(app cors.Config, toolboxOrigins []string) gin.HandlerFunc {
	appCORS := cors.New(app)
	if len(toolboxOrigins) == 0 {
		return appCORS
	}
	toolbox := make(map[string]struct{}, len(toolboxOrigins))
	for _, o := range toolboxOrigins {
		toolbox[o] = struct{}{}
	}
	toolboxCORS := cors.New(cors.Config{
		AllowOrigins:     toolboxOrigins,
		AllowMethods:     []string{"GET", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type", "Retry-After"},
		AllowCredentials: false,
		MaxAge:           600,
	})
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := toolbox[origin]; ok && (app.AllowOriginFunc == nil || !app.AllowOriginFunc(origin)) {
			toolboxCORS(c)
			return
		}
		appCORS(c)
	}
}
