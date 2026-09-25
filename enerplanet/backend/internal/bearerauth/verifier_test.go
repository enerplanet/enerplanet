package bearerauth

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/stretchr/testify/require"
	"spatialhub_backend/internal/testutil"
)

func testOptions(f *testutil.OIDCFixture) Options {
	return Options{Issuer: f.Issuer, Audience: "enerplanet-api", ClientID: "renvolveit-toolbox", CacheTTL: time.Minute, AllowHTTP: true}
}

func TestVerifyAccessToken(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	for _, level := range []string{"very_low", "intermediate", "expert", "manager"} {
		t.Run(level, func(t *testing.T) {
			claims := f.Claims("local-user")
			claims["access_level"] = level
			identity, err := v.Verify(context.Background(), f.Sign(t, claims))
			require.NoError(t, err)
			require.Equal(t, "local-user", identity.Subject)
			require.Equal(t, f.Issuer, identity.Issuer)
			if level == "expert" || level == "manager" {
				level = "intermediate"
			}
			require.Equal(t, level, identity.AccessLevel)
		})
	}
	require.Equal(t, 1, f.Requests(), "signing keys should be reused")
}

func TestMissingAccessLevelDefaultsToVeryLow(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	claims := f.Claims("brokered-user")
	delete(claims, "access_level")
	identity, err := v.Verify(context.Background(), f.Sign(t, claims))
	require.NoError(t, err)
	require.Equal(t, "very_low", identity.AccessLevel)
}

func TestNonStringClaimShapes(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	for name, tc := range map[string]struct {
		claim string
		value any
		level string
	}{
		"multivalued access level":   {"access_level", []string{"expert"}, "intermediate"},
		"empty access level array":   {"access_level", []string{}, "very_low"},
		"null access level":          {"access_level", nil, "very_low"},
		"string email verified":      {"email_verified", "true", "intermediate"},
		"multivalued email verified": {"email_verified", []string{"true"}, "intermediate"},
	} {
		t.Run(name, func(t *testing.T) {
			claims := f.Claims("local-user")
			claims[tc.claim] = tc.value
			identity, err := v.Verify(context.Background(), f.Sign(t, claims))
			require.NoError(t, err)
			require.Equal(t, tc.level, identity.AccessLevel)
		})
	}
}

func TestRejectionCategories(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	claims := f.Claims("local-user")
	claims["exp"] = time.Now().Add(-time.Minute).Unix()
	_, err = v.Verify(context.Background(), f.Sign(t, claims))
	require.ErrorIs(t, err, ErrExpired)
	claims = f.Claims("local-user")
	claims["exp"] = time.Now().Add(24 * time.Hour).Unix()
	_, err = v.Verify(context.Background(), f.Sign(t, claims))
	require.ErrorIs(t, err, ErrLifetime)
	_, err = v.Verify(context.Background(), "not-a-jwt")
	require.ErrorIs(t, err, ErrInvalidToken)
	var unconfigured *Verifier
	_, err = unconfigured.Verify(context.Background(), "any")
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestRejectInvalidClaims(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	tests := []struct {
		name, claim string
		value       any
	}{
		{"foreign issuer", "iss", "https://login.staging.renvolve.it/realms/RENvolveIT"},
		{"wrong audience", "aud", []string{"account"}},
		{"expired", "exp", time.Now().Add(-time.Minute).Unix()},
		{"missing expiry", "exp", nil},
		{"empty subject", "sub", ""},
		{"ID token", "typ", "ID"},
		{"refresh token", "typ", "Refresh"},
		{"wrong client", "azp", "other-client"},
		{"missing client", "azp", nil},
		{"unverified email", "email_verified", false},
		{"missing email", "email", nil},
		{"invalid access level", "access_level", "admin"},
		{"not yet valid", "nbf", time.Now().Add(time.Minute).Unix()},
		{"lifetime above ceiling", "exp", time.Now().Add(16 * time.Minute).Unix()},
		{"missing issued at", "iat", nil},
		{"access level array of two", "access_level", []string{"intermediate", "expert"}},
		{"access level number", "access_level", 3},
		{"email verified text", "email_verified", "yes"},
		{"email verified false text", "email_verified", "false"},
		{"future issued", "iat", time.Now().Add(time.Minute).Unix()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims := f.Claims("local-user")
			if tt.value == nil {
				delete(claims, tt.claim)
			} else {
				claims[tt.claim] = tt.value
			}
			_, err := v.Verify(context.Background(), f.Sign(t, claims))
			require.Error(t, err)
		})
	}
}

