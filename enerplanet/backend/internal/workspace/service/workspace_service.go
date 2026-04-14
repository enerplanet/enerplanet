package workspaceservice

import (
	"gorm.io/gorm"
	authplatform "platform.local/platform/auth"
	platformkeycloak "platform.local/platform/keycloak"
	"spatialhub_backend/internal/cache"
)

const (
	queryWorkspaceAndGroupIDs = "workspace_id = ? AND group_id = ?"
	queryIDEquals             = "id = ?"
)

// WorkspaceService holds business logic
type WorkspaceService struct {
	db    *gorm.DB
	kc    *platformkeycloak.Client
	cache *cache.KeycloakCacheService
}

func NewWorkspaceService(db *gorm.DB, adminTokenProvider *authplatform.AdminTokenProvider, keycloakBaseURL, realm string, kcCache *cache.KeycloakCacheService) *WorkspaceService {
	return &WorkspaceService{
		db:    db,
		kc:    platformkeycloak.NewClient(keycloakBaseURL, realm, adminTokenProvider),
		cache: kcCache,
	}
}
