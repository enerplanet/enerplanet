package cache

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const (
	// Cache key prefix for sync status
	keyPrefixSyncMember = "sync:member:"

	// Default TTL for sync status (5 minutes — short enough to pick up new shares quickly)
	defaultSyncTTL = 5 * time.Minute
)

// SyncCacheService tracks sync status per session
type SyncCacheService struct {
	redis   *goredis.Client
	syncTTL time.Duration
}

// NewSyncCacheService creates a new SyncCacheService
func NewSyncCacheService(redis *goredis.Client) *SyncCacheService {
	return &SyncCacheService{
		redis:   redis,
		syncTTL: defaultSyncTTL,
	}
}

// HasSynced checks if sync has already run for this user in the current session window
func (s *SyncCacheService) HasSynced(ctx context.Context, userID string) bool {
	if s.redis == nil {
		return false
	}

	key := keyPrefixSyncMember + userID
	exists, err := s.redis.Exists(ctx, key).Result()
	if err != nil {
		return false
	}

	return exists > 0
}

// MarkSynced marks that sync has run for this user
func (s *SyncCacheService) MarkSynced(ctx context.Context, userID string) error {
	if s.redis == nil {
		return fmt.Errorf("redis client not available")
	}

	key := keyPrefixSyncMember + userID
	return s.redis.Set(ctx, key, "1", s.syncTTL).Err()
}
