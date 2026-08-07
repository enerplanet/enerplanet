
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"platform.local/platform/database"
	"spatialhub_backend/internal/config"
	"spatialhub_backend/internal/geo"

	"gorm.io/datatypes"
)

type modelRow struct {
	ID          string         `gorm:"column:id"`
	Coordinates datatypes.JSON `gorm:"column:coordinates"`
	Country     *string        `gorm:"column:country"`
}

func (modelRow) TableName() string { return "models" }

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, sqlDB, err := database.ConnectWithPing(cfg.Database)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer sqlDB.Close()

	resolver := geo.NewNominatimResolver(db)
	ctx := context.Background()

	var rows []modelRow
	if err := db.Where("country IS NULL OR country = ''").Find(&rows).Error; err != nil {
		log.Fatalf("query models: %v", err)
	}

	log.Printf("found %d model(s) with missing country", len(rows))

	var ok, failed int
	for _, r := range rows {
		if len(r.Coordinates) == 0 {
			fmt.Fprintf(os.Stderr, "model %s: no coordinates, skipped\n", r.ID)
			failed++
			continue
		}
		country, err := resolver.Resolve(ctx, []byte(r.Coordinates))
		if err != nil {
			fmt.Fprintf(os.Stderr, "model %s: resolve failed: %v\n", r.ID, err)
			failed++
			continue
		}
		if err := db.Exec("UPDATE models SET country = ?, updated_at = ? WHERE id = ?",
			country, time.Now().UTC(), r.ID).Error; err != nil {
			fmt.Fprintf(os.Stderr, "model %s: update failed: %v\n", r.ID, err)
			failed++
			continue
		}
		ok++
		// Gentle rate-limit guard when cache misses hit Nominatim directly.
		time.Sleep(100 * time.Millisecond)
	}

	log.Printf("done: %d updated, %d failed", ok, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