func TestRejectTamperingAndUnsignedTokens(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	raw := f.Sign(t, f.Claims("local-user"))
	parts := strings.Split(raw, ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err)
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(strings.ReplaceAll(string(payload), "local-user", "other-user")))
	unsigned := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`)) + "." + parts[1] + "."
	for _, token := range []string{strings.Join(parts, "."), unsigned, "not-a-jwt", strings.Repeat("x", 32*1024+1)} {
		_, err := v.Verify(context.Background(), token)
		require.Error(t, err)
	}
	foreign := testutil.NewOIDCFixture(t)
	_, err = v.Verify(context.Background(), foreign.Sign(t, f.Claims("local-user")))
	require.Error(t, err, "matching claims signed by an untrusted key must fail")
}

// Disable throttle.
func noCooldown(t *testing.T) {
	old := jwksRefreshCooldown
	jwksRefreshCooldown = 0
	t.Cleanup(func() { jwksRefreshCooldown = old })
}

func TestSigningKeyRotationAndOutage(t *testing.T) {
	noCooldown(t)
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	raw := f.Sign(t, f.Claims("user-a"))
	_, err = v.Verify(context.Background(), raw)
	require.NoError(t, err)
	f.SetUnavailable(true)
	_, err = v.Verify(context.Background(), raw)
	require.NoError(t, err, "known key remains usable within cache TTL")
	f.Rotate(t)
	raw = f.Sign(t, f.Claims("user-a"))
	_, err = v.Verify(context.Background(), raw)
	require.Error(t, err, "unknown key during outage must fail closed")
	f.SetUnavailable(false)
	_, err = v.Verify(context.Background(), raw)
	require.NoError(t, err, "unknown kid should refresh keys")
}

func TestJWKSRefreshThrottled(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	_, err = v.Verify(context.Background(), f.Sign(t, f.Claims("user-a")))
	require.NoError(t, err)
	forged := testutil.NewOIDCFixture(t).Sign(t, f.Claims("user-a"))
	for range 5 {
		_, err = v.Verify(context.Background(), forged)
		require.Error(t, err)
	}
	require.Equal(t, 1, f.Requests(), "forged tokens must not trigger downloads within the cooldown")
	f.Rotate(t)
	rotated := f.Sign(t, f.Claims("user-a"))
	_, err = v.Verify(context.Background(), rotated)
	require.Error(t, err, "new key is not fetched inside the cooldown")
	v.keys.mu.Lock()
	v.keys.fetched = time.Now().Add(-jwksRefreshCooldown)
	v.keys.mu.Unlock()
	_, err = v.Verify(context.Background(), rotated)
	require.NoError(t, err, "rotation is picked up after the cooldown")
	require.Equal(t, 2, f.Requests())
}

func TestJWKSCacheExpiryRemovesOldKeys(t *testing.T) {
	noCooldown(t)
	f := testutil.NewOIDCFixture(t)
	keys := &expiringKeySet{url: f.Issuer + "/protocol/openid-connect/certs", ttl: time.Minute}
	v := oidc.NewVerifier(f.Issuer, keys, &oidc.Config{ClientID: "enerplanet-api"})
	raw := f.Sign(t, f.Claims("user-a"))
	_, err := v.Verify(context.Background(), raw)
	require.NoError(t, err)
	f.Rotate(t)
	keys.mu.Lock()
	keys.expires = time.Time{}
	keys.mu.Unlock()
	_, err = v.Verify(context.Background(), raw)
	require.Error(t, err, "removed signing keys must not be trusted indefinitely")
	_, err = v.Verify(context.Background(), f.Sign(t, f.Claims("user-a")))
	require.NoError(t, err)
}

func TestOptionsFailClosed(t *testing.T) {
	v, err := New(Options{})
	require.NoError(t, err)
	require.Nil(t, v)
	_, err = v.Verify(context.Background(), "any")
	require.Error(t, err)
	for _, opts := range []Options{
		{Audience: "api"},
		{Issuer: "http://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute, JWKSURL: "http://keys/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute, JWKSURL: "https://attacker.example/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute, JWKSURL: "https://issuer:8443/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute, MaxTokenLifetime: -time.Second},
	} {
		_, err := New(opts)
		require.Error(t, err)
	}
}
