package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"
	"spatialhub_backend/internal/bearerauth"
)

const ctxBearerIdentity = "bearer_identity"

type BearerVerifier interface {
	Verify(context.Context, string) (*bearerauth.Identity, error)
}

// PartnerAccountResolver finds the local account linked to a partner user id.
type PartnerAccountResolver interface {
	Resolve(partnerUserID string) (*bearerauth.Account, error)
}

// BearerAuth authenticates partner access tokens and acts as the linked local
// account on the read-only toolbox routes.
func BearerAuth(verifier BearerVerifier, accounts PartnerAccountResolver) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Public paths bypass.
		if httputil.IsPublicPath(c.Request.URL.Path, backendPublicPaths) {
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
		// One credential only.
		if len(headers) != 1 {
			rejectBearer(c, "multiple_credentials")
			return
		}
		if c.GetBool(ctxAPITokenAuthenticated) {
			c.Next()
			return
		}
		if len(fields) != 2 {
			rejectBearer(c, "malformed_header")
			return
		}
		if verifier == nil || accounts == nil {
			rejectBearer(c, bearerauth.ErrUnavailable.Error())
			return
		}
		identity, err := verifier.Verify(c.Request.Context(), fields[1])
		if err != nil || identity == nil {
			rejectVerification(c, err)
			return
		}
		if c.Request.Method != http.MethodGet || !toolboxReadRoute(c.FullPath()) {
			bearerLog(c).WithFields(map[string]any{"partner_user_id": identity.Subject, "token_id": identity.TokenID}).
				Warn("bearer request not permitted")
			c.Header("WWW-Authenticate", `Bearer error="insufficient_scope"`)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Token does not permit this operation"})
			return
		}
		if !setBearerAccount(c, accounts, identity) {
			return
		}
		c.Next()
	}
}

// setBearerAccount puts the account linked to identity into the request
// context, or aborts the request.
func setBearerAccount(c *gin.Context, accounts PartnerAccountResolver, identity *bearerauth.Identity) bool {
	log := bearerLog(c).WithFields(map[string]any{"partner_user_id": identity.Subject, "token_id": identity.TokenID})
	account, err := accounts.Resolve(identity.Subject)
	switch {
	case errors.Is(err, bearerauth.ErrNotLinked):
		log.Warn("bearer user has no linked account")
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "No EnerPlanET account is linked to this user; sign in to EnerPlanET once to create it"})
		return false
	case errors.Is(err, bearerauth.ErrDisabled):
		log.Warn("bearer user account is disabled")
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "The linked EnerPlanET account is disabled"})
		return false
	case err != nil:
		log.WithError(err).Error("bearer account lookup failed")
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Account lookup unavailable, retry later"})
		return false
	}
	c.Set("user_id", account.ID)
	c.Set("user_email", account.Email)
	c.Set("user_name", account.Name)
	c.Set("access_level", toolboxAccessLevel(account.AccessLevel))
	c.Set("group_id", "")
	c.Set(ctxBearerIdentity, identity)
	// Skip session validation.
	c.Set(ctxAPITokenAuthenticated, true)
	log.WithField("user_id", account.ID).Info("bearer token request")
	return true
}

// toolboxAccessLevel caps delegated privileges at intermediate.
func toolboxAccessLevel(level string) string {
	switch level {
	case constants.AccessLevelIntermediate, constants.AccessLevelManager, constants.AccessLevelExpert:
		return constants.AccessLevelIntermediate
	}
	return constants.AccessLevelVeryLow
}

// Fixed log reasons.
func rejectReason(err error) string {
	for _, known := range []error{bearerauth.ErrUnavailable, bearerauth.ErrExpired, bearerauth.ErrInvalidToken,
		bearerauth.ErrClaims, bearerauth.ErrLifetime} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	return bearerauth.ErrInvalidToken.Error()
}

func bearerLog(c *gin.Context) *logrus.Entry {
	return platformlogger.ForComponent("bearer_auth").WithFields(map[string]any{
		"method": c.Request.Method,
		"path":   c.FullPath(),
	})
}

// rejectVerification logs the claims of a signed token that failed a claim
// check, never the token itself, then rejects the request.
func rejectVerification(c *gin.Context, err error) {
	var claims *bearerauth.RejectedClaims
	if errors.As(err, &claims) {
		bearerLog(c).WithFields(map[string]any{"azp": claims.ClientID, "aud": claims.Audience,
			"lifetime_seconds": int(claims.Lifetime.Seconds())}).Warn("signed bearer token failed claim checks")
	}
	rejectBearer(c, rejectReason(err))
}

func rejectBearer(c *gin.Context, reason string) {
	bearerLog(c).WithField("reason", reason).Warn("bearer token rejected")
	c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unrecognised bearer token"})
}

// toolboxReadRoute lists the routes toolbox tokens may call; it must match the
// RENvolveIT API documentation (enerplanet/openapi.yaml).
func toolboxReadRoute(route string) bool {
	switch route {
	case "/api/auth/whoami", "/api/models", "/api/models/:id":
		return true
	}
	return false
}

type WhoAmIResponse struct {
	Issuer               string `json:"issuer,omitempty"` // partner tokens only
	Subject              string `json:"subject"`
	Email                string `json:"email"`
	AccessLevel          string `json:"access_level"`
	AuthenticationMethod string `json:"authentication_method"`
}

// WhoAmI godoc
// @Summary Resolve the current API identity
// @Description EnerPlanET user id and effective API permissions; never returns credentials.
// @Tags Authentication
// @Produce json
// @Success 200 {object} WhoAmIResponse
// @Failure 401 {object} map[string]string
// @Security SpatialHubBearer
// @Security APITokenAuth
// @Security SessionAuth
// @Router /auth/whoami [get]
func WhoAmI() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := httputil.GetUserContext(c)
		if !ok {
			return
		}
		method := "session"
		resolvedIssuer := ""
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
