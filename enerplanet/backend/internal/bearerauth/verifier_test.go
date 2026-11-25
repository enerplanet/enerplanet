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
	return Options{Issuer: f.Issuer, Audience: "enerplanet", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, AllowHTTP: true}
}

func TestVerifyAccessToken(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	for range 2 {
		identity, err := v.Verify(context.Background(), f.Sign(t, f.Claims("partner-user")))
		require.NoError(t, err)
		require.Equal(t, "partner-user", identity.Subject)
		require.Equal(t, f.Issuer, identity.Issuer)
		require.Equal(t, "partner-user@example.com", identity.Email)
		require.True(t, identity.EmailVerified)
	}
	require.Equal(t, 1, f.Requests(), "signing keys should be reused")
}

func TestProfileClaimsNotRequired(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	claims := f.Claims("partner-user")
	for _, claim := range []string{"email", "email_verified", "scope"} {
		delete(claims, claim)
	}
	_, err = v.Verify(context.Background(), f.Sign(t, claims))
	require.NoError(t, err, "the account comes from the identity provider link, not from token claims")
}

func TestAudienceOptional(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	opts := testOptions(f)
	opts.Audience = ""
	v, err := New(opts)
	require.NoError(t, err)
	for name, aud := range map[string]any{"other audience": []string{"account"}, "no audience": nil} {
		t.Run(name, func(t *testing.T) {
			claims := f.Claims("partner-user")
			if aud == nil {
				delete(claims, "aud")
			} else {
				claims["aud"] = aud
			}
			_, err := v.Verify(context.Background(), f.Sign(t, claims))
			require.NoError(t, err)
		})
	}
	claims := f.Claims("partner-user")
	claims["azp"] = "other-client"
	_, err = v.Verify(context.Background(), f.Sign(t, claims))
	require.ErrorIs(t, err, ErrClaims, "the client check stays without an audience")
}

func TestRejectedClaimsReportClientAndLifetime(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := New(testOptions(f))
	require.NoError(t, err)
	claims := f.Claims("partner-user")
	claims["azp"] = "real-toolbox"
	claims["exp"] = time.Now().Add(30 * time.Minute).Unix()
	_, err = v.Verify(context.Background(), f.Sign(t, claims))
	var rejected *RejectedClaims
	require.ErrorAs(t, err, &rejected)
	require.ErrorIs(t, err, ErrClaims)
	require.Equal(t, "real-toolbox", rejected.ClientID)
	require.Equal(t, []string{"enerplanet", "account"}, rejected.Audience)
	require.InDelta(t, (30 * time.Minute).Seconds(), rejected.Lifetime.Seconds(), 2)
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
		{"EnerPlanET realm token", "iss", "https://enerplanet.example/keycloak/realms/spatialhub"},
		{"expired", "exp", time.Now().Add(-time.Minute).Unix()},
		{"missing expiry", "exp", nil},
		{"empty subject", "sub", ""},
		{"ID token", "typ", "ID"},
		{"refresh token", "typ", "Refresh"},
		{"wrong client", "azp", "other-client"},
		{"missing client", "azp", nil},
		{"not yet valid", "nbf", time.Now().Add(time.Minute).Unix()},
		{"lifetime above ceiling", "exp", time.Now().Add(16 * time.Minute).Unix()},
		{"missing issued at", "iat", nil},
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
	v := oidc.NewVerifier(f.Issuer, keys, &oidc.Config{ClientID: "enerplanet"})
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
		{Issuer: "http://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit"},
		{Issuer: "https://issuer/realms/partner", Audience: "api", ClientID: "toolbox", CacheTTL: time.Minute},
		{Issuer: "https://issuer/realms/partner", IdentityProvider: "renvolveit", CacheTTL: time.Minute},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, JWKSURL: "http://keys/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, JWKSURL: "https://attacker.example/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, JWKSURL: "https://issuer:8443/certs"},
		{Issuer: "https://issuer/realms/spatialhub", Audience: "api", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, MaxTokenLifetime: -time.Second},
	} {
		_, err := New(opts)
		require.Error(t, err)
	}
}
