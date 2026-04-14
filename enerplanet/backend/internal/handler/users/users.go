package usershandler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"platform.local/common/pkg/authclient"
	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	authplatform "platform.local/platform/auth"
	platformkeycloak "platform.local/platform/keycloak"
	applogger "platform.local/platform/logger"
	platformsession "platform.local/platform/session"
	"spatialhub_backend/internal/config"
	usersstore "spatialhub_backend/internal/store/users"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	errKeycloakRequestFailed = "keycloak request failed"
	errIDRequired            = "id required"
	sqlUserIDOrEmail         = "user_id = ? OR LOWER(email) = LOWER(?)"
)

type Handler struct {
	cfg                *config.Config
	db                 *gorm.DB
	userStore          *usersstore.Store
	adminTokenProvider *authplatform.AdminTokenProvider
	authClient         *authclient.Client
	kc                 *platformkeycloak.Client
	sessionStore       platformsession.SessionStore
}

func New(cfg *config.Config, db *gorm.DB, sessionStore platformsession.SessionStore, adminTokenProvider *authplatform.AdminTokenProvider) *Handler {
	return &Handler{
		cfg:                cfg,
		db:                 db,
		userStore:          usersstore.New(cfg),
		adminTokenProvider: adminTokenProvider,
		authClient:         authclient.NewClient(),
		kc:                 platformkeycloak.NewClient(cfg.Auth.BaseURL, cfg.Auth.Realm, adminTokenProvider),
		sessionStore:       sessionStore,
	}
}

// deleteUserSessions calls auth-service to delete all sessions for a user
func (h *Handler) deleteUserSessions(ctx context.Context, userID string) error {
	return h.authClient.DeleteUserSessions(ctx, userID)
}

func (h *Handler) validateManagerUserAccess(c *gin.Context, userID string, actionDescription string) (string, bool) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return "", false
	}

	if !httputil.RequireManagerOrExpertAccess(sessionData, c) {
		return "", false
	}

	authToken := h.getAuthToken(sessionData)

	if sessionData.AccessLevel == constants.AccessLevelManager {
		if !h.canManagerAccessUser(c.Request.Context(), sessionData.UserID, userID) {
			httputil.ErrorResponse(c, http.StatusForbidden, fmt.Sprintf("You can only %s users in your groups", actionDescription))
			return "", false
		}
	}

	return authToken, true
}

func (h *Handler) deriveAccessLevel(accessAttr string, roles []string) string {
	if accessAttr != "" {
		return strings.ToLower(accessAttr)
	}
	for _, r := range roles {
		lr := strings.ToLower(r)
		switch lr {
		case "realm-admin", "admin", "expert", constants.AccessLevelManager:
			return "expert"
		}
	}
	return "very_low"
}

func (h *Handler) fetchUserRoles(token, userID string) []string {
	roles, err := h.userStore.FetchUserRoles(token, userID)
	if err != nil {
		applogger.ForComponent("users").Warnf("Failed to fetch user roles for %s: %v", userID, err)
		return nil
	}
	return roles
}

func (h *Handler) adminAccessToken() (string, error) {
	if h.adminTokenProvider == nil {
		return "", fmt.Errorf("admin token provider not initialized")
	}
	return h.adminTokenProvider.GetToken()
}

func (h *Handler) getAuthToken(sessionData *platformsession.SessionData) string {
	adminTok, errTok := h.adminAccessToken()
	if errTok == nil && adminTok != "" {
		return adminTok
	}
	return sessionData.AccessToken
}

// getAuthTokenWithRetry returns an admin token, invalidating and retrying once on failure.
func (h *Handler) getAuthTokenWithRetry(sessionData *platformsession.SessionData) string {
	adminTok, errTok := h.adminAccessToken()
	if errTok == nil && adminTok != "" {
		return adminTok
	}
	// Invalidate cached token and retry once
	if h.adminTokenProvider != nil {
		h.adminTokenProvider.Invalidate()
		adminTok, errTok = h.adminAccessToken()
		if errTok == nil && adminTok != "" {
			return adminTok
		}
	}
	return sessionData.AccessToken
}

func getAttributeValue(attributes map[string][]string, key string) string {
	if vals, ok := attributes[key]; ok && len(vals) > 0 {
		return vals[0]
	}
	return ""
}

func deriveUserName(attributes map[string][]string, username, email string) string {
	name := getAttributeValue(attributes, "fullName")
	if name == "" {
		name = username
	}
	if name == "" {
		name = email
	}
	return name
}

