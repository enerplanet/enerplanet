package middleware

import (
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type tokenBucket struct {
	tokens         int
	lastRefillTime time.Time
}

type rateLimiter struct {
	mu             sync.Mutex
	buckets        map[string]*tokenBucket
	limit          int
	refillInterval time.Duration
}

func newRateLimiter(limit int, refillInterval time.Duration) *rateLimiter {
	rl := &rateLimiter{
		buckets:        make(map[string]*tokenBucket),
		limit:          limit,
		refillInterval: refillInterval,
	}
	go rl.evictLoop()
	return rl
}

// evictLoop periodically removes stale entries that haven't been seen
// for longer than twice the refill interval.
func (rl *rateLimiter) evictLoop() {
	ticker := time.NewTicker(rl.refillInterval * 2)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		cutoff := time.Now().Add(-rl.refillInterval * 2)
		for ip, bucket := range rl.buckets {
			if bucket.lastRefillTime.Before(cutoff) {
				delete(rl.buckets, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *rateLimiter) allow(clientIP string) bool {
	now := time.Now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, ok := rl.buckets[clientIP]
	if !ok {
		bucket = &tokenBucket{tokens: rl.limit, lastRefillTime: now}
		rl.buckets[clientIP] = bucket
	}

	// Refill tokens
	if elapsed := now.Sub(bucket.lastRefillTime); elapsed >= rl.refillInterval {
		bucket.tokens = rl.limit
		bucket.lastRefillTime = now
	}

	if bucket.tokens <= 0 {
		return false
	}
	bucket.tokens--
	return true
}

func RateLimit() gin.HandlerFunc {
	limit := 100
	if v := os.Getenv("RATE_LIMIT_PER_MIN"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	rl := newRateLimiter(limit, time.Minute)

	return func(c *gin.Context) {
		if !rl.allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			return
		}
		c.Next()
	}
}
