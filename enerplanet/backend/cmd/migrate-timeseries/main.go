package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	platformdatabase "platform.local/platform/database"
	applogger "platform.local/platform/logger"
	"spatialhub_backend/internal/config"

	"gorm.io/gorm"
)

// main runs the migrations for the separate TimescaleDB instance that stores
// time-series datasets. It connects to cfg.TimeseriesDatabase and applies the
// SQL files in migrations/timeseries/ (overridable via the first argument).
func main() {
	if err := applogger.Init("logs", "app"); err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}

	log := applogger.ForComponent("migration-timeseries")
	log.Info("Starting timeseries database migration...")

	cfg, err := config.LoadFromEnv()
	if err != nil {
		applogger.Logger.Fatalf("failed to load configuration: %v", err)
	}

	db, sqlDB, err := platformdatabase.ConnectWithPing(cfg.TimeseriesDatabase)
	if err != nil {
		applogger.Logger.Fatalf("failed to connect to timeseries database: %v", err)
	}
	defer func() { _ = sqlDB.Close() }()

	migrationsDir := "./migrations/timeseries"
	if len(os.Args) > 1 {
		migrationsDir = os.Args[1]
	}

	if err := runMigrations(db, migrationsDir); err != nil {
		applogger.Logger.Fatalf("timeseries migration failed: %v", err)
	}

	log.Info("Timeseries database migration completed successfully")
}

func runMigrations(db *gorm.DB, migrationsDir string) error {
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
	}

	var migrationFiles []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			migrationFiles = append(migrationFiles, e.Name())
		}
	}
	sort.Strings(migrationFiles)

	applogger.ForComponent("migration-timeseries").Infof("Found %d migration file(s)", len(migrationFiles))

	if len(migrationFiles) == 0 {
		applogger.Logger.Info("No migrations to apply")
		return nil
	}

	for _, file := range migrationFiles {
		path := filepath.Join(migrationsDir, file)
		applogger.WithFields(map[string]interface{}{"component": "migration-timeseries", "migration": file}).Info("Applying migration")

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read migration file %s: %w", file, err)
		}

		if err := applyMigration(db, string(content)); err != nil {
			return fmt.Errorf("execute migration %s: %w", file, err)
		}

		applogger.WithFields(map[string]interface{}{"component": "migration-timeseries", "migration": file}).Info("Successfully applied migration")
	}

	applogger.ForComponent("migration-timeseries").Infof("Applied %d migration(s)", len(migrationFiles))
	return nil
}

func applyMigration(db *gorm.DB, sql string) error {
	tx := db.Begin()
	if tx.Error != nil {
		return fmt.Errorf("begin transaction: %w", tx.Error)
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Exec(sql).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("execute SQL: %w", err)
	}

	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