func (h *Handler) getUserAccessLevel(authToken string, userID string, attributes map[string][]string) string {
	accessAttr := strings.ToLower(getAttributeValue(attributes, "access_level"))
	if accessAttr != "" {
		applogger.ForComponent("users").Debugf("User %s access level from attribute: %s", userID, accessAttr)
		return accessAttr
	}
	applogger.ForComponent("users").Warnf("User %s has no access_level attribute, deriving from roles", userID)
	roles := h.fetchUserRoles(authToken, userID)
	derivedLevel := h.deriveAccessLevel(accessAttr, roles)
	applogger.ForComponent("users").Debugf("User %s derived access level: %s (roles: %v)", userID, derivedLevel, roles)
	return derivedLevel
}

func (h *Handler) getUserFirstGroup(ctx context.Context, userID string) string {
	gid, _ := h.kc.GetUserPrimaryGroup(ctx, userID)
	return gid
}

func (h *Handler) canManagerAccessUser(ctx context.Context, managerUserID, targetUserID string) bool {
	mgrSet, err := h.kc.GetManagerGroupSet(ctx, managerUserID)
	if err != nil {
		return false
	}

	sharedDefaultID := ""
	if gid, derr := h.kc.EnsureGroupByName(ctx, "Default"); derr == nil {
		sharedDefaultID = gid
	}

	targetGroups, err := h.kc.GetUserGroups(ctx, targetUserID)
	if err != nil {
		return false
	}

	for _, tg := range targetGroups {
		if mgrSet[tg.ID] {
			if sharedDefaultID != "" && tg.ID == sharedDefaultID {
				return targetUserID == managerUserID
			}
			return true
		}
	}

	return false
}

type UserDTO struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Enabled       bool   `json:"enabled"`
	Organization  string `json:"organization,omitempty"`
	Position      string `json:"position,omitempty"`
	Phone         string `json:"phone,omitempty"`
	AccessLevel   string `json:"access_level"`
	GroupID       string `json:"group_id,omitempty"`
	ModelLimit    *int   `json:"model_limit,omitempty"`
	CreatedAt     *int64 `json:"created_at,omitempty"`
}

// fetchUsersFromKeycloak retrieves users based on access level
func (h *Handler) fetchUsersFromKeycloak(authToken string, sessionData *platformsession.SessionData, first, perPage int, search string) ([]usersstore.User, error) {
	if sessionData.AccessLevel == constants.AccessLevelManager {
		return h.userStore.ListUsers(authToken, usersstore.ListUsersParams{
			First:  0,
			Max:    10000,
			Search: search,
		})
	}
	return h.userStore.ListUsers(authToken, usersstore.ListUsersParams{
		First:  first,
		Max:    perPage,
		Search: search,
	})
}

// convertToUserDTOs converts keycloak users to DTOs
func (h *Handler) convertToUserDTOs(ctx context.Context, authToken string, kcUsers []usersstore.User) []UserDTO {
	users := make([]UserDTO, 0, len(kcUsers))
	for _, u := range kcUsers {
		name := deriveUserName(u.Attributes, u.Username, u.Email)
		accessLevel := h.getUserAccessLevel(authToken, u.ID, u.Attributes)
		groupID := h.getUserFirstGroup(ctx, u.ID)

		dto := UserDTO{
			ID:            u.ID,
			Name:          name,
			Email:         u.Email,
			EmailVerified: u.EmailVerified,
			Enabled:       u.Enabled,
			Organization:  getAttributeValue(u.Attributes, "organization"),
			Position:      getAttributeValue(u.Attributes, "position"),
			Phone:         getAttributeValue(u.Attributes, "phone"),
			AccessLevel:   accessLevel,
			GroupID:       groupID,
			CreatedAt:     u.CreatedTimestamp,
		}

		// Parse model_limit if present
		if modelLimitStr := getAttributeValue(u.Attributes, "model_limit"); modelLimitStr != "" {
			if modelLimit, err := strconv.Atoi(modelLimitStr); err == nil {
				dto.ModelLimit = &modelLimit
			}
		}

		users = append(users, dto)
	}
	return users
}

// buildManagerGroupMap creates a map of group IDs excluding the shared default
func (h *Handler) buildManagerGroupMap(ctx context.Context, userID string) (map[string]bool, error) {
	mgrSet, err := h.kc.GetManagerGroupSet(ctx, userID)
	if err != nil {
		return nil, err
	}

	sharedDefaultID, _ := h.kc.EnsureGroupByName(ctx, "Default")

	managerGroupMap := make(map[string]bool)
	for gid := range mgrSet {
		if gid != sharedDefaultID {
			managerGroupMap[gid] = true
		}
	}
	return managerGroupMap, nil
}

// filterUsersByManagerGroups filters users based on manager's group access
func filterUsersByManagerGroups(users []UserDTO, groupMap map[string]bool) []UserDTO {
	filtered := make([]UserDTO, 0)
	for _, u := range users {
		if u.GroupID != "" && groupMap[u.GroupID] {
			filtered = append(filtered, u)
		}
	}
	return filtered
}

