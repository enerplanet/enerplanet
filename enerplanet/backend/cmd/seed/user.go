package main

import (
	"context"
	"log"

	"platform.local/platform/keycloak"
)

func seedUser(ctx context.Context, kc *keycloak.Client) {
	username := "admin"
	email := "admin@example.de"
	password := "12345678"
	fullName := "Admin"
	organization := "Example Inc."
	position := "Dev"
	phone := ""

	// Only seed the default admin when no users exist at all.
	users, err := kc.FindUsers(ctx, "")
	if err != nil {
		log.Printf("Failed to find users: %v", err)
		return
	}

	if len(users) > 0 {
		log.Printf("Users already exist (%d), skipping admin seed", len(users))
		return
	}

	// Create user
	user := map[string]any{
		"username":      username,
		"email":         email,
		"enabled":       true,
		"emailVerified": true,
		"credentials": []map[string]any{
			{
				"type":      "password",
				"value":     password,
				"temporary": false,
			},
		},
		"attributes": map[string]any{
			"access_level": []string{"expert"},
			"fullName":     []string{fullName},
			"organization": []string{organization},
			"position":     []string{position},
			"phone":        []string{phone},
		},
	}

	id, err := kc.CreateUser(ctx, user)
	if err != nil {
		log.Printf("Failed to create user: %v", err)
		return
	}
	log.Printf("Seeded user: %s (%s)", username, id)
}
