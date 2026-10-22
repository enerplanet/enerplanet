package config

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"spatialhub_backend/internal/bearerauth"

	"platform.local/platform/auth"
	platformconfig "platform.local/platform/config"

	goredis "github.com/redis/go-redis/v9"
)

const (
	defaultWebserviceURL = "http://localhost:8082"
	defaultOpenTechDBURL = "https://otdb.th-deg.de"
)

type Config struct {
	Auth                 auth.Config
	BearerAuth           bearerauth.Options
	RedisConfig          goredis.Options
	AppPort              string
	AppHost              string
	AppURL               string
	AppEnv               string
	AppTimezone          string
	CookieDomain         string
	Database             platformconfig.DatabaseConfig
	SessionTTLMinutes    int // Session timeout in minutes
	Email                platformconfig.EmailSettings
	AuthServiceURL       string // URL of the auth-service
	WebserviceServiceURL string // URL of the webservice microservice
	PylovoServiceURL     string // URL of the pylovo microservice
	WeatherProvider      string // provider passed on every weather-serve call (via TentaCron) — weather-serve has no server-side default
	BuemVersion          string // BuEM release the stored results are keyed for; must match the deployed buem-model
	PVVersion            string // PV service (pv-simulate) release the stored PV profiles are keyed for
	TentacronServiceURL  string // URL of the TentaCron orchestrator; every ignis, weather-serve, City2TABULA and buem-gateway call (resolve endpoint, run_buem, enrich, the /v1/ignis/* proxy) routes through it
	TentacronAPIKey      string // X-API-Key for TentaCron — required, every /v1 endpoint rejects a missing key
	OpenTechDBServiceURL string // URL of the OpenTech-DB service
	CallbackSecret       string // Shared secret for webservice callback authentication
	Frontend             FrontendConfig // Runtime settings served to the frontend at /config.js
}

// FrontendConfig holds the environment settings the frontend needs at runtime.
// They are injected at deploy time via env vars (radarr-style), never baked
// into the image, so one image runs beta and production.
type FrontendConfig struct {
	SSOEnabled          bool
	KeycloakURL         string
	KeycloakRealm       string
	KeycloakClientID    string
	KeycloakIDPHint     string
	KeycloakRedirectURI string
	APIBaseURL          string
	CartoBasemapAPIKey  string
}

func LoadFromEnv() (*Config, error) {
	if err := platformconfig.LoadEnvOnce(".", ".."); err != nil {
		return nil, err
	}

	redisDB, err := platformconfig.RequireEnvInt("REDIS_DATABASE")
	if err != nil {
		return nil, err
	}

	sessionTTL, err := platformconfig.GetEnvInt("SESSION_TTL_MINUTES", 60)
	if err != nil {
		return nil, err
	}

	emailSettings := platformconfig.EmailSettingsFromEnv()

	cfg := &Config{
		Auth:                 platformconfig.AuthConfigFromEnv(),
		RedisConfig:          platformconfig.RedisOptionsFromEnv(redisDB),
		AppPort:              os.Getenv("APP_PORT"),
		AppHost:              os.Getenv("APP_HOST"),
		AppURL:               os.Getenv("APP_URL"),
		AppEnv:               platformconfig.GetEnv("APP_ENV", "development"),
		AppTimezone:          platformconfig.GetEnv("APP_TIMEZONE", "UTC"),
		CookieDomain:         os.Getenv("COOKIE_DOMAIN"),
		SessionTTLMinutes:    sessionTTL,
		Email:                emailSettings,
		Database:             platformconfig.AppDatabaseFromEnv(),
		AuthServiceURL:       platformconfig.GetEnv("AUTH_SERVICE_URL", "http://auth-service:8001"),
		WebserviceServiceURL: normalizeWebserviceURL(platformconfig.GetEnv("WEBSERVICE_SERVICE_URL", defaultWebserviceURL)),
		PylovoServiceURL:     platformconfig.GetEnv("PYLOVO_SERVICE_URL", "http://localhost:8086"),
		WeatherProvider:      platformconfig.GetEnv("WEATHER_PROVIDER", "merra-2"),
		BuemVersion:          platformconfig.GetEnv("BUEM_VERSION", ""),
		PVVersion:            platformconfig.GetEnv("PV_VERSION", ""),
		// 8400 is TentaCron's slot in the dev port allocation (repos.conf),
		// a range chosen to avoid the crowded 8080 and 9000 neighbourhoods.
		// The Makefile publishes it there; TentaCron's own default is 8080,
		// which Keycloak holds in this stack.
		TentacronServiceURL:  platformconfig.GetEnv("TENTACRON_SERVICE_URL", "http://localhost:8400"),
		TentacronAPIKey:      os.Getenv("TENTACRON_API_KEY"),
		OpenTechDBServiceURL: platformconfig.GetEnv("OPENTECH_DB_SERVICE_URL", defaultOpenTechDBURL),
		CallbackSecret:       os.Getenv("CALLBACK_SECRET"),
	}
	cfg.BearerAuth, err = loadBearerAuth(cfg.AppEnv)
	if err != nil {
		return nil, err
	}

	// Frontend runtime settings — injected at deploy time (radarr-style env
	// vars), never baked into the image. FRONTEND_* overrides each; fall back
	// to the existing KEYCLOAK_*/APP_URL/APP_ENV vars so a container started
	// with only the classic vars still gets a working frontend config.
	cfg.Frontend = FrontendConfig{
		SSOEnabled:          platformconfig.GetEnvBool("FRONTEND_SSO_ENABLED", cfg.AppEnv == "production"),
		KeycloakURL:         platformconfig.GetEnv("FRONTEND_KEYCLOAK_URL", joinURL(cfg.AppURL, "/keycloak")),
		KeycloakRealm:       platformconfig.GetEnv("FRONTEND_KEYCLOAK_REALM", platformconfig.GetEnv("KEYCLOAK_REALM", "spatialhub")),
		KeycloakClientID:    platformconfig.GetEnv("FRONTEND_KEYCLOAK_CLIENT_ID", platformconfig.GetEnv("KEYCLOAK_CLIENT_ID", "spatialhub")),
		KeycloakIDPHint:     platformconfig.GetEnv("FRONTEND_KEYCLOAK_IDP_HINT", "renvolveit"),
		KeycloakRedirectURI: platformconfig.GetEnv("FRONTEND_KEYCLOAK_REDIRECT_URI", joinURL(cfg.AppURL, "/app/map")),
		APIBaseURL:          platformconfig.GetEnv("FRONTEND_API_BASE_URL", "/api"),
		CartoBasemapAPIKey:  os.Getenv("FRONTEND_CARTO_BASEMAP_API_KEY"),
	}

	return cfg, nil
}