// paginateUsers applies pagination to the user list
func paginateUsers(users []UserDTO, first, perPage int) []UserDTO {
	startIdx := first
	endIdx := first + perPage

	if startIdx > len(users) {
		startIdx = len(users)
	}
	if endIdx > len(users) {
		endIdx = len(users)
	}

	return users[startIdx:endIdx]
}

// getTotalCount retrieves or calculates the total user count
func (h *Handler) getTotalCount(authToken string, rawSearch string, users []UserDTO, isManager bool) int {
	if isManager {
		return len(users)
	}

	total, err := h.userStore.CountUsers(authToken, rawSearch)
	if err != nil {
		if rawSearch != "" {
			return len(users)
		}
		return -1
	}
	return total
}

func (h *Handler) ListUsers(c *gin.Context) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return
	}
	if !httputil.RequireManagerOrExpertAccess(sessionData, c) {
		return
	}

	pagination := httputil.ParsePagination(c, &httputil.PaginationOptions{
		DefaultPage:    1,
		DefaultPerPage: 10,
		MaxPerPage:     50,
	})
	first := (pagination.Page - 1) * pagination.PerPage
	rawSearch := strings.TrimSpace(c.Query("search"))
	authToken := h.getAuthTokenWithRetry(sessionData)

	kcUsers, err := h.fetchUsersFromKeycloak(authToken, sessionData, first, pagination.PerPage, rawSearch)
	if err != nil {
		// Retry once with a fresh token on auth failure
		if strings.Contains(err.Error(), "401") && h.adminTokenProvider != nil {
			h.adminTokenProvider.Invalidate()
			authToken = h.getAuthTokenWithRetry(sessionData)
			kcUsers, err = h.fetchUsersFromKeycloak(authToken, sessionData, first, pagination.PerPage, rawSearch)
		}
		if err != nil {
			applogger.ForComponent("users").Errorf("Failed to list users: %v", err)
			httputil.BadGateway(c, errKeycloakRequestFailed)
			return
		}
	}

	users := h.convertToUserDTOs(c.Request.Context(), authToken, kcUsers)

	isManager := sessionData.AccessLevel == constants.AccessLevelManager
	if isManager {
		groupMap, err := h.buildManagerGroupMap(c.Request.Context(), sessionData.UserID)
		if err == nil {
			users = filterUsersByManagerGroups(users, groupMap)
		}
	}

	totalBeforePagination := users
	if isManager {
		users = paginateUsers(users, first, pagination.PerPage)
	}

	total := h.getTotalCount(authToken, rawSearch, totalBeforePagination, isManager)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"data":     users,
			"page":     pagination.Page,
			"per_page": pagination.PerPage,
			"total":    total,
		},
	})
}

type createUserRequest struct {
	Email        string `json:"email" binding:"required,email"`
	Name         string `json:"name" binding:"required"`
	Password     string `json:"password"`
	AccessLevel  string `json:"access_level"`
	Organization string `json:"organization"`
	Position     string `json:"position"`
	Phone        string `json:"phone"`
	GroupID      string `json:"group_id"`
}

// getManagerInfo extracts manager info from session data
func getManagerInfo(sessionData *platformsession.SessionData) (email, name string) {
	if sessionData.UserInfoData == nil {
		return "", ""
	}

	email = sessionData.UserInfoData.Email
	name = sessionData.UserInfoData.FullName
	if name == "" {
		name = email
	}
	return email, name
}

// getDefaultGroupIDForCreation determines the appropriate default group for a new user
func (h *Handler) getDefaultGroupIDForCreation(ctx context.Context, sessionData *platformsession.SessionData) (string, error) {
	if sessionData.AccessLevel == constants.AccessLevelManager && sessionData.UserID != "" {
		email, name := getManagerInfo(sessionData)
		return h.kc.EnsureManagerDefaultGroup(ctx, sessionData.UserID, email, name)
	}

	return h.kc.EnsureGroupByName(ctx, "Default")
}

// assignUserToGroup adds user to specified group or default group
func (h *Handler) assignUserToGroup(ctx context.Context, userID, groupID string, sessionData *platformsession.SessionData) {
	log := applogger.ForComponent("users")

	if groupID != "" {
		if err := h.kc.AddUserToGroup(ctx, userID, groupID); err != nil {
			log.Warnf("Failed to add user to group: userID=%s groupID=%s err=%v", userID, groupID, err)
		}
		return
	}

	defID, defErr := h.getDefaultGroupIDForCreation(ctx, sessionData)
	if defErr != nil {
		log.Warnf("Failed to ensure default group: %v", defErr)
		return
	}

	if defID == "" {
		return
	}

	if err := h.kc.AddUserToGroup(ctx, userID, defID); err != nil {
		log.Warnf("Failed to add user to default group: userID=%s groupID=%s err=%v", userID, defID, err)
	}
}

