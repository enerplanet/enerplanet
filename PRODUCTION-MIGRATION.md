# Production migration: `main` → `docker-build-process`

Runbook for moving the production server (currently at the state of the
`main` branch) to the state of the `docker-build-process` branch. Read it
end-to-end before starting; the single most important step is **Step 3**
(bootstrap the migration tracking table), because it prevents the new migration
runner from re-applying every historic migration on first boot.

> **Refreshed after the branch was rebased onto `dev`.** `docker-build-process`
> now sits on top of `dev` (which is 320 commits ahead of `main`), not on the
> old pre-`dev` base this doc was first written against. Two things moved with
> that: the branch's *net-new* schema is now `053`–`063` (`042`–`052` are
> already in `main`), and the branch carries the whole accumulated `dev` feature
> line, not just the old PR #310 set. The counts and file lists below reflect
> the merged tree.

---

## 1. What changes

| Area | On `main` | On `docker-build-process` |
|---|---|---|
| App image | built on the server by the deploy pipeline (`Dockerfile.ci`) | same shape, now **env-agnostic** — frontend reads `/config.js` at runtime, no build args baked |
| DB migrations | old runner applied *every* `*.sql` on every run, no tracking | new runner (**`cmd/migrate`**) records each applied file in a `schema_migrations` table, skips recorded files, supports `--rerun` |
| Migration trigger | explicit `migrate` job in the pipeline | **also** on every container start — the entrypoint (`/app/start.sh`) runs `/app/migrate` before `/app/server` unless `RUN_MIGRATIONS_ON_START=false` |
| Migration set | 50 files (`001`–`052`) | 62 files — adds **`053`–`063`** (12 files, see the row below) |
| New schema (net-new migrations on this branch) | — | `053` postcodes on cached regions · `054` buildings status on models · `055` grid electricity prices · `056` use_type on demand profiles · `057` split grid price sources · `058` grid prices for CZ/NL · `059` extracted path on meme runs **+** `059` enable PostGIS · `060` incomplete status · `061` model sessions · `062` workflows · `063` workflow description/subflow |
| Frontend config | baked at build time | served to the browser at `/config.js` from `FRONTEND_*` env vars (radarr-style) |

The branch also carries the accumulated feature work merged in from `dev`
(grid generation, the Model Builder / workflow tables `062`/`063`, the MEME
result path, heat/demand profiles, feedback) — those are code, not ops steps.
The ops-relevant deltas are the three bullet rows above.

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

### Determine what prod has actually applied (decides the Step 3 list)

`main` has advanced since this doc was written: it used to ship 39 files
(`001`–`041`), it now ships 50 (`001`–`052`). Step 3 must record exactly the
files **prod's DB already has**, which is whatever revision prod was deployed
from — *not* blindly "current main". Probe the newest tables:

```bash
docker exec postgres psql -U postgres -d spatialai -c "
SELECT to_regclass('public.feedback_seen')            AS has_052,
       to_regclass('public.series')                   AS has_049,
       to_regclass('public.building_heat_profiles')   AS has_042_044,
       to_regclass('public.cached_regions')           AS has_026;"
```

- All four present → prod is at current `main`; bootstrap all 50 (Step 3 as written).
- `has_026` yes but `has_042_044` null → prod is **older than `main`**; bootstrap
  only the files it actually has (generate the list from the revision prod was
  built from), or the runner will silently skip `042`–`052` and the app will hit
  missing tables.
- `has_026` null → prod predates cached regions; stop and reconcile before proceeding.

Confirm `~/.github` runners and the `deploy/` directory reachable:
```bash
ls -la "$HOME/deploy/enerplanet" "$HOME/deploy/platform-core/.env"
```

---

## 3. Bootstrap the `schema_migrations` table (critical)

The new runner only re-executes migration files that are **not** recorded in
`schema_migrations`. Your production DB was built by the old runner, which
never recorded anything, so on first boot the new runner would try to re-apply
**every file it finds** — the 50 historic ones (`001`–`052`, i.e. current
`main`; `011`/`018`/`040` never existed, hence the gaps) plus the 12 new ones
(`053`–`063`). The historic files are guarded and mostly idempotent, but that is
not a bet you want to take against a live database at once on container start.

