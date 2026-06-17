package models

import "time"

// APIToken lets an external app call the API as a specific user; only the token hash is stored.
type APIToken struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	UserID    string `gorm:"not null;size:255;index" json:"user_id"`
	UserEmail string `gorm:"not null;size:255" json:"user_email"`
	Name      string `gorm:"not null;size:255" json:"name"`

	TokenHash   string `gorm:"not null;size:64;uniqueIndex" json:"-"`
	TokenPrefix string `gorm:"not null;size:16" json:"token_prefix"`

	// Scope is "read" (GET only) or "full" (writes allowed too).
	Scope string `gorm:"not null;size:16;default:'read'" json:"scope"`

	// AccessLevel is clamped below expert/manager so a token never has admin rights.
	AccessLevel string `gorm:"not null;size:32;default:'intermediate'" json:"access_level"`

	CreatedBy string `gorm:"not null;size:255" json:"created_by"`

	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

const (
	APITokenScopeRead = "read"
	APITokenScopeFull = "full"
)

func (APIToken) TableName() string {
	return "api_tokens"
}

// IsActive reports whether the token is neither revoked nor expired.
func (t *APIToken) IsActive(now time.Time) bool {
	if t.RevokedAt != nil {
		return false
	}
	if t.ExpiresAt != nil && now.After(*t.ExpiresAt) {
		return false
	}
	return true
}