// setUserPasswordIfProvided sets the user password if included in request
func (h *Handler) setUserPasswordIfProvided(authToken, userID, email, password string) {
	if password == "" {
		return
	}

	if err := h.userStore.SetUserPassword(authToken, userID, password, false); err != nil {
		applogger.ForComponent("users").Warnf("password set failed email=%s userID=%s err=%v", email, userID, err)
	}
}

func (h *Handler) CreateUser(c *gin.Context) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return
	}
	if !httputil.RequireManagerOrExpertAccess(sessionData, c) {
		return
	}

	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "invalid body", err.Error())
		return
	}
	if req.AccessLevel == "" {
		req.AccessLevel = "very_low"
	}

	authToken := h.getAuthToken(sessionData)

	existing, err := h.userStore.FindUserByEmail(authToken, req.Email)
	if err == nil && len(existing) > 0 {
		httputil.ErrorResponse(c, http.StatusConflict, "email already exists")
		return
	}

	createReq := usersstore.CreateUserRequest{
		Email:        req.Email,
		Name:         req.Name,
		Password:     req.Password,
		AccessLevel:  req.AccessLevel,
		Organization: req.Organization,
		Position:     req.Position,
		Phone:        req.Phone,
	}

	userID, err := h.userStore.CreateUser(authToken, createReq)
	if err != nil {
		applogger.ForComponent("users").Errorf("create user failed email=%s err=%v", req.Email, err)
		httputil.BadGateway(c, "failed to create user")
		return
	}

	h.setUserPasswordIfProvided(authToken, userID, req.Email, req.Password)
	h.assignUserToGroup(c.Request.Context(), userID, req.GroupID, sessionData)

	httputil.Created(c, gin.H{"message": "user created"})
}

type updateUserRequest struct {
	Email         *string `json:"email"`
	Name          *string `json:"name"`
	AccessLevel   *string `json:"access_level"`
	Organization  *string `json:"organization"`
	Position      *string `json:"position"`
	Phone         *string `json:"phone"`
	EmailVerified *bool   `json:"email_verified"`
	Password      *string `json:"password"`
	ModelLimit    *int    `json:"model_limit"`
}

// isEmailDuplicate checks if email is already in use by another user
func (h *Handler) isEmailDuplicate(authToken, currentUserID, email string) bool {
	if email == "" {
		return false
	}

	found, err := h.userStore.FindUserByEmail(authToken, email)
	if err != nil || len(found) == 0 {
		return false
	}

	for _, f := range found {
		if f.ID != currentUserID {
			return true
		}
	}
	return false
}

// handleUpdateUserError processes update errors and sends appropriate response
func handleUpdateUserError(c *gin.Context, id string, err error) {
	applogger.ForComponent("users").Errorf("update user id=%s err=%v", id, err)

	if strings.Contains(err.Error(), "conflict") || strings.Contains(err.Error(), "409") {
		httputil.ErrorResponse(c, http.StatusConflict, "conflict updating user")
	} else {
		httputil.BadGateway(c, "update failed")
	}
}

// updatePasswordIfProvided updates user password if included in request
func (h *Handler) updatePasswordIfProvided(authToken, id string, password *string) {
	if password == nil || *password == "" {
		return
	}

	if err := h.userStore.SetUserPassword(authToken, id, *password, false); err != nil {
		applogger.ForComponent("users").Warnf("password reset failed id=%s err=%v", id, err)
	}
}

func (h *Handler) syncUserGroupsForAccessLevel(ctx context.Context, authToken, userID, level string) {
	switch level {
	case constants.AccessLevelExpert:
		h.assignExpertGroups(ctx, userID)
	case constants.AccessLevelManager:
		h.assignManagerGroups(ctx, authToken, userID)
	default:
		h.assignStandardGroups(ctx, userID)
	}
}

func (h *Handler) assignExpertGroups(ctx context.Context, userID string) {
	log := applogger.ForComponent("users")
	defID, _ := h.kc.EnsureGroupByName(ctx, "Default")
	if defID == "" {
		return
	}

	if groups, err := h.kc.GetUserGroups(ctx, userID); err == nil {
		for _, g := range groups {
			if strings.HasPrefix(g.Name, "Default_") {
				if err := h.kc.RemoveUserFromGroup(ctx, userID, g.ID); err != nil {
					log.Warnf("Failed to remove user from manager group userID=%s groupID=%s err=%v", userID, g.ID, err)
				}
			}
		}
	} else {
		log.Warnf("Failed to fetch user groups for expert sync userID=%s err=%v", userID, err)
	}

	if err := h.kc.AddUserToGroup(ctx, userID, defID); err != nil {
		log.Warnf("Failed to add user to default group userID=%s groupID=%s err=%v", userID, defID, err)
	}
}

