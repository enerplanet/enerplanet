# Backend Requirements — Node Modeller (living document)

Required new APIs / changes for features whose frontend adapter methods are currently **stubs**. Update this document as work progresses.

**Existing API reference:** all current endpoints are defined in [`enerplanet/backend/cmd/main.go`](../../../backend/cmd/main.go).

**Current DB:** PostgreSQL with PostGIS + pgRouting. **No object database exists.** All proposals below assume Postgres (JSONB / new tables / TimescaleDB optional).

---

## 1. User Timeseries (Aspect 4)

Frontend: `adapter.timeseries.*` (stubbed → returns `not supported`).

**Storage:** Postgres. Metadata table + data table (time-indexed rows). TimescaleDB hypertable optional optimization later — plain Postgres + composite index is sufficient to start.

```sql
CREATE TABLE user_timeseries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('demand','production')),
  unit        text NOT NULL CHECK (unit IN ('kWh','kW','MW')),
  resolution  text NOT NULL CHECK (resolution IN ('hourly','quarter-hourly')),
  valid_from  timestamptz,
  valid_to    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_timeseries_data (
  timeseries_id uuid NOT NULL REFERENCES user_timeseries(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  value         double precision NOT NULL,
  PRIMARY KEY (timeseries_id, ts)
);
CREATE INDEX ON user_timeseries_data (timeseries_id, ts);
```

**Endpoints (new):**

| Method | Route                                | Purpose                                                 |
| ------ | ------------------------------------ | ------------------------------------------------------- |
| GET    | `/api/timeseries`                    | list current user's timeseries (metadata only)          |
| POST   | `/api/timeseries`                    | upload (CSV body or JSON rows); creates metadata + data |
| GET    | `/api/timeseries/:id`                | metadata + preview (first N rows)                       |
| GET    | `/api/timeseries/:id/data?from=&to=` | full data range for run compilation                     |
| PUT    | `/api/timeseries/:id`                | replace data                                            |
| DELETE | `/api/timeseries/:id`                | delete on demand (cascades to data)                     |
| POST   | `/api/timeseries/validate`           | dry-run validation, returns row errors                  |

**Semantics:** context stores only references (`userData.timeseries`). Deletion removes the ref on the client; buildings fall back to `POST /api/v2/pylovo/estimate-energy-batch` defaults.

## 2. Workflows (Aspect 3)

Frontend: `adapter.workflows.*` (stubbed). Hardcoded JSON workflows ship in the frontend until this lands.

**Storage:** one Postgres table, definition as JSONB.

```sql
CREATE TABLE workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  version     int NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  definition  jsonb NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

**Endpoints (new):**

| Method | Route                        | Access                                     |
| ------ | ---------------------------- | ------------------------------------------ |
| GET    | `/api/workflows?status=`     | published → all users; drafts → admin only |
| POST   | `/api/workflows`             | admin                                      |
| PUT    | `/api/workflows/:id`         | admin                                      |
| DELETE | `/api/workflows/:id`         | admin                                      |
| POST   | `/api/workflows/:id/publish` | admin (draft → published)                  |

**RBAC:** reuse existing admin role check pattern already used for admin routes in `main.go`.

## 3. Model History / Revisions (Aspect 5, optional)

Frontend works fully client-side (history lives in the context, compacted on save). Server-side storage only needed if per-revision history must survive devices/browsers.

**Option A (minimal):** add `history jsonb` column to existing `models` table — stores the compacted history with the model.

**Option B (full):** `model_revisions` table (model_id, revision, diff jsonb, created_at, node_id, action_type) — event-sourced, enables server-side branch/restore.

**Branch lineage:** already supported — `models.parent_model_id` + `is_copy` exist (see `duplicateModel` flow). No change required.

---

## Status legend

- ⬜ not started · 🟡 frontend stubbed, backend missing · ✅ done

| Feature                  | Backend state                           | Frontend adapter                     |
| ------------------------ | --------------------------------------- | ------------------------------------ |
| Timeseries CRUD          | ⬜                                      | stubbed                              |
| Workflows CRUD + publish | ⬜                                      | stubbed (hardcoded workflows in use) |
| Model history storage    | ⬜ (optional)                           | client-side only (works)             |
| Branch lineage           | ✅ (`parent_model_id`, `is_copy` exist) | —                                    |
