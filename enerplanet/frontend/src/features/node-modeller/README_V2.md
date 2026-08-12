# Node Modeller — V2 Specification

Revision of [`README.md`](README.md). Same 7-aspect structure, but **Aspect 1 (Unified Context) is the mandatory foundation** everything else is built on. All backend calls are mapped to the existing API in [`enerplanet/backend/cmd/main.go`](../../../backend/cmd/main.go).

**Design rule:** every node reads from the context and writes back to the context. No node owns data. The context is the only state.

---

## Aspect 1: The Context (MANDATORY — foundation of everything)

The context is a **single, serializable, versioned object** that holds the complete state of the model being worked on. It replaces the configurator's fragmented state (React state + OpenLayers features + React Query cache + Zustand stores).

### 1.1 Shape

```ts
interface ModelContext {
  // ── Identity & versioning ─────────────────────────────────────────────
  schemaVersion: 1; // context schema version (migrations)
  revision: number; // monotonic counter, bumped on every change
  id?: number; // backend model id (null until first save)
  parentId?: number; // branch origin (Aspect 5)
  status: "draft" | "modified" | "running" | "completed" | "failed";

  // ── Data slices (each produced/consumed by workflow nodes) ───────────
  meta: ModelMeta; // title, description, from_date, to_date, resolution, workspace_id
  region: RegionSlice; // polygons + boundary, saved as model.coordinates
  grid: GridSlice; // buildings, lines, mv_lines, transformers, grids
  demand: DemandSlice; // per-building demand + timeseries refs
  techAssignments: TechSlice; // technologies per building + constraints
  pypsa: PypsaSlice; // advanced simulation parameters
  results?: ResultsSlice; // run results + compare data (Aspect 5)
  userData: UserDataSlice; // user timeseries + custom locations (Aspect 4)

  // ── History (Aspect 5) ────────────────────────────────────────────────
  history: HistoryEntry[]; // immutable, ordered change log
  undoStack: ContextDiff[];
  redoStack: ContextDiff[];
}
```

### 1.2 Mutations — the only way to change the context

All writes go through one reducer-style API. Every mutation produces a **reversible diff** and is appended to history. Undo/redo/traceability fall out for free (Aspect 5).

```ts
// Every action is { type, payload } and returns { next, diff }.
type ContextAction =
  | { type: "set-meta"; payload: Partial<ModelMeta> }
  | { type: "set-region"; payload: RegionSlice }
  | { type: "set-grid"; payload: GridSlice }
  | { type: "update-building"; payload: { osmId: string; patch: BuildingPatch } }
  | { type: "assign-tech"; payload: { osmIds: string[]; techId: string; params?: TechParams } }
  | { type: "remove-tech"; payload: { osmIds: string[]; techId: string } }
  | { type: "set-demand"; payload: { buildingId: string; fClass: string; yearlyKwh: number } }
  | { type: "set-pypsa"; payload: Partial<PypsaSlice> }
  | { type: "set-results"; payload: ResultsSlice }
  | { type: "add-timeseries"; payload: UserTimeseriesRef }
  | { type: "remove-timeseries"; payload: { id: string } }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load-snapshot"; payload: ModelContext }; // branch/restore

type ContextDiff =
  | { op: "replace"; path: string; prev: unknown; next: unknown } // JSON Pointer paths
  | { op: "remove"; path: string; prev: unknown };
```

Rules:

1. **Immutable** — `apply(action)` deep-clones the affected slice. OpenLayers features are never mutated directly; map edits produce `update-building` actions.
2. **Serializable** — the whole context is `JSON.stringify`-able. This is what maps onto `POST/PUT /api/models` payloads and what makes isolated testing (Aspect 7) trivial.
3. **Contract-driven** — each slice has a `contextContract` declaring what it requires/provides. The workflow engine (Aspect 3) validates links against these contracts.

### 1.3 Persistence mapping (backend API)

The context is persisted in two layers:

| Context slice                        | Backend call                                                                                                                                                                                                            | Notes                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `meta` + `region` + `grid` + `pypsa` | `POST /api/models` / `PUT /api/models/:id`                                                                                                                                                                              | assembled like today's `saveAreaData`, but from the context instead of scattered state |
| `results`                            | `GET /api/models/:id/results`, `GET /api/models/:id/results/pypsa`, `GET /api/models/:id/results/carrier-timeseries`, `GET /api/models/:id/results/system-timeseries`, `GET /api/models/:id/results/location/:location` | read-only, written into `results` slice                                                |
| `userData` (timeseries)              | **new backend endpoints required** (see Aspect 4)                                                                                                                                                                       | object store                                                                           |
| `userData` (custom locations)        | `GET/POST /api/locations`, `GET /api/locations/geojson`                                                                                                                                                                 |                                                                                        |

**New-model flow:** user starts with an empty context (`schemaVersion: 1, revision: 0`). The first save creates the model via `POST /api/models` and sets `context.id`. `user-placed transformers` keep working via the existing `draft_id` → `POST /api/v2/pylovo/finalize-transformers` handshake.

**Edit flow:** loading `/app/model-dashboard/edit/:id` hydrates the context from `GET /api/models/:id` (`meta`, `region`, `grid`, `pypsa`) — no more re-deriving state from map features at save time.

---

## Aspect 2: The Workflow

### 2.1 Default workflow

Same base as V1, now concrete about inputs/outputs and backend calls:

```
A (Model Settings) → B (Area + Grid) → C (Demand) → D (Technologies) → E (Run) → F (Results)
```

| Node                           | Input (from context)                                           | Output (to context)                                                    | Backend call                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A: Model Settings**          | —                                                              | `meta` (title, description, from_date, to_date, resolution)            | none (local)                                                                                                                           |
| **B: Area Selection + Grid**   | `meta` (dates), user locations                                 | `region` (polygons, boundary), `grid` (buildings, lines, transformers) | `POST /api/v2/pylovo/generate-grid`, `GET /api/v2/pylovo/transformer-sizes`, `GET /api/locations`                                      |
| **C: Demand Heat/Electricity** | `grid.buildings`                                               | `demand` (per-building yearly kWh, peak kW, f_class)                   | `POST /api/v2/pylovo/estimate-energy-batch` (electric); heat optional, later                                                           |
| **D: Technologies**            | `grid.buildings`, `demand`                                     | `techAssignments` (tech + constraints per building)                    | `GET /api/technologies`, `PUT /api/technologies/:id/constraints`                                                                       |
| **E: Run Model**               | `meta`, `region`, `grid`, `demand`, `techAssignments`, `pypsa` | `status: 'running'`                                                    | `POST /api/calculation/start/:id`                                                                                                      |
| **F: View Results**            | `id`, `status`                                                 | `results`                                                              | `GET /api/models/:id/results/pypsa`, `GET /api/models/:id/results/carrier-timeseries`, `GET /api/models/:id/results/system-timeseries` |