func (h *Handler) assignManagerGroups(ctx context.Context, authToken, userID string) {
	log := applogger.ForComponent("users")
	kcUser, err := h.userStore.GetUser(authToken, userID)
	if err != nil {
		log.Warnf("Failed to fetch user for manager sync userID=%s err=%v", userID, err)
	}

	email := kcUser.Email
	if email == "" {
		email = kcUser.Username
	}
	name := deriveUserName(kcUser.Attributes, kcUser.Username, kcUser.Email)
	if name == "" {
		name = email
	}

	if _, err := h.kc.EnsureManagerDefaultGroup(ctx, userID, email, name); err != nil {
		log.Warnf("Failed to ensure manager default group userID=%s err=%v", userID, err)
	}

	if defID, _ := h.kc.EnsureGroupByName(ctx, "Default"); defID != "" {
		if err := h.kc.RemoveUserFromGroup(ctx, userID, defID); err != nil {
			log.Warnf("Failed to remove user from shared default group userID=%s err=%v", userID, err)
		}
	}
}

func (h *Handler) assignStandardGroups(ctx context.Context, userID string) {
	log := applogger.ForComponent("users")
	defID, _ := h.kc.EnsureGroupByName(ctx, "Default")
	if defID == "" {
		return
	}

	if groups, err := h.kc.GetUserGroups(ctx, userID); err == nil {
		for _, g := range groups {
			if strings.HasPrefix(g.Name, "Default_") || (!strings.EqualFold(g.Name, "Default") && g.ID != defID) {
				if err := h.kc.RemoveUserFromGroup(ctx, userID, g.ID); err != nil {
					log.Warnf("Failed to remove user from group userID=%s groupID=%s err=%v", userID, g.ID, err)
				}
			}
		}
	} else {
		log.Warnf("Failed to fetch user groups before reset userID=%s err=%v", userID, err)
	}

	if err := h.kc.AddUserToGroup(ctx, userID, defID); err != nil {
		log.Warnf("Failed to add user to shared default group userID=%s groupID=%s err=%v", userID, defID, err)
	}
}

func (h *Handler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		httputil.BadRequest(c, errIDRequired)
		return
	}

	authToken, ok := h.validateManagerUserAccess(c, id, "update")
	if !ok {
		return
	}

	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body", "details": err.Error()})
		return
	}

	if req.Email != nil && h.isEmailDuplicate(authToken, id, *req.Email) {
		httputil.ErrorResponse(c, http.StatusConflict, "email already exists")
		return
	}

	updateReq := usersstore.UpdateUserRequest{
		Email:         req.Email,
		Name:          req.Name,
		AccessLevel:   req.AccessLevel,
		Organization:  req.Organization,
		Position:      req.Position,
		Phone:         req.Phone,
		EmailVerified: req.EmailVerified,
		ModelLimit:    req.ModelLimit,
	}

	if err := h.userStore.UpdateUser(authToken, id, updateReq); err != nil {
		handleUpdateUserError(c, id, err)
		return
	}

	// Sync group membership when access level changes
	if req.AccessLevel != nil {
		level := strings.ToLower(*req.AccessLevel)
		h.syncUserGroupsForAccessLevel(c.Request.Context(), authToken, id, level)
	}

	h.updatePasswordIfProvided(authToken, id, req.Password)

	httputil.SuccessMessage(c, "user updated")
}

func (h *Handler) validateUserWithAccess(
	c *gin.Context,
	require func(interface{}, *gin.Context) bool,
) (string, *platformsession.SessionData, string, bool) {
	id := c.Param("id")
	if id == "" {
		httputil.BadRequest(c, errIDRequired)
		return "", nil, "", false
	}

	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return "", nil, "", false
	}

	if require != nil && !require(sessionData, c) {
		return "", nil, "", false
	}

	authToken := h.getAuthToken(sessionData)
	return id, sessionData, authToken, true
}

func (h *Handler) validateUserIDAndGetExpertSession(c *gin.Context) (string, *platformsession.SessionData, string, bool) {
	return h.validateUserWithAccess(c, httputil.RequireExpertAccess)
}

func (h *Handler) validateUserIDAndGetManagerSession(c *gin.Context) (string, *platformsession.SessionData, string, bool) {
	return h.validateUserWithAccess(c, httputil.RequireManagerOrExpertAccess)
}

