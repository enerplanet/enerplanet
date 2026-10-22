package config

import (
	"fmt"
	"os"
	"time"

	platformconfig "platform.local/platform/config"
	"spatialhub_backend/internal/bearerauth"
)

func loadBearerAuth(appEnv string) (bearerauth.Options, error) {
	ttl, err := platformconfig.GetEnvInt("KEYCLOAK_API_JWKS_TTL_SECONDS", 300)
	if err != nil {
		return bearerauth.Options{}, err
	}
	if ttl < 1 || ttl > 3600 {
		return bearerauth.Options{}, fmt.Errorf("KEYCLOAK_API_JWKS_TTL_SECONDS must be between 1 and 3600")
	}
	maxLifetime, err := platformconfig.GetEnvInt("KEYCLOAK_API_MAX_TOKEN_LIFETIME_SECONDS", int(bearerauth.DefaultMaxTokenLifetime/time.Second))
	if err != nil {
		return bearerauth.Options{}, err
	}
	if maxLifetime < 60 || maxLifetime > 3600 {
		return bearerauth.Options{}, fmt.Errorf("KEYCLOAK_API_MAX_TOKEN_LIFETIME_SECONDS must be between 60 and 3600")
	}
	opts := bearerauth.Options{
		Issuer:    os.Getenv("KEYCLOAK_API_ISSUER"),
		Audience:  os.Getenv("KEYCLOAK_API_AUDIENCE"),
		ClientID:  os.Getenv("KEYCLOAK_API_CLIENT_ID"),
		JWKSURL:   os.Getenv("KEYCLOAK_API_JWKS_URL"),
		CacheTTL:         time.Duration(ttl) * time.Second,
		MaxTokenLifetime: time.Duration(maxLifetime) * time.Second,
		AllowHTTP:        appEnv == "development" || appEnv == "test",
	}
	return opts, opts.Validate()
}
