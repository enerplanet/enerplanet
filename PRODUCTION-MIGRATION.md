# Production migration: `main` → `docker-build-process`

Runbook for moving the production server (currently at the state of the
`main` branch) to the state of the `docker-build-process` branch. Read it
end-to-end before starting; the single most important step is **Step 3**
(bootstrap the migration tracking table), because it prevents the new migration
runner from re-applying every historic migration on first boot.

---

## 1. What changes

| Area | On `main` | On `docker-build-process` |
|---|---|---|
| App image | built on the server by the deploy pipeline (`Dockerfile.ci`) | same shape, now **env-agnostic** — frontend reads `/config.js` at runtime, no build args baked |
| DB migrations | old runner applied *every* `*.sql` on every run, no tracking | new runner (**`cmd/migrate`**) records each applied file in a `schema_migrations` table, skips recorded files, supports `--rerun` |
| Migration trigger | explicit `migrate` job in the pipeline | **also** on every container start — the entrypoint (`/app/start.sh`) runs `/app/migrate` before `/app/server` unless `RUN_MIGRATIONS_ON_START=false` |
| New schema (net-new migrations on this branch) | — | `042`–`052` (building/demand profiles, city2tabula runs, meme runs, result source, series, technology product fields, feedback run reports/seen) |
| Frontend config | baked at build time | served to the browser at `/config.js` from `FRONTEND_*` env vars (radarr-style) |

The branch also carries the accumulated feature work merged through PR #310
(heat, meme/pypsa, 3D buildings/PV, grid mode, feedback) — those are code, not
ops steps. The ops-relevant deltas are the three bullet rows above.

---

## 2. Preflight (on the production server)

```bash
# Confirm what is actually running and which schema revision the DB is at.
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect energy-backend-prod --format '{{.Config.Image}}'

# Migrations table must NOT exist yet (old runner never created it).
docker exec postgres psql -U postgres -d spatialai \
  -c "\dt" | grep schema_migrations || echo "no schema_migrations (expected)"
```

