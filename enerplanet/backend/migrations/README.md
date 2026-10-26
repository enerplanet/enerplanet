# Database migrations

The backend applies these SQL files to the `spatialai` database through the
`/app/migrate` binary (`enerplanet/backend/cmd/migrate`). Every file that runs
is recorded in the `schema_migrations` table, so a migration is applied
**once** and later runs skip it.

## How a run works

1. The runner creates the `schema_migrations` tracking table if it is missing.
2. It lists every `*.sql` file in this directory, sorted by filename
   (`001_...`, `002_...` — that order **is** the apply order).
3. Files already recorded in `schema_migrations` are skipped.
4. Each new file executes and, in the **same transaction**, its file name is
   recorded. A failure rolls the whole file back, so nothing sticks
   half-applied and the next run retries it cleanly.

Running migrations is therefore idempotent: `make migrate` (or the container
starting) can run as often as you like; only genuinely new files execute.

## Running

```bash
make migrate                      # in the local dev stack (docker image)
make migrate-rerun FILE=044_x.sql # force re-apply one migration (see below)
```

Manually against the running stack, from `enerplanet/backend`:

```bash
go run ./cmd/migrate                                    # ./migrations
go run ./cmd/migrate ./migrations                       # historic form
go run ./cmd/migrate --rerun 044_rename_building_heat_profiles_to_demand_profiles.sql
```

`/app/migrate --help` prints the same usage inside the image.

## Writing a new migration

- Name it `NNN_short_description.sql` with the **next number** — never reuse or
  renumber an existing file. Lexical order is apply order.
- It does not need `IF NOT EXISTS` guards for correctness anymore: the tracking
  table means each file runs once.
- **Keep it guarded anyway.** The `--rerun` escape hatch (below) and the
  container-start migration run re-execute files, and the migration on start
  reruns everything not yet recorded — guard clauses (`IF NOT EXISTS`, `DO $$
  ... $$` existence probes, data checks) keep a re-run harmless.
- It runs inside a transaction; DDL in PostgreSQL is transactional, so a
  mid-file failure leaves no partial schema. Statements PostgreSQL cannot run
  inside a transaction (e.g. `CREATE INDEX CONCURRENTLY`) must not be used.
- **Never edit an applied migration.** Once recorded, a file's SQL will not run
  again on its own. To change the schema afterwards, add a new numbered file.
  If a recorded file *must* change, that is exactly what `--rerun` is for.

## Re-running one migration (`--rerun`)

Use when a recorded migration was fixed or its data must be refreshed:

```bash
make migrate-rerun FILE=044_rename_building_heat_profiles_to_demand_profiles.sql
# or directly in the image:
docker compose ... run --rm --entrypoint /app/migrate energy-backend \
  --rerun 044_rename_building_heat_profiles_to_demand_profiles.sql
```

`--rerun` deletes the file's tracking row and executes the file again, exactly
as stored — so the file **must** be written re-apply-safe (guarded DDL). It
fails loudly if not, which is the point: a broken re-run should stop the
deploy, not silently corrupt.

The container entrypoint runs the same migration command before every start or
restart (`RUN_MIGRATIONS_ON_START=false` skips it), so pending migrations are
applied automatically on deploy; `--rerun` is the only way to force one
recorded file to repeat.

## Notes

- Tables created by GORM's `AutoMigrate` (e.g. `migration_model`) are a
  separate mechanism and not tracked here.
- The TimescaleDB time-series database has its own migration runner
  (`cmd/migrate-timeseries`) on the timescaledb feature branch.
