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

// schemaMigrationsTable records which migration files have already been
// applied. A later run only executes files that are not recorded; the row is
// written in the same transaction as the migration itself, so a failed file
// is rolled back and never recorded, and is retried cleanly on the next run.
const schemaMigrationsTable = "schema_migrations"

func main() {
	if err := applogger.Init("logs", "app"); err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}

	log := applogger.ForComponent("migration")
	log.Info("Starting database migration...")

	// Load configuration
	cfg, err := config.LoadFromEnv()
	if err != nil {
		applogger.Logger.Fatalf("failed to load configuration: %v", err)
	}

	// Connect to database
	db, sqlDB, err := platformdatabase.ConnectWithPing(cfg.Database)
	if err != nil {
		applogger.Logger.Fatalf("failed to connect to database: %v", err)
	}
	defer func() { _ = sqlDB.Close() }()

	migrationsDir, rerunFile, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		usage()
		os.Exit(2)
	}

	if rerunFile != "" {
		if err := rerunMigration(db, migrationsDir, rerunFile); err != nil {
			applogger.Logger.Fatalf("re-run failed: %v", err)
		}
		log.Info("Database migration re-run completed successfully")
		return
	}

	// Run migrations
	if err := runMigrations(db, migrationsDir); err != nil {
		applogger.Logger.Fatalf("migration failed: %v", err)
	}

	log.Info("Database migration completed successfully")
}

// parseArgs accepts an optional positional migrations directory (the historic
// call style) plus the --rerun and --dir flags:
//
//	migrate                          apply pending migrations in ./migrations
//	migrate /path/to/migrations      apply pending migrations in a directory
//	migrate --rerun NNN_file.sql    forget and re-apply one migration file
func parseArgs(args []string) (dir, rerunFile string, err error) {
	dir = "./migrations"
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--rerun":
			if i+1 >= len(args) {
				return "", "", fmt.Errorf("--rerun needs a migration file name")
			}
			rerunFile = args[i+1]
			i++
		case args[i] == "--dir":
			if i+1 >= len(args) {
				return "", "", fmt.Errorf("--dir needs a path")
			}
			dir = args[i+1]
			i++
		case strings.HasPrefix(args[i], "-"):
			return "", "", fmt.Errorf("unknown flag: %s", args[i])
		default:
			// Historic positional style: migrate /path/to/migrations
			dir = args[i]
		}
	}
	return dir, rerunFile, nil
}

func usage() {
	fmt.Fprintf(os.Stderr, `usage: migrate [DIR] [--rerun FILE] [--dir DIR]

Runs pending SQL migrations in DIR (default ./migrations), in filename order.
Files already recorded in the %s table are skipped.

  migrate                 apply pending migrations in ./migrations
  migrate /path/to/dir    apply pending migrations in the given directory
  migrate --rerun FILE    forget FILE's record and re-apply it; FILE must be
                          in DIR and written re-apply-safe
`, schemaMigrationsTable)
}

// ensureTrackingTable creates the migration bookkeeping table if it is absent.
func ensureTrackingTable(db *gorm.DB) error {
	stmt := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
		file_name  TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`, schemaMigrationsTable)
	return db.Exec(stmt).Error
}

// appliedFileNames returns the set of migration files already applied.
func appliedFileNames(db *gorm.DB) (map[string]struct{}, error) {
	var rows []struct {
		FileName string
	}
	if err := db.Table(schemaMigrationsTable).Select("file_name").Scan(&rows).Error; err != nil {
		return nil, err
	}
	applied := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		applied[r.FileName] = struct{}{}
	}
	return applied, nil
}

// listMigrationFiles returns the sorted .sql file names in migrationsDir.
// Lexical order (001_..., 002_...) is the applied order.
func listMigrationFiles(migrationsDir string) ([]string, error) {
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return nil, fmt.Errorf("read migrations directory: %w", err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	return files, nil
}

// runMigrations applies every .sql file in migrationsDir that is not yet
// recorded in the tracking table, in filename order.
func runMigrations(db *gorm.DB, migrationsDir string) error {
	if err := ensureTrackingTable(db); err != nil {
		return fmt.Errorf("create %s table: %w", schemaMigrationsTable, err)
	}
	applied, err := appliedFileNames(db)
	if err != nil {
		return fmt.Errorf("read applied migrations: %w", err)
	}
	files, err := listMigrationFiles(migrationsDir)
	if err != nil {
		return err
	}

	applogger.ForComponent("migration").Infof("Found %d migration file(s), %d already applied", len(files), len(applied))
	if len(files) == 0 {
		applogger.ForComponent("migration").Info("No migrations to apply")
		return nil
	}

	appliedCount := 0
	for _, file := range files {
		if _, ok := applied[file]; ok {
			applogger.WithFields(map[string]interface{}{"component": "migration", "migration": file}).Info("Already applied, skipping")
			continue
		}
		if err := applyMigrationFile(db, migrationsDir, file); err != nil {
			return fmt.Errorf("execute migration %s: %w", file, err)
		}
		appliedCount++
	}
	applogger.ForComponent("migration").Infof("Applied %d migration(s), skipped %d already-applied", appliedCount, len(files)-appliedCount)
	return nil
}

// rerunMigration force-re-applies a single migration file: its tracking row is
// removed and the file is executed again. Use when a recorded migration's SQL
// was fixed or its data must be refreshed. The file must be written
// re-apply-safe (guarded DDL), because its statements run exactly as stored.
func rerunMigration(db *gorm.DB, migrationsDir, file string) error {
	if err := ensureTrackingTable(db); err != nil {
		return fmt.Errorf("create %s table: %w", schemaMigrationsTable, err)
	}
	path := filepath.Join(migrationsDir, file)
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("migration file not found: %s: %w", file, err)
	}
	stmt := fmt.Sprintf("DELETE FROM %s WHERE file_name = ?", schemaMigrationsTable)
	if err := db.Exec(stmt, file).Error; err != nil {
		return fmt.Errorf("forget migration %s: %w", file, err)
	}
	applogger.WithFields(map[string]interface{}{"component": "migration", "migration": file}).Info("Forgetting applied record, re-running migration")
	if err := applyMigrationFile(db, migrationsDir, file); err != nil {
		return fmt.Errorf("execute migration %s: %w", file, err)
	}
	applogger.WithFields(map[string]interface{}{"component": "migration", "migration": file}).Info("Re-applied migration")
	return nil
}

// applyMigrationFile executes one migration file and records it, all in a
// single transaction: a failure rolls the file back, so nothing sticks
// half-applied and the next run retries it cleanly. ON CONFLICT DO NOTHING
// lets concurrent runners (two replicas starting at once) agree on a single
// record instead of failing one of them.
func applyMigrationFile(db *gorm.DB, migrationsDir, file string) error {
	path := filepath.Join(migrationsDir, file)
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration file %s: %w", file, err)
	}

	tx := db.Begin()
	if tx.Error != nil {
		return fmt.Errorf("begin transaction: %w", tx.Error)
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Exec(string(content)).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("execute SQL: %w", err)
	}
	recordStmt := fmt.Sprintf("INSERT INTO %s (file_name) VALUES (?) ON CONFLICT (file_name) DO NOTHING", schemaMigrationsTable)
	if err := tx.Exec(recordStmt, file).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("record migration %s: %w", file, err)
	}
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