// joinURL joins a base URL and a path, tolerating an empty base.
func joinURL(base, path string) string {
	if base == "" {
		return path
	}
	return strings.TrimRight(base, "/") + path
}

// RenderFrontendConfigJS renders the runtime frontend configuration as a
// JavaScript file that assigns window.__ENERPLANET_CONFIG__ before the app
// bundle loads. The frontend reads it at runtime instead of build-time
// import.meta.env values, so one image serves every environment.
func RenderFrontendConfigJS(f FrontendConfig) string {
	payload, err := json.Marshal(map[string]any{
		"sso": map[string]any{
			"enabled":     f.SSOEnabled,
			"url":         f.KeycloakURL,
			"realm":       f.KeycloakRealm,
			"clientId":    f.KeycloakClientID,
			"idpHint":     f.KeycloakIDPHint,
			"redirectUri": f.KeycloakRedirectURI,
		},
		"api": map[string]any{
			"baseUrl": f.APIBaseURL,
		},
		"cartoBasemapApiKey": f.CartoBasemapAPIKey,
	})
	if err != nil {
		// json.Marshal of a map of scalar values cannot fail; keep the file
		// syntactically valid rather than serving a broken assignment.
		return "window.__ENERPLANET_CONFIG__ = {};"
	}
	return fmt.Sprintf("window.__ENERPLANET_CONFIG__ = %s;", payload)
}

// normalizeWebserviceURL avoids unusable listener addresses such as 0.0.0.0 by replacing them with localhost.
func normalizeWebserviceURL(raw string) string {
	if raw == "" {
		return defaultWebserviceURL
	}
	switch raw {
	case "0.0.0.0", "http://0.0.0.0":
		return defaultWebserviceURL
	case "0.0.0.0:8085", "http://0.0.0.0:8085":
		return "http://localhost:8085"
	case "0.0.0.0:8082", "http://0.0.0.0:8082":
		return defaultWebserviceURL
	}
	return raw
}

// buemReleaseVersion is the form BuEM reports as model_version for a release
// image (buem-model:6.10.0 reports "6.10.0"); other tags report other strings.
var buemReleaseVersion = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// ValidateBuemVersion reports why v cannot key stored BuEM results: a result
// is stored only when BuEM's model_version equals it, so it must be the
// release version of the deployed buem-model image.
func ValidateBuemVersion(v string) error {
	if v == "" {
		return fmt.Errorf("BUEM_VERSION is not set; set it to the buem-model release in repos.conf (BUEM_MODEL_IMAGE_TAG), or no BuEM result is stored")
	}
	if !buemReleaseVersion.MatchString(v) {
		return fmt.Errorf("BUEM_VERSION %q is not a release version X.Y.Z; BuEM reports X.Y.Z only for release images, so no BuEM result would be stored", v)
	}
	return nil
}