func (h *Handler) VerifyEmail(c *gin.Context) {
	id, _, authToken, ok := h.validateUserIDAndGetExpertSession(c)
	if !ok {
		return
	}
	verified := true
	updateReq := usersstore.UpdateUserRequest{EmailVerified: &verified}
	if err := h.userStore.UpdateUser(authToken, id, updateReq); err != nil {
		applogger.ForComponent("users").Errorf("verify email id=%s err=%v", id, err)
		httputil.BadGateway(c, "verify email failed")
		return
	}
	httputil.SuccessMessage(c, "email verified")
}

// cleanupManagerGroup deletes a manager-specific default group and associated workspace groups
func (h *Handler) cleanupManagerGroup(ctx context.Context, groupID, groupName, userID string) {
	log := applogger.ForComponent("users")

	if err := h.db.Where("group_id = ?", groupID).Delete(&models.WorkspaceGroup{}).Error; err != nil {
		log.Warnf("failed to cleanup workspace groups for group_id=%s err=%v", groupID, err)
	}

	if err := h.kc.DeleteGroup(ctx, groupID); err != nil {
		log.Warnf("failed to delete manager group group_id=%s user_id=%s err=%v", groupID, userID, err)
	} else {
		log.Infof("successfully deleted manager group group_id=%s group_name=%s for user_id=%s", groupID, groupName, userID)
	}
}

// processUserGroupForDeletion checks and deletes manager-specific default groups
func (h *Handler) processUserGroupForDeletion(ctx context.Context, userID, groupID string) {
	log := applogger.ForComponent("users")

	groupDetail, err := h.kc.GetGroup(ctx, groupID)
	if err != nil {
		log.Warnf("failed to fetch group details group_id=%s err=%v", groupID, err)
		return
	}

	expectedGroupName := fmt.Sprintf("Default_%s", userID)
	if groupDetail.Name == expectedGroupName {
		h.cleanupManagerGroup(ctx, groupDetail.ID, groupDetail.Name, userID)
	}
}

// cleanupUserGroups removes manager-specific groups associated with the user
func (h *Handler) cleanupUserGroups(ctx context.Context, userID string) {
	log := applogger.ForComponent("users")

	userGroups, err := h.kc.GetUserGroups(ctx, userID)
	if err != nil {
		log.Warnf("failed to fetch user groups before delete id=%s err=%v", userID, err)
		return
	}

	for _, group := range userGroups {
		h.processUserGroupForDeletion(ctx, userID, group.ID)
	}
}

// cleanupUserDatabaseRecords removes workspace members and model shares for the user
func (h *Handler) cleanupUserDatabaseRecords(userID, userEmail string) {
	log := applogger.ForComponent("users")

	if err := h.db.Where(sqlUserIDOrEmail, userID, userEmail).
		Delete(&models.WorkspaceMember{}).Error; err != nil {
		log.Warnf("failed to cleanup workspace members for user id=%s err=%v", userID, err)
	}

	if err := h.db.Where(sqlUserIDOrEmail, userID, userEmail).
		Delete(&models.ModelShare{}).Error; err != nil {
		log.Warnf("failed to cleanup model shares for user id=%s err=%v", userID, err)
	}
}

func (h *Handler) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		httputil.BadRequest(c, errIDRequired)
		return
	}

	authToken, ok := h.validateManagerUserAccess(c, id, "delete")
	if !ok {
		return
	}

	log := applogger.ForComponent("users")

	user, err := h.userStore.GetUser(authToken, id)
	if err != nil {
		log.Errorf("failed to fetch user before delete id=%s err=%v", id, err)
		httputil.BadGateway(c, "failed to fetch user")
		return
	}

	h.cleanupUserGroups(c.Request.Context(), id)
	h.cleanupUserDatabaseRecords(id, user.Email)

	if err := h.userStore.DeleteUser(authToken, id); err != nil {
		log.Errorf("delete user failed id=%s err=%v", id, err)
		httputil.BadGateway(c, "delete failed")
		return
	}

	if err := h.deleteUserSessions(c.Request.Context(), id); err != nil {
		log.Warnf("failed to delete sessions for user id=%s err=%v", id, err)
	}

	httputil.SuccessMessage(c, "user deleted")
}

func (h *Handler) setUserEnabledStatus(c *gin.Context, enabled bool) {
	action := "enable"
	if !enabled {
		action = "disable"
	}

	id := c.Param("id")
	if id == "" {
		httputil.BadRequest(c, errIDRequired)
		return
	}

	authToken, ok := h.validateManagerUserAccess(c, id, action)
	if !ok {
		return
	}

	if err := h.userStore.SetUserEnabled(authToken, id, enabled); err != nil {
		applogger.ForComponent("users").Errorf("%s user failed id=%s err=%v", action, id, err)
		httputil.BadGateway(c, fmt.Sprintf("%s failed", action))
		return
	}
	// If user was disabled, force immediate logout across all devices
	if !enabled {
		ctx := c.Request.Context()
		if err := h.kc.LogoutUser(ctx, id); err != nil {
			applogger.ForComponent("users").Warnf("Failed to logout user in Keycloak id=%s err=%v", id, err)
		}
		if err := h.deleteUserSessions(ctx, id); err != nil {
			applogger.ForComponent("users").Warnf("Failed to delete backend sessions id=%s err=%v", id, err)
		}
	}

	httputil.SuccessMessage(c, fmt.Sprintf("user %sd", action))
}

