// Package apitoken generates and validates personal access tokens.
package apitoken

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

// Prefix identifies API tokens in Authorization headers.
const Prefix = "whf_"

const randomBytes = 32

// Generated: a new token (plaintext shown once).
type Generated struct {
	Plaintext     string
	Hash          string
	DisplayPrefix string
}

// New creates a cryptographically random token.
func New() (*Generated, error) {
	buf := make([]byte, randomBytes)
	if _, err := rand.Read(buf); err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}
	plaintext := Prefix + base64.RawURLEncoding.EncodeToString(buf)
	return &Generated{
		Plaintext:     plaintext,
		Hash:          Hash(plaintext),
		DisplayPrefix: plaintext[:len(Prefix)+8],
	}, nil
}

// Hash returns the hex SHA-256 digest of a plaintext token.
func Hash(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// FromAuthorizationHeader returns the API token from the header, or "" if it carries none.
func FromAuthorizationHeader(header string) string {
	const bearer = "Bearer "
	if !strings.HasPrefix(header, bearer) {
		return ""
	}
	candidate := strings.TrimSpace(header[len(bearer):])
	if !strings.HasPrefix(candidate, Prefix) {
		return ""
	}
	return candidate
}
