package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/require"
)

// OIDC test server.
type OIDCFixture struct {
	Issuer      string
	mu          sync.Mutex
	key         jose.JSONWebKey
	requests    int
	unavailable bool
}

func NewOIDCFixture(t *testing.T) *OIDCFixture {
	t.Helper()
	f := &OIDCFixture{}
	f.Rotate(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests++
		if f.unavailable {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/realms/spatialhub/protocol/openid-connect/certs" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{f.key.Public()}})
	}))
	t.Cleanup(server.Close)
	f.Issuer = server.URL + "/realms/spatialhub"
	return f
}

func (f *OIDCFixture) Rotate(t *testing.T) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.key = jose.JSONWebKey{Key: key, KeyID: fmt.Sprintf("key-%s", key.N.String()[:12]), Algorithm: string(jose.RS256), Use: "sig"}
}

func (f *OIDCFixture) Claims(subject string) map[string]any {
	return map[string]any{
		"iss": f.Issuer, "aud": []string{"enerplanet-api"}, "sub": subject,
		"exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix(),
		"typ": "Bearer", "azp": "renvolveit-toolbox", "scope": "openid email enerplanet:read",
		"email": subject + "@example.com", "email_verified": true, "name": "Test User",
		"access_level": "intermediate",
	}
}

func (f *OIDCFixture) Sign(t *testing.T, claims map[string]any) string {
	t.Helper()
	f.mu.Lock()
	key := f.key
	f.mu.Unlock()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	require.NoError(t, err)
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	signed, err := signer.Sign(payload)
	require.NoError(t, err)
	raw, err := signed.CompactSerialize()
	require.NoError(t, err)
	return raw
}

func (f *OIDCFixture) Requests() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests
}

func (f *OIDCFixture) SetUnavailable(value bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.unavailable = value
}