func (h *Handler) DisableUser(c *gin.Context) {
	h.setUserEnabledStatus(c, false)
}

func (h *Handler) EnableUser(c *gin.Context) {
	h.setUserEnabledStatus(c, true)
}

func (h *Handler) GetUser(c *gin.Context) {
	id, sessionData, authToken, ok := h.validateUserIDAndGetManagerSession(c)
	if !ok {
		return
	}

	if sessionData.AccessLevel == constants.AccessLevelManager {
		if !h.canManagerAccessUser(c.Request.Context(), sessionData.UserID, id) {
			httputil.ErrorResponse(c, http.StatusForbidden, "You can only view users in your groups")
			return
		}
	}

	user, err := h.userStore.GetUser(authToken, id)
	if err != nil {
		applogger.ForComponent("users").Errorf("Failed to get user %s: %v", id, err)
		httputil.BadGateway(c, "fetch user failed")
		return
	}

	name := deriveUserName(user.Attributes, user.Username, user.Email)
	accessLevel := h.getUserAccessLevel(authToken, id, user.Attributes)

	response := gin.H{
		"id":             user.ID,
		"name":           name,
		"email":          user.Email,
		"email_verified": user.EmailVerified,
		"enabled":        user.Enabled,
		"organization":   getAttributeValue(user.Attributes, "organization"),
		"position":       getAttributeValue(user.Attributes, "position"),
		"phone":          getAttributeValue(user.Attributes, "phone"),
		"access_level":   accessLevel,
	}

	// Include model_limit if set
	if modelLimitStr := getAttributeValue(user.Attributes, "model_limit"); modelLimitStr != "" {
		if modelLimit, err := strconv.Atoi(modelLimitStr); err == nil {
			response["model_limit"] = modelLimit
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

func (h *Handler) GetProfile(c *gin.Context) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return
	}
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	authToken := h.getAuthToken(sessionData)

	kcUser, err := h.userStore.GetUser(authToken, userID)
	if err != nil {
		applogger.ForComponent("users").Errorf("Failed to get current user %s: %v", userID, err)
		httputil.BadGateway(c, "fetch user failed")
		return
	}

	name := deriveUserName(kcUser.Attributes, kcUser.Username, kcUser.Email)
	accessLevel := h.getUserAccessLevel(authToken, userID, kcUser.Attributes)

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"id":           kcUser.ID,
		"name":         name,
		"email":        kcUser.Email,
		"organization": getAttributeValue(kcUser.Attributes, "organization"),
		"position":     getAttributeValue(kcUser.Attributes, "position"),
		"phone":        getAttributeValue(kcUser.Attributes, "phone"),
		"access_level": accessLevel,
	}})
}

// shouldCountUserForManager determines if a user should be counted for a manager
func shouldCountUserForManager(userID, managerID, groupID, defaultGroupID string, mgrSet map[string]bool) bool {
	if groupID == "" || !mgrSet[groupID] {
		return false
	}

	// For shared default group, only count the manager themselves
	if defaultGroupID != "" && groupID == defaultGroupID {
		return userID == managerID
	}

	return true
}

// countManagerUsers counts users accessible to a manager
func (h *Handler) countManagerUsers(ctx context.Context, authToken, managerID string) (int, error) {
	mgrSet, err := h.kc.GetManagerGroupSet(ctx, managerID)
	if err != nil {
		return 0, err
	}

	defaultID, _ := h.kc.EnsureGroupByName(ctx, "Default")

	kcUsers, err := h.userStore.ListUsers(authToken, usersstore.ListUsersParams{First: 0, Max: 10000})
	if err != nil {
		return 0, err
	}

	count := 0
	for _, u := range kcUsers {
		gid := h.getUserFirstGroup(ctx, u.ID)
		if shouldCountUserForManager(u.ID, managerID, gid, defaultID, mgrSet) {
			count++
		}
	}
	return count, nil
}