Do this **once, before** deploying the new image, against the running Postgres
— recording the files prod has already applied (per the Step 2 probe):

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
('041_add_model_intro_card_dismissed.sql'),
('042_create_building_heat_profiles_table.sql'),
('043_add_building_type_to_building_heat_profiles.sql'),
('044_rename_building_heat_profiles_to_demand_profiles.sql'),
('045_create_model_city2tabula_runs_table.sql'),
('046_create_model_meme_runs_table.sql'),
('047_add_model_result_source.sql'),
('048_add_leg_to_model_meme_runs.sql'),
('049_create_series_tables.sql'),
('050_add_technology_product_fields.sql'),
('051_create_feedback_run_reports.sql'),
('052_create_feedback_seen.sql')
ON CONFLICT (file_name) DO NOTHING;
```

> Note: `011_` and `018_` were never added (skipped numbering), and `040_` does
> not exist — this is why the list jumps. These are the exact files shipped in
> `main`'s `migrations/` dir **as of the refresh**; if you are unsure, generate
> the list from the `main` checkout rather than hand-typing:
> ```bash
> git -C <main-checkout> ls-tree -r --name-only main enerplanet/backend/migrations | grep '\.sql$' | sed 's#.*/##' | sed "s/.*/('&'),/" | tr '\n' ' '
> ```
> …and reconcile it with the Step 2 probe: bootstrap only what prod has applied.

Verify:
```bash
SELECT count(*) FROM schema_migrations;      -- expect 50 (prod at current main)
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
  to Step 3) applies **only 053–063**.

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
`KEYCLOAK_*`, connection secrets, and `PYLOVO_SERVICE_URL` itself. If you
deployed manually, confirm `.env.prod` contains at least:

| Env var | Value / source |
|---|---|
| `APP_ENV` | `production` |
| `APP_URL` | `https://enerplanet.th-deg.de` |
| `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` | `spatialhub` / `spatialhub` |
| `FRONTEND_SSO_ENABLED` | `true` (defaults to on when `APP_ENV=production`) |
| `KEYCLOAK_CLIENT_SECRET`, `CALLBACK_SECRET`, `REDIS_PASSWORD` | unchanged from before |
| `PYLOVO_SERVICE_URL` | unchanged from before |

> **`FRONTEND_CARTO_BASEMAP_API_KEY` is now inert.** `dev` dropped the CARTO
> dark base map (the OSM + 3D views remain), so nothing reads the key any more.
> The pipeline still writes it from the `VITE_CARTO_BASEMAP_API_KEY` secret and
> the runtime-config field still exists, but it is dead wiring — leave it unset
> and it changes nothing.

---

## 5. Verify the migration and the app

```bash
# 1. Migrations: expect ONLY 053-063 applied on this boot.
docker logs energy-backend-prod 2>&1 | grep -i migration
#   "Found 62 migration file(s), 50 already applied" / "Applied 12 migration(s), skipped 50 already-applied"

# 2. Tracking table now holds all 62.
docker exec postgres psql -U postgres -d spatialai \
  -c "SELECT count(*) FROM schema_migrations;"          # 62
docker exec postgres psql -U postgres -d spatialai \
  -c "SELECT file_name FROM schema_migrations WHERE file_name LIKE '05_%' OR file_name LIKE '06_%' ORDER BY file_name;"

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

> One migration worth knowing: `059_enable_postgis.sql` runs
> `CREATE EXTENSION IF NOT EXISTS postgis`. Prod's Postgres is
> `pgrouting/pgrouting:17-3.5-3.7.3`, which ships PostGIS, so this is a no-op —
> but if you ever swap that image for a plain `postgres`, this file (and the
> grid/region queries) will fail. Confirm with
> `docker exec postgres psql -U postgres -d spatialai -c "SELECT postgis_version();"`.

---

## 6. Smoke-test the feature surface the new branch adds

Exercise through the UI/logs, since most of the net-new schema sits behind
Model Builder, grid generation and heat/meme:

- **Model Builder / workflows** — open the Model Builder and confirm the default
  workflow loads (exercises `062`/`063`; a failure reads as a missing
  `workflows` relation in backend logs).
- Create a model and run it through analyse/pypsa — confirm the run completes and results render (no `results_*` / series lookup errors in backend logs).
- **Grid generation** — generate the grid on a region and confirm it completes; grid electricity prices come from `055`/`057`/`058` (a missing row for a country falls back to the `other` row).
- Building configurator: pick a building, open the building panel, choose heat/PV — confirms `044`/`049`/`050`/`056` data is usable.
- Feedback: report a failed run — confirms `051`/`052` tables.
- Check backend logs for `relation does not exist` or `column ... does not exist` — that means a migration did not land before the code assumed it.

---

## 7. Rollback

The image and the migrations are separable, so back out in reverse:

1. **Keep the database** — the extra columns/tables from `053`–`063` are additive
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

- [ ] `schema_migrations` existed with the 50 historic files **before** first new boot
- [ ] First new container log shows `Applied 12, skipped 50` (only 053–063 ran)
- [ ] `schema_migrations` row count == 62 after boot
- [ ] `https://enerplanet.th-deg.de/config.js` serves config with `sso.enabled: true`
- [ ] `/health` returns 200
- [ ] `energy-backend-prod` is `Up (healthy)` — no crash-loop
- [ ] Model Builder loads its default workflow (`062`/`063`)
- [ ] A model run completes and results render (heat/pypsa exercised)
- [ ] Grid generation completes; building panel PV/heat selection works; feedback report works
- [ ] Backend logs free of `relation/column does not exist`