Expected: the backend runs on an image built from `main`, and there is **no**
`schema_migrations` table. If the table already exists, someone has run the
new runner before — skip Step 3 (but still run step 4's verification).

Confirm `~/.github` runners and the `deploy/` directory reachable:
```bash
ls -la "$HOME/deploy/enerplanet" "$HOME/deploy/platform-core/.env"
```

---

## 3. Bootstrap the `schema_migrations` table (critical)

The new runner only re-executes migration files that are **not** recorded in
`schema_migrations`. Your production DB was built by the old runner, which
never recorded anything, so on first boot the new runner would try to re-apply
**all 39 historic migrations** (`001`–`039`, plus `041`; `011`/`018`/`040` never
existed, hence the gaps) plus the 11 new ones (`042`–`052`). The historic
files are guarded and mostly idempotent, but that is not a bet you want to take
against a live database at once on container start.

Do this **once, before** deploying the new image, against the running
Postgres:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    file_name  TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (file_name) VALUES
('001_create_feedback_table.sql'),
('002_create_webservice_instances_table.sql'),
('003_create_user_settings_table.sql'),
('004_create_notifications_tables.sql'),
('005_create_workspace_tables.sql'),
('006_create_models_table.sql'),
('007_cascade_delete_child_models.sql'),
('007_update_model_activation_default.sql'),
('008_add_preferred_workspace_and_rename_owner.sql'),
('009_fix_workspace_member_unique_constraint.sql'),
('010_create_model_shares_table.sql'),
('012_add_resolution_to_models.sql'),
('013_create_workspace_groups_table.sql'),
('014_add_webservice_id_to_models.sql'),
('015_add_notification_preferences.sql'),
('016_drop_buffer_distance_from_models.sql'),
('017_create_technologies_tables.sql'),
('019_create_polygon_limits_table.sql'),
('020_create_result_tables.sql'),
('021_create_pypsa_result_tables.sql'),
('022_create_model_results_table.sql'),
('023_create_energy_planning_tables.sql'),
('024_add_image_to_feedback.sql'),
('025_create_pypsa_settings_table.sql'),
('026_create_cached_regions_table.sql'),
('027_update_pv_defaults_for_tuned_europe_costs.sql'),
('028_add_composite_indexes_for_timeseries.sql'),
('029_add_enabled_to_cached_regions.sql'),
('030_create_pylovo_instances_table.sql'),
('031_add_has3d_to_cached_regions.sql'),
('032_add_modified_status_to_models.sql'),
('033_add_images_array_to_feedback.sql'),
('034_add_state_code_to_cached_regions.sql'),
('035_add_processing_status_to_models.sql'),
('036_create_coordinate_country_cache.sql'),
('037_add_not_null_country_on_models.sql'),
('038_create_outbox_events_table.sql'),
('039_create_api_tokens_table.sql'),
('041_add_model_intro_card_dismissed.sql')
ON CONFLICT (file_name) DO NOTHING;
```

> Note: `011_` and `018_` were never added (skipped numbering), and `040_` does
> not exist — this is why the list jumps. These are the exact files shipped in
> `main`'s `migrations/` dir. If you are unsure, generate the list from the
> **main** checkout rather than hand-typing:
> ```bash
> git -C <main-checkout> ls-tree --name-only main enerplanet/backend/migrations | grep '\.sql$' | sed 's/.*\///' | sed "s/.*/('&'),/" | tr '\n' ' '
> ```

Verify:
```bash
SELECT count(*) FROM schema_migrations;      -- expect 39
SELECT file_name FROM schema_migrations ORDER BY file_name;
```

Run this from a migration-safe path — e.g. `docker exec -i postgres psql -U postgres -d spatialai < bootstrap.sql`, or via the DB tool you already use for prod. **Back up the DB first** (see Step 7 for rollback).

---

## 4. Deploy the new image

Choose one of:

- **Pipeline path (recommended).** Merge/push the branch to `main`, then run
  the production pipeline jobs in order on GitHub (`workflow_dispatch`):
  `build-app` → `deploy-app`. The pipeline builds `enerplanet:latest` from
  source, then `deploy-app` force-recreates `energy-backend-prod`. On the new
  container's *first* start, `/app/start.sh` runs `/app/migrate`, which (thanks
  to Step 3) applies **only 042–052**.

  Because migrations now run on container start, the old explicit `migrate`
  job is optional — you may run it after deploy for a visible log, but the
  entrypoint already did the work.

- **Manual path.** Build and run the image yourself:
  ```bash
  cd /path/to/repo                 # build context MUST be the repo root
  git checkout docker-build-process
  git submodule update --init --recursive
  docker build --no-cache --provenance=false --sbom=false \
    -t enerplanet:latest -f Dockerfile.ci .
  docker compose --env-file "$HOME/deploy/enerplanet/backend/.env.prod" \
    -f docker-compose.deploy.yml up -d --force-recreate energy-backend-prod nginx
  ```

### Env vars for the runtime config

The image is env-agnostic; the browser config comes from `FRONTEND_*` in
`.env.prod`. The pipeline's `deploy-app` job writes `APP_ENV`, `APP_URL`,
`KEYCLOAK_*`, `FRONTEND_CARTO_BASEMAP_API_KEY` (from the
`VITE_CARTO_BASEMAP_API_KEY` secret), connection secrets, and `PYLOVO_SERVICE_URL`
itself. If you deployed manually, confirm `.env.prod` contains at least:

| Env var | Value / source |
|---|---|
| `APP_ENV` | `production` |
| `APP_URL` | `https://enerplanet.th-deg.de` |
| `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` | `spatialhub` / `spatialhub` |
| `FRONTEND_SSO_ENABLED` | `true` (defaults to on when `APP_ENV=production`) |
| `FRONTEND_CARTO_BASEMAP_API_KEY` | your CARTO key (no fallback) |
| `KEYCLOAK_CLIENT_SECRET`, `CALLBACK_SECRET`, `REDIS_PASSWORD` | unchanged from before |
| `PYLOVO_SERVICE_URL` | unchanged from before |

---

## 5. Verify the migration and the app

```bash
# 1. Migrations: expect ONLY 042-052 applied on this boot.
docker logs energy-backend-prod 2>&1 | grep -i migration
#   "Found 50 migration file(s), 39 already applied" / "Applied 11 migration(s)"

# 2. Tracking table now holds all 50.
docker exec postgres psql -U postgres -d spatialai \
  -c "SELECT count(*) FROM schema_migrations;"          # 50
docker exec postgres psql -U postgres -d spatialai \
  -c "SELECT file_name FROM schema_migrations WHERE file_name LIKE '04_%' OR file_name LIKE '05_%' ORDER BY file_name;"

# 3. Runtime config endpoint.
curl -sS https://enerplanet.th-deg.de/config.js | head -c 200
#   window.__ENERPLANET_CONFIG__ = {"sso":{"enabled":true,...}}  <- sso ON in prod

# 4. Health + embedded frontend resolves the runtime config.
curl -sS -o /dev/null -w "%{http_code}\n" https://enerplanet.th-deg.de/health      # 200
curl -sS https://enerplanet.th-deg.de/ | grep -o 'src="/config.js"'                # present

# 5. App boots and the container stays healthy (no crash-loop from a migration).
docker ps --filter name=energy-backend-prod --format '{{.Names}} {{.Status}}'
```

If the first container start **failed** on a migration, the entrypoint aborts
startup by design (better than serving a stale schema). Read the error, fix or
back it out (Step 7), and restart — the runner retries only un-recorded files.

---

## 6. Smoke-test the feature surface the new branch adds

Exercise through the UI/logs, since most of the net-new schema sits behind
heat/pypsa/buildings:

- Create a model and run it through analyse/pypsa — confirm the run completes and results render (no `results_*` / series lookup errors in backend logs).
- Building configurator: pick a building, open the building panel, choose heat/PV — confirms `044`/`049`/`050` data is usable.
- Feedback: report a failed run — confirms `051`/`052` tables.
- Check backend logs for `relation does not exist` or `column ... does not exist` — that means a migration did not land before the code assumed it.

---

## 7. Rollback

The image and the migrations are separable, so back out in reverse:

1. **Keep the database** — the extra columns/tables from `042–052` are additive
   and harmless to the old code, and **drop nothing** (never delete inside a
   migration; new tables are used by the new feature code that old code won't
   touch).
2. **Revert the code:** rebuild the old image and recreate the container:
   ```bash
   git checkout main
   docker compose --env-file backend/.env.prod -f docker-compose.deploy.yml \
     up -d --force-recreate energy-backend-prod
   # or re-run build-app + deploy-app with main checked out in the pipeline source
   ```
3. **The `schema_migrations` table may stay.** Old code never reads it. If you
   need it gone before re-running this migration later, it is safe to drop
   because prod's real schema predates it:
   ```sql
   DROP TABLE IF EXISTS schema_migrations;
   ```
4. Before rollback, **take a Postgres dump** of the affected tables
   (`pg_dump -d spatialai`) so nothing from a partial state is lost.

---

## 8. Validation checklist (final)

- [ ] `schema_migrations` existed with the 39 historic files **before** first new boot
- [ ] First new container log shows `Applied 11, skipped 39` (only 042–052 ran)
- [ ] `schema_migrations` row count == 50 after boot
- [ ] `https://enerplanet.th-deg.de/config.js` serves config with `sso.enabled: true`
- [ ] `/health` returns 200
- [ ] `energy-backend-prod` is `Up (healthy)` — no crash-loop
- [ ] A model run completes and results render (heat/pypsa exercised)
- [ ] Building panel PV/heat selection works; feedback report works
- [ ] Backend logs free of `relation/column does not exist`