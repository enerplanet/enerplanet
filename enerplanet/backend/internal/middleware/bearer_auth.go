package middleware

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"platform.local/common/pkg/httputil"
	"spatialhub_backend/internal/bearerauth"
)

const ctxBearerIdentity = "bearer_identity"

type BearerVerifier interface {
	Verify(context.Context, string) (*bearerauth.Identity, error)
}

// Authenticate bearer tokens.
func BearerAuth(verifier BearerVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool(ctxAPITokenAuthenticated) {
			c.Next()
			return
		}
		headers := c.Request.Header.Values("Authorization")
		var fields []string
		for _, header := range headers {
			parts := strings.Fields(header)
			if len(parts) > 0 && strings.EqualFold(parts[0], "Bearer") {
				fields = parts
				break
			}
		}
		if len(fields) == 0 {
			c.Next()
			return
		}
		if len(fields) != 2 || len(headers) != 1 || verifier == nil {
			rejectBearer(c)
			return
		}
		identity, err := verifier.Verify(c.Request.Context(), fields[1])
		if err != nil || identity == nil {
			rejectBearer(c)
			return
		}
		if !slices.Contains(strings.Fields(identity.Scope), bearerauth.ReadScope) ||
			c.Request.Method != http.MethodGet || !toolboxReadRoute(c.FullPath()) {
			c.Header("WWW-Authenticate", `Bearer error="insufficient_scope", scope="enerplanet:read"`)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Token does not permit this operation"})
			return
		}
		c.Set("user_id", identity.Subject)
		c.Set("user_email", identity.Email)
		c.Set("user_name", identity.Name)
		c.Set("access_level", identity.AccessLevel)
		c.Set("group_id", "")
		c.Set(ctxBearerIdentity, identity)
		// Skip session validation.
		c.Set(ctxAPITokenAuthenticated, true)
		c.Next()
	}
}

func rejectBearer(c *gin.Context) {
	c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unrecognised bearer token"})
}

// Allowed toolbox routes.
func toolboxReadRoute(route string) bool {
	switch route {
	case "/api/auth/whoami", "/api/models", "/api/models/:id",
		"/api/models/:id/results", "/api/models/:id/results/structured",
		"/api/models/:id/results/carrier-timeseries", "/api/models/:id/results/system-timeseries",
		"/api/models/:id/results/location/:location", "/api/models/:id/results/pypsa",
		"/api/models/:id/download", "/api/results/:id", "/api/results/:id/layer":
		return true
	}
	return false
}

type WhoAmIResponse struct {
	Issuer               string `json:"issuer"`
	Subject              string `json:"subject"`
	Email                string `json:"email"`
	AccessLevel          string `json:"access_level"`
	AuthenticationMethod string `json:"authentication_method"`
}

// WhoAmI godoc
// @Summary Resolve the current API identity
// @Description SpatialHub subject and effective API permissions; never returns credentials.
// @Tags Authentication
// @Produce json
// @Success 200 {object} WhoAmIResponse
// @Failure 401 {object} map[string]string
// @Security SpatialHubBearer
// @Security APITokenAuth
// @Security SessionAuth
// @Router /auth/whoami [get]
func WhoAmI(issuer string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := httputil.GetUserContext(c)
		if !ok {
			return
		}
		method := "session"
		resolvedIssuer := issuer
		if value, ok := c.Get(ctxBearerIdentity); ok {
			method = "bearer"
			resolvedIssuer = value.(*bearerauth.Identity).Issuer
		} else if c.GetBool(ctxAPITokenAuthenticated) {
			method = "api_token"
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, WhoAmIResponse{Issuer: resolvedIssuer, Subject: user.UserID,
			Email: user.Email, AccessLevel: user.AccessLevel, AuthenticationMethod: method})
	}
}
