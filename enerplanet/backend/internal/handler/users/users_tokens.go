package usershandler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	applogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"

	"spatialhub_backend/internal/apitoken"
	backendModels "spatialhub_backend/internal/models"
)

const (
	apiTokenDefaultExpiryDays = 90
	apiTokenMaxExpiryDays     = 365
)

type createTokenRequest struct {
	Name string `json:"name" binding:"required,max=255"`
	// ExpiresInDays: nil → default (90); 0 → never expires; capped at 365.
	ExpiresInDays *int   `json:"expires_in_days"`
	Scope         string `json:"scope"`
}

// validateTokenAccess: experts for any user, managers for their group.
func (h *Handler) validateTokenAccess(c *gin.Context) (string, *platformsession.SessionData, string, bool) {
	id, sessionData, authToken, ok := h.validateUserIDAndGetManagerSession(c)
	if !ok {
		return "", nil, "", false
	}
	if sessionData.AccessLevel == constants.AccessLevelManager &&
		!h.canManagerAccessUser(c.Request.Context(), sessionData.UserID, id) {
		httputil.ErrorResponse(c, http.StatusForbidden, "You can only manage tokens for users in your groups")
		return "", nil, "", false
	}
	return id, sessionData, authToken, true
}

// CreateUserToken issues a token (plaintext shown once).
func (h *Handler) CreateUserToken(c *gin.Context) {
	id, sessionData, authToken, ok := h.validateTokenAccess(c)
	if !ok {
		return
	}

	var req createTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid request: "+err.Error())
		return
	}

	scope := req.Scope
	switch scope {
	case "":
		scope = backendModels.APITokenScopeRead
	case backendModels.APITokenScopeRead, backendModels.APITokenScopeFull:
	default:
		httputil.BadRequest(c, "scope must be 'read' or 'full'")
		return
	}

	var expiresAt *time.Time
	days := apiTokenDefaultExpiryDays
	if req.ExpiresInDays != nil {
		days = *req.ExpiresInDays
	}
	if days < 0 || days > apiTokenMaxExpiryDays {
		httputil.BadRequest(c, "expires_in_days must be between 0 (never) and "+strconv.Itoa(apiTokenMaxExpiryDays))
		return
	}
	if days > 0 {
		t := time.Now().UTC().AddDate(0, 0, days)
		expiresAt = &t
	}

	// Identity from Keycloak, not request input.
	user, err := h.userStore.GetUser(authToken, id)
	if err != nil {
		applogger.ForComponent("api_token").Errorf("fetch user %s for token failed: %v", id, err)
		httputil.BadGateway(c, "fetch user failed")
		return
	}

	gen, err := apitoken.New()
	if err != nil {
		httputil.InternalError(c, "Failed to generate token")
		return
	}

	token := &backendModels.APIToken{
		UserID:      id,
		UserEmail:   user.Email,
		Name:        req.Name,
		TokenHash:   gen.Hash,
		TokenPrefix: gen.DisplayPrefix,
		Scope:       scope,
		AccessLevel: clampTokenAccessLevel(h.getUserAccessLevel(authToken, id, user.Attributes)),
		CreatedBy:   sessionData.UserID,
		ExpiresAt:   expiresAt,
	}
	if err := h.apiTokens.Create(token); err != nil {
		applogger.ForComponent("api_token").Errorf("create token for user %s failed: %v", id, err)
		httputil.InternalError(c, "Failed to create token")
		return
	}

	applogger.ForComponent("api_token").Infof("token created token_id=%d user_id=%s scope=%s by=%s", token.ID, id, scope, sessionData.UserID)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"token":      gen.Plaintext, // shown once, never retrievable again
			"id":         token.ID,
			"name":       token.Name,
			"prefix":     token.TokenPrefix,
			"scope":      token.Scope,
			"expires_at": token.ExpiresAt,
			"created_at": token.CreatedAt,
		},
	})
}

// ListUserTokens lists the target user's tokens.
func (h *Handler) ListUserTokens(c *gin.Context) {
	id, _, _, ok := h.validateTokenAccess(c)
	if !ok {
		return
	}
	tokens, err := h.apiTokens.ListByUser(id)
	if err != nil {
		httputil.InternalError(c, "Failed to list tokens")
		return
	}
	httputil.SuccessResponse(c, tokens)
}

// RevokeUserToken revokes one token of the target user.
func (h *Handler) RevokeUserToken(c *gin.Context) {
	id, sessionData, _, ok := h.validateTokenAccess(c)
	if !ok {
		return
	}
	tokenID, err := strconv.ParseUint(c.Param("tokenId"), 10, 64)
	if err != nil {
		httputil.BadRequest(c, "Invalid token id")
		return
	}
	revoked, err := h.apiTokens.Revoke(uint(tokenID), id)
	if err != nil {
		httputil.InternalError(c, "Failed to revoke token")
		return
	}
	if !revoked {
		httputil.NotFound(c, "Token not found or already revoked")
		return
	}
	applogger.ForComponent("api_token").Infof("token revoked token_id=%d user_id=%s by=%s", tokenID, id, sessionData.UserID)
	httputil.SuccessMessage(c, "Token revoked")
}

// clampTokenAccessLevel keeps tokens below expert/manager.
func clampTokenAccessLevel(level string) string {
	if level == constants.AccessLevelExpert || level == constants.AccessLevelManager {
		return constants.AccessLevelIntermediate
	}
	if level == "" {
		return constants.AccessLevelIntermediate
	}
	return level
}