func (h *Handler) CountUsers(c *gin.Context) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return
	}

	if !httputil.RequireManagerOrExpertAccess(sessionData, c) {
		return
	}

	authToken := h.getAuthTokenWithRetry(sessionData)

	if sessionData.AccessLevel == constants.AccessLevelManager {
		count, err := h.countManagerUsers(c.Request.Context(), authToken, sessionData.UserID)
		if err != nil {
			if err.Error() == "failed to fetch manager groups" {
				httputil.InternalError(c, "failed to fetch manager groups")
			} else {
				applogger.ForComponent("users").Errorf("count users failed: %v", err)
				httputil.BadGateway(c, errKeycloakRequestFailed)
			}
			return
		}
		var online int64
		if h.sessionStore != nil {
			online, _ = h.sessionStore.CountActiveSessions(c.Request.Context())
		}
		httputil.SuccessResponse(c, gin.H{"total": count, "online": online})
		return
	}

	total, err := h.userStore.CountUsers(authToken, "")
	if err != nil {
		// Retry once with a fresh token on auth failure
		if strings.Contains(err.Error(), "401") && h.adminTokenProvider != nil {
			h.adminTokenProvider.Invalidate()
			authToken = h.getAuthTokenWithRetry(sessionData)
			total, err = h.userStore.CountUsers(authToken, "")
		}
		if err != nil {
			applogger.ForComponent("users").Errorf("count users failed: %v", err)
			httputil.BadGateway(c, errKeycloakRequestFailed)
			return
		}
	}

	var activeSessions int64
	if h.sessionStore != nil {
		activeSessions, _ = h.sessionStore.CountActiveSessions(c.Request.Context())
	}

	httputil.SuccessResponse(c, gin.H{"total": total, "online": activeSessions})
}

func (h *Handler) BulkDeleteUsers(c *gin.Context) {
	sessionData, ok := httputil.GetSessionFromContext(c)
	if !ok {
		return
	}
	if !httputil.RequireExpertAccess(sessionData, c) {
		return
	}

	var req struct {
		IDs []string `json:"ids"`
	}
	if c.ShouldBindJSON(&req) != nil || len(req.IDs) == 0 {
		httputil.BadRequest(c, "ids required")
		return
	}

	authToken := h.getAuthToken(sessionData)
	log := applogger.ForComponent("users")

	deleted, failed := h.processBulkUserDeletions(c, req.IDs, authToken, log)

	httputil.SuccessResponse(c, gin.H{"deleted": deleted, "failed": failed})
}

func (h *Handler) processBulkUserDeletions(c *gin.Context, userIDs []string, authToken string, log *logrus.Entry) (int, []string) {
	deleted := 0
	failed := make([]string, 0)

	for _, id := range userIDs {
		if err := h.deleteSingleUserInBulk(c, id, authToken, log); err != nil {
			log.Warnf("bulk delete failed for id=%s err=%v", id, err)
			failed = append(failed, id)
		} else {
			deleted++
		}
	}

	return deleted, failed
}

func (h *Handler) deleteSingleUserInBulk(c *gin.Context, userID string, authToken string, log *logrus.Entry) error {
	user, err := h.userStore.GetUser(authToken, userID)
	if err != nil {
		log.Warnf("bulk delete: failed to fetch user before delete id=%s err=%v", userID, err)
		return err
	}

	h.cleanupUserGroups(c.Request.Context(), userID)
	h.cleanupUserDatabaseRecords(userID, user.Email)

	if err := h.userStore.DeleteUser(authToken, userID); err != nil {
		return err
	}

	if err := h.deleteUserSessions(c.Request.Context(), userID); err != nil {
		log.Warnf("bulk delete: failed to delete sessions for user id=%s err=%v", userID, err)
	}

	return nil
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	var req struct {
		Name         *string `json:"name"`
		Organization *string `json:"organization"`
		Position     *string `json:"position"`
		Phone        *string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "Invalid request body")
		return
	}

	adminToken, err := h.adminAccessToken()
	if err != nil {
		applogger.ForComponent("users").Errorf("Error getting admin token: %v", err)
		httputil.InternalError(c, "Failed to authenticate with Keycloak")
		return
	}

	attributes := make(map[string][]string)
	if req.Name != nil {
		attributes["fullName"] = []string{*req.Name}
	}
	if req.Organization != nil {
		attributes["organization"] = []string{*req.Organization}
	}
	if req.Position != nil {
		attributes["position"] = []string{*req.Position}
	}
	if req.Phone != nil {
		attributes["phone"] = []string{*req.Phone}
	}

	if len(attributes) > 0 {
		if err := h.userStore.UpdateUserAttributes(adminToken, userID, attributes); err != nil {
			applogger.ForComponent("users").Errorf("Error updating user profile: %v", err)
			httputil.InternalError(c, "Failed to update profile")
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Profile updated successfully",
		"data": gin.H{
			"name":         req.Name,
			"organization": req.Organization,
			"position":     req.Position,
			"phone":        req.Phone,
		},
	})
}
