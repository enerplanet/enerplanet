package apitoken

import (
	"errors"
	"time"

	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"
	apitokenstore "spatialhub_backend/internal/store/apitoken"
)

// ErrInvalid is returned for unknown, revoked, or expired tokens.
var ErrInvalid = errors.New("invalid API token")

// Service validates presented tokens against the store.
type Service struct {
	store *apitokenstore.Store
}

func NewService(store *apitokenstore.Store) *Service {
	return &Service{store: store}
}

// Validate checks a plaintext token and records its use.
func (s *Service) Validate(plaintext string) (*backendModels.APIToken, error) {
	token, err := s.store.FindByHash(Hash(plaintext))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalid
		}
		return nil, err
	}
	if !token.IsActive(time.Now().UTC()) {
		return nil, ErrInvalid
	}
	_ = s.store.TouchLastUsed(token.ID)
	return token, nil
}
