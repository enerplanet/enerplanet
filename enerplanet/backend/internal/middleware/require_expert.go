package middleware

import (
	"github.com/gin-gonic/gin"
	"platform.local/common/pkg/httputil"
)

// RequireExpert lets only users with the expert access level through; others
// get 403 and the handler does not run.
func RequireExpert() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !httputil.RequireExpertAccess(nil, c) {
			return
		}
		c.Next()
	}
}

// RequireManagerOrExpert lets only users with the manager or expert access
// level through; others get 403 and the handler does not run.
func RequireManagerOrExpert() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !httputil.RequireManagerOrExpertAccess(nil, c) {
			return
		}
		c.Next()
	}
}
