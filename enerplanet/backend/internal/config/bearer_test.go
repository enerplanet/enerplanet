package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBearerConfiguration(t *testing.T) {
	for _, key := range []string{"KEYCLOAK_API_ISSUER", "KEYCLOAK_API_AUDIENCE", "KEYCLOAK_API_CLIENT_ID", "KEYCLOAK_API_JWKS_URL", "KEYCLOAK_API_JWKS_TTL_SECONDS", "KEYCLOAK_API_MAX_TOKEN_LIFETIME_SECONDS"} {
		t.Setenv(key, "")
	}
	_, err := loadBearerAuth("production")
	require.NoError(t, err)
	t.Setenv("KEYCLOAK_API_AUDIENCE", "enerplanet-api")
	_, err = loadBearerAuth("production")
	require.Error(t, err, "partial configuration must fail startup")
	t.Setenv("KEYCLOAK_API_ISSUER", "https://issuer/realms/spatialhub")
	t.Setenv("KEYCLOAK_API_CLIENT_ID", "renvolveit-toolbox")
	_, err = loadBearerAuth("production")
	require.NoError(t, err)
	t.Setenv("KEYCLOAK_API_ISSUER", "http://localhost:8080/realms/spatialhub")
	_, err = loadBearerAuth("production")
	require.Error(t, err)
	_, err = loadBearerAuth("development")
	require.NoError(t, err)
	t.Setenv("KEYCLOAK_API_JWKS_TTL_SECONDS", "-1")
	_, err = loadBearerAuth("development")
	require.Error(t, err)
	t.Setenv("KEYCLOAK_API_JWKS_TTL_SECONDS", "")
	t.Setenv("KEYCLOAK_API_MAX_TOKEN_LIFETIME_SECONDS", "86400")
	_, err = loadBearerAuth("development")
	require.Error(t, err, "lifetime ceiling above one hour must be refused")
	t.Setenv("KEYCLOAK_API_MAX_TOKEN_LIFETIME_SECONDS", "")
	opts, err := loadBearerAuth("development")
	require.NoError(t, err)
	require.Equal(t, 15*time.Minute, opts.MaxTokenLifetime)
}
