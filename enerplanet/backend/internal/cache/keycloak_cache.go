package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const (
	// Cache key prefixes
	keyPrefixUserGroups   = "kc:user_groups:"
	keyPrefixGroupMembers = "kc:group_members:"

	// Default TTLs
	defaultUserGroupsTTL   = 5 * time.Minute
	defaultGroupMembersTTL = 5 * time.Minute
)

// KeycloakCacheService provides caching for Keycloak group data
type KeycloakCacheService struct {
	redis           *goredis.Client
	userGroupsTTL   time.Duration
	groupMembersTTL time.Duration
}

// NewKeycloakCacheService creates a new KeycloakCacheService
func NewKeycloakCacheService(redis *goredis.Client) *KeycloakCacheService {
	return &KeycloakCacheService{
		redis:           redis,
		userGroupsTTL:   defaultUserGroupsTTL,
		groupMembersTTL: defaultGroupMembersTTL,
	}
}

// GetUserGroupIDs retrieves cached user group IDs
func (s *KeycloakCacheService) GetUserGroupIDs(ctx context.Context, userID string) ([]string, error) {
	if s.redis == nil {
		return nil, fmt.Errorf("redis client not available")
	}

	key := keyPrefixUserGroups + userID
	data, err := s.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}

	var groupIDs []string
	if err := json.Unmarshal(data, &groupIDs); err != nil {
		return nil, err
	}

	return groupIDs, nil
}

// SetUserGroupIDs caches user group IDs
func (s *KeycloakCacheService) SetUserGroupIDs(ctx context.Context, userID string, groupIDs []string) error {
	if s.redis == nil {
		return fmt.Errorf("redis client not available")
	}

	key := keyPrefixUserGroups + userID
	data, err := json.Marshal(groupIDs)
	if err != nil {
		return err
	}

	return s.redis.Set(ctx, key, data, s.userGroupsTTL).Err()
}

// GetGroupMemberUserIDs retrieves cached group member user IDs for a single group
func (s *KeycloakCacheService) GetGroupMemberUserIDs(ctx context.Context, groupID string) ([]string, error) {
	if s.redis == nil {
		return nil, fmt.Errorf("redis client not available")
	}

	key := keyPrefixGroupMembers + groupID
	data, err := s.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}

	var memberIDs []string
	if err := json.Unmarshal(data, &memberIDs); err != nil {
		return nil, err
	}

	return memberIDs, nil
}

// SetGroupMemberUserIDs caches group member user IDs for a single group
func (s *KeycloakCacheService) SetGroupMemberUserIDs(ctx context.Context, groupID string, memberIDs []string) error {
	if s.redis == nil {
		return fmt.Errorf("redis client not available")
	}

	key := keyPrefixGroupMembers + groupID
	data, err := json.Marshal(memberIDs)
	if err != nil {
		return err
	}

	return s.redis.Set(ctx, key, data, s.groupMembersTTL).Err()
}
