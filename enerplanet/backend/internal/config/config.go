package config

import (
	"os"

	"platform.local/platform/auth"
	platformconfig "platform.local/platform/config"

	goredis "github.com/redis/go-redis/v9"
)

const (
	defaultWebserviceURL = "http://localhost:8082"
	defaultOpenTechDBURL = "http://localhost:8004"
)

type Config struct {
	Auth                  auth.Config
	RedisConfig           goredis.Options
	AppPort               string
	AppHost               string
	AppURL                string
	AppEnv                string
	AppTimezone           string
	CookieDomain          string
	Database              platformconfig.DatabaseConfig
	SessionTTLMinutes     int // Session timeout in minutes
	Email                 platformconfig.EmailSettings
	AuthServiceURL        string // URL of the auth-service
	WebserviceServiceURL  string // URL of the webservice microservice
	PylovoServiceURL      string // URL of the pylovo microservice
	City2TabulaServiceURL string // URL of City2TABULA's on-request 3D-data server
	WeatherServiceURL     string // URL of weather-serve
	WeatherAPIKey         string // X-API-Key for weather-serve — required, checked by weather-serve itself
	WeatherProvider       string // provider passed on every weather-serve call — required, weather-serve has no server-side default
	BuemServiceURL        string // URL of buem-gateway
	BuemAPIKey            string // X-Api-Key for buem-gateway — only needed if BuemServiceURL goes through its reverse proxy, not a direct container call; see internal/buem.NewClient
	OpenTechDBServiceURL  string // URL of the OpenTech-DB service
	CallbackSecret        string // Shared secret for webservice callback authentication
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
		// 5000 matches City2TABULA's own SERVER_PORT default (cmd/server/main.go).
		City2TabulaServiceURL: platformconfig.GetEnv("CITY2TABULA_SERVICE_URL", "http://localhost:5000"),
		// 8090 matches weather-serve's own WEATHER_API_PORT default (docker-compose.serve.yml).
		WeatherServiceURL: platformconfig.GetEnv("WEATHER_SERVICE_URL", "http://localhost:8090"),
		WeatherAPIKey:     os.Getenv("WEATHER_API_KEY"),
		WeatherProvider:   platformconfig.GetEnv("WEATHER_PROVIDER", "merra-2"),
		// No default: buem-gateway's real deployment URL/port is unconfirmed (see the
		// on-request-3d-pipeline plan's risk #6) — empty fails loudly instead of guessing.
		BuemServiceURL:       os.Getenv("BUEM_SERVICE_URL"),
		BuemAPIKey:           os.Getenv("BUEM_API_KEY"),
		OpenTechDBServiceURL: platformconfig.GetEnv("OPENTECH_DB_SERVICE_URL", defaultOpenTechDBURL),
		CallbackSecret:       os.Getenv("CALLBACK_SECRET"),
	}
	return cfg, nil
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