package modelservice

import (
	"gorm.io/gorm"

	platformkeycloak "platform.local/platform/keycloak"
	"spatialhub_backend/internal/cache"
	modelstore "spatialhub_backend/internal/store/model"
)

type ModelService struct {
	db            *gorm.DB
	store         *modelstore.Store
	kc            *platformkeycloak.Client
	keycloakCache *cache.KeycloakCacheService
}

func NewModelService(db *gorm.DB, kc *platformkeycloak.Client) *ModelService {
	return &ModelService{db: db, store: modelstore.NewStore(db), kc: kc}
}

// NewModelServiceWithCache creates a ModelService with caching support
func NewModelServiceWithCache(db *gorm.DB, kc *platformkeycloak.Client, keycloakCache *cache.KeycloakCacheService) *ModelService {
	return &ModelService{db: db, store: modelstore.NewStore(db), kc: kc, keycloakCache: keycloakCache}
}
