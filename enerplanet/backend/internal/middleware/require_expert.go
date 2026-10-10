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
