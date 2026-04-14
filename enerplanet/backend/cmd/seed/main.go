package main

import (
	"context"
	"log"

	"spatialhub_backend/internal/config"

	pkgauth "platform.local/platform/auth"
	"platform.local/platform/database"
	"platform.local/platform/keycloak"
)

func main() {
	// Load config
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Connect to DB
	db, sqlDB, err := database.ConnectWithPing(cfg.Database)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer sqlDB.Close()

	// Connect to Keycloak
	adminTokenProvider := pkgauth.NewAdminTokenProvider(
		cfg.Auth.BaseURL,
		cfg.Auth.Realm,
		cfg.Auth.ClientID,
		cfg.Auth.ClientSecret,
	)

	kcClient := keycloak.NewClient(
		cfg.Auth.BaseURL,
		cfg.Auth.Realm,
		adminTokenProvider,
	)

	ctx := context.Background()

	// Seed Webservice
	seedWebservice(db)

	// Seed User
	seedUser(ctx, kcClient)

	// Seed Technologies
	seedTechnologies(db)

	// Energy demand is calculated dynamically based on building area and type
}