Node **B** additionally exposes the pre-computation step from the current configurator: grid statistics via `POST /api/v2/pylovo/grid-statistics` and power-flow sanity via `POST /api/v2/pylovo/power-flow` (shown as a live badge, like today's `GridStatsBadge`).

### 2.2 Technology sub-loop (node D)

Node D is a **mini-workflow** with a loop, executed on the map:

```
Select building(s) → list available techs (GET /api/technologies) → assign + configure → user satisfied? → next
```

Configuration writes per-building constraints through the same context action (`assign-tech`), so every assignment is undoable and traceable. "Apply to all" (`onAddTechToAll`) is the same action with `osmIds` = all building ids.

### 2.3 Optimization workflow

After F, the user can enter the optimization workflow (start node = **Context Load Node**):

1. Load existing context (Aspect 5 branch or existing model via `GET /api/models/:id`).
2. Goals (self-reliance / renewables+CO₂ / cheapest) are stored as `meta.optimizationGoal`.
3. Node **B/C/D re-run** — but with the model already in the context, only changed slices are recomputed (`grid` is reused, `demand` re-estimated only for affected buildings).
4. Run again (`POST /api/calculation/start/:id`), fetch results, and **compare** using the `results` slice (previous run stored, next run appended). Key indicators (cost, CO₂, self-sufficiency delta) are computed from `carrier-timeseries` + `results/pypsa`.

### 2.4 Post-results decision nodes (F's exits)

| Exit             | Behaviour                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Optimize**     | enter optimization workflow (2.3)                                                                                                |
| **New Model**    | reset context to empty (`load-snapshot` of a blank context), keep workspace                                                      |
| **Branch Model** | snapshot context → `load-snapshot` into a new context with `parentId = current.id`, `id = undefined` → rerun workflow (Aspect 5) |

---

## Aspect 3: Node-based workflow builder & management (admin)

Same goals as V1, but **the contract system from Aspect 1.2 makes it implementable**: nodes declare `requires`/`provides` slices, and link validation is a contract check, not magic.

### 3.1 Workflow definition format

Workflows are **data** first (JSON), a visual React Flow editor later:

```json
{
  "id": "default-planning",
  "version": 1,
  "start": "context-load | null",
  "nodes": [
    {
      "id": "model-settings",
      "type": "module:model-settings",
      "requires": [],
      "provides": ["meta"]
    },
    {
      "id": "area-grid",
      "type": "module:area-grid",
      "requires": ["meta"],
      "provides": ["region", "grid"]
    }
  ]
}
```

Admin UI (React Flow) edits this JSON. A node is **connectable only if** its `requires` ⊆ accumulated `provides` of upstream nodes. A workflow is **runnable only if** its graph is a valid DAG (loops allowed only via explicit cycle markers for sub-workflows like 2.2).

### 3.2 Publishing & RBAC

- **New backend table** `workflows` (id, definition JSON, status `draft | published | archived`, created_by).
- `GET/POST/PUT/DELETE /api/workflows` — admin only (role check, same pattern as existing admin routes).
- Users only ever see `status: published` workflows (served via `GET /api/workflows?status=published`).
- Internal testing: admins run draft workflows against their own workspace before publishing.

### 3.3 Start nodes

Only `null` (blank context) and `context-load` (hydrate from an existing model id via `GET /api/models/:id`) are valid starts — matching V1, now backed by a concrete hydration path.

### 3.4 Auto-fill of dependencies

When a `context-load` start is used and the loaded context lacks a slice a downstream node requires, the engine inserts the minimal chain of nodes to produce it (e.g. missing `grid` → insert `area-grid` re-run). This is deterministic because contracts are explicit.

---

## Aspect 4: User Datasets (Timeseries)

V1 concept kept, now with a concrete storage/API design.

### 4.1 Data model & endpoints (new backend work)

```
GET  /api/timeseries                      → list user's timeseries
POST /api/timeseries                      → upload (CSV, OpenAPI-style, or EIA format)
GET  /api/timeseries/:id                  → metadata + preview
PUT  /api/timeseries/:id                  → replace data
DELETE /api/timeseries/:id                → remove on demand
POST /api/timeseries/validate             → dry-run validation before upload
```

Stored in a **time-series store** (TimescaleDB or Postgres + columnar) — not a generic object store, because demand/production data is time-indexed and gets queried per building per step.

### 4.2 How the context uses it

```ts
interface UserTimeseriesRef {
  id: string; // backend timeseries id
  name: string;
  kind: "demand" | "production";
  unit: "kWh" | "kW" | "MW";
  resolution: "hourly" | "quarter-hourly";
  scope: "all-buildings" | "building" | "region";
  buildingId?: string; // when scope = building
  validFrom?: string;
  validTo?: string;
}
```

- References live in `userData.timeseries`; the heavy data stays in the store.
- Node **C (Demand)** checks `userData.timeseries` first: if a matching timeseries exists for a building, it is used; otherwise fall back to `POST /api/v2/pylovo/estimate-energy-batch` (the current AI estimates serve as the "default data").
- Node **D (Technologies)** uses `kind: 'production'` timeseries the same way (e.g. a measured solar profile overrides the module default).
- Deletion (`DELETE /api/timeseries/:id`) also removes the ref from any context that references it; those buildings fall back to defaults on next run.

---

## Aspect 5: History

V1 concept kept, and now **nearly free** because of Aspect 1.2.

### 5.1 Diff-based history

Every `apply(action)` appends to `context.history`:

```ts
interface HistoryEntry {
  revision: number; // context.revision at the time
  timestamp: string;
  nodeId?: string; // which workflow node made the change
  actionType: string; // e.g. 'assign-tech'
  diff: ContextDiff[]; // reversible
  runSnapshot?: {
    // filled when this revision preceded a model run
    runId: number;
    startedAt: string;
  };
}
```

- **Undo / Redo**: pop `undoStack`/`redoStack`, invert the diffs. O(1) per step, no network.
- **Traceability**: the history is the audit trail — every change is attributable to a node and a time.
- **Run comparison**: any revision with a `runSnapshot` links to its results. "Compare runs" = diff the `results` slices of two run revisions (key indicators from `carrier-timeseries` + `results/pypsa`).

### 5.2 Branching

- **Branch from a history entry**: snapshot the context at that revision (apply all diffs up to it) → create a new context with `parentId = current.id`, `id = undefined`, full `history` copied → the new model persists via `POST /api/models` (existing `parent_model_id` + `is_copy` fields in the models table support the lineage).
- **Branch awareness**: `parentId` is stored in the model; a branch icon in the history panel links to the source model (`GET /api/models/:id`). Green = origin, red = branches (list of children via `GET /api/models?parent_model_id=:id`).
- **Guardrail**: branching does not copy `results` (a branch re-runs); it copies `meta`, `region`, `grid`, `demand`, `techAssignments`, `pypsa`, `userData` refs, and `history`.

### 5.3 Storage

History is persisted **client-side in the context** and compacted on save: the persisted model keeps only the latest slice values (as today), while the full history is stored as an attachment (`context.history`) on the model or in a separate `model_revisions` table (backend addition). Long-term: event-sourced `model_events` table if per-revision server-side history becomes a requirement.

---

## Aspect 6: UI/UX and cognitive load

Same goal as V1 — lightweight for experts and non-experts — plus the two fixes from the configurator review.

### 6.1 Progressive disclosure per node

Each node renders only what it needs:

- **Defaults**: every slice gets a `defaults` definition (`getDefaultMeta()`, `getDefaultPypsa()` …). Non-expert users never touch advanced options; the Advanced Parameters drawer (ported from the configurator's `AdvancedParametersDrawer`) is collapsed by default inside node A.
- **Node-local help**: each node ships its own 3-line "what am I doing" explainer, aimed at non-experts, expandable to full docs.
- **Context-aware**: a node that is a no-op (nothing changed since last run) shows a "no changes — skip?" hint instead of full UI.

### 6.2 Fixes vs. the configurator

1. **No modal sprawl** — the configurator stacks `BuildingDialog` → `TechParameterDialog` → `TransformerDialog`. V2 uses a single context-driven side panel: click a feature → panel lists its editable slices (building/demand/techs/transformer), one level deep.
2. **Undo feedback** — because undo is free (5.1), expose it persistently in a small floating "history" chip (Undo / Redo / last-change description) instead of an unsaved-changes banner only.

### 6.3 Responsive

Energy modelling on smaller screens: nodes become full-screen steps (no side-by-side map+panel below a width breakpoint), matching the workflow's inherent step structure.

---

## Aspect 7: Clear cutoff & isolated testing

V1 goal kept, now achievable because of the context boundary.

### 7.1 Module contract (the cutoff)

Each module = **pure functions over the context + an adapter for backend calls**:

```ts
interface NodeModule<Cfg = unknown> {
  id: string;
  requires: SliceKey[]; // context slices needed
  provides: SliceKey[]; // context slices written
  validate(ctx: ModelContext): ValidationResult; // pure
  run(ctx: ModelContext, api: BackendAdapter, cfg: Cfg): Promise<ModelContext>;
}
```

`BackendAdapter` is an interface (`generateGrid`, `estimateDemand`, `startCalculation`, `getResults`, …). Tests inject a mock adapter; the app injects the real one bound to the routes in `main.go`. This is the dependency-inversion layer the configurator lacks.

### 7.2 Vitest coverage

- **Reducer tests** (pure, no DOM): every `ContextAction` → expected diff + undo round-trip. This is the highest-value suite and trivially testable.
- **Module tests**: mock `BackendAdapter`, assert `ctx` after `run()` for success/failure paths.
- **Workflow tests**: a workflow definition + mock adapter → assert node order, contract violations block links, dependency auto-fill works.
- **Component tests**: map interactions render as the right context actions.

### 7.3 Isolation mode

Running outside the full app (embedding, or the "external component" use case from V1):

- `BackendAdapter` is swapped for a **local adapter** that persists to disk: `save` → downloads a `.enerplanet.json` (the full serialized context — trivial, because the context _is_ the payload); model list → a local folder index; results → local files.
- No auth, no workspace, no network — same as the V1 "local paths" idea, but backed by the serializable context instead of ad-hoc emulation.

---

## Appendix: Context → backend route map (reference)

| Context slice                               | Backend route                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`, `region`, `grid`, `pypsa` (persist) | `POST /api/models`, `PUT /api/models/:id`                                                                                                                                                                                                               |
| `meta`, `region`, `grid`, `pypsa` (hydrate) | `GET /api/models/:id`                                                                                                                                                                                                                                   |
| `grid` (generate)                           | `POST /api/v2/pylovo/generate-grid`                                                                                                                                                                                                                     |
| `grid` (transformers)                       | `GET /api/v2/pylovo/transformer-sizes`, `POST /api/v2/pylovo/add-transformer`, `POST /api/v2/pylovo/delete-transformer`, `POST /api/v2/pylovo/move-transformer`, `POST /api/v2/pylovo/assign-building`, `POST /api/v2/pylovo/finalize-transformers`     |
| `grid` (statistics/power)                   | `POST /api/v2/pylovo/grid-statistics`, `POST /api/v2/pylovo/power-flow`                                                                                                                                                                                 |
| `demand`                                    | `POST /api/v2/pylovo/estimate-energy`, `POST /api/v2/pylovo/estimate-energy-batch`                                                                                                                                                                      |
| `techAssignments`                           | `GET /api/technologies`, `PUT /api/technologies/:id/constraints`                                                                                                                                                                                        |
| `region` (boundary)                         | `GET /api/v2/pylovo/boundary`, `GET /api/v2/pylovo/boundary/available` (public)                                                                                                                                                                         |
| `userData` (locations)                      | `GET /api/locations`, `GET /api/locations/geojson`, `POST /api/locations`                                                                                                                                                                               |
| `status` (run)                              | `POST /api/calculation/start/:id`                                                                                                                                                                                                                       |
| `results`                                   | `GET /api/models/:id/results`, `GET /api/models/:id/results/pypsa`, `GET /api/models/:id/results/carrier-timeseries`, `GET /api/models/:id/results/system-timeseries`, `GET /api/models/:id/results/location/:location`, `GET /api/models/:id/download` |
| `meta` (weather, future node)               | `GET /api/weather/current`                                                                                                                                                                                                                              |

**New backend endpoints required** (not in `main.go` yet): timeseries CRUD + validate (Aspect 4), workflows CRUD + publish (Aspect 3), optional `model_revisions` storage (Aspect 5).

---

## Implementation order (dependency-driven)

1. **Context core** (Aspect 1): types, reducer, diffs, undo/redo, serialization. Pure TS, no UI. → unlocks everything else.
2. **Reducer + module test harness** (Aspect 7) alongside step 1.
3. **Workflow engine** (Aspect 2): node registry, contract validation, execution, dependency auto-fill. Workflows as JSON first.
4. **Port the configurator's map/grid/tech UI into modules** (A/B/C/D), replacing state-mutation with context actions.
5. **Run + results modules** (E/F) via existing calculation routes.
6. **History UI + branching** (Aspect 5) — cheap once 1–3 exist.
7. **Admin workflow builder** (Aspect 3): JSON editor → React Flow editor + publish/RBAC.
8. **User timeseries** (Aspect 4): backend endpoints first, then node C/D integration.
9. **Isolation mode** (Aspect 7) last — swap the adapter, ship the download/load path.
