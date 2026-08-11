# Modular Workflow — Flow Document

> Living document capturing the flow of the model builder, rebuilt as a
> **node network** of composable modules in the new modular-workflow system.

---

## Important

The flow is **not** a linear sequence. The core idea is that modules can be
**mixed and matched** — not every workflow needs every step.

The system is a **node network**: each node's input is derived from the shared
`ConfiguratorContext`. A node can only load when the context is **valid for it**
(context-validity gating). If the context is not yet valid, the node cannot be
linked to / run after its predecessors.

This is implemented by:

- **`WorkflowNode`** — each node declares a stable `id`, a `moduleId`, and an
  explicit `dependsOn` list (the IDs of nodes that must complete first).
- **`NodeEngine`** — the graph-based playback controller. A node loads only when
  all its `dependsOn` are `done` **and** its module's `io.required` keys exist in
  the context. `auto` nodes run automatically as soon as they become ready.
- **Persistence / resume** — the flow state is preserved in `localStorage` and
  offered for resume, so a flow is not discarded when the user leaves, loses
  connection, or exits while waiting on a long model run.

## Component Reuse from configurator basis of this new component

Generally Services can be used:
enerplanet/frontend/src/features/configurator/services

UI Should be refactored to fit the scope of the module task and the UI we envision, which is more step by step focussed to minimize cognitive overhead.

The goal is that each module can be easily modified and specifically also tested in isolation.

Generally the goal is to reproduce the same results as the configurator when pressing the save button in a normal full flow.

---

## Current Overall full Flow (High-Level)

The flow is **optimization oriented**: model creation is a starter flow, and
specific alternative flows exist for optimizing the results to reach an optimal
model. Model calculation is possible within the flow, and a flow's state is
**not discarded** once the user leaves the flow.

For example: the user loses connection — flow state is preserved. The user exits
while waiting for a model run step — flow state is preserved and the user is
notified once the model finishes calculating.

The full flow is a **node network**, not a fixed pipeline. The canonical
"full energy planning" path looks like this (each box is a node; arrows are
`dependsOn` edges):

```
[simulation-settings]  [region-select]
        │                    │
        └────────┬───────────┘
                 ▼
        [grid-generation]  (auto — depends on region-select)
                 │
        ┌────────┼───────────────┬──────────────────┐
        ▼        ▼               ▼                  ▼
 [area-edit] [building-demand] [technology-selection]  (skippable refinements)
        │        │               │
        └────────┴───────┬───────┘
                         ▼
              [power-flow]  (auto — depends on grid-generation + area-edit)
                         │
                         ▼
              [grid-statistics]  (auto)
                         │
                         ▼
              [cost-breakdown]  (auto)
                         │
                         ▼
              [model-save]  (depends on simulation-settings + region-select + grid-generation)
```

Not every workflow uses all of these nodes. For example `quick-grid-analysis`
skips the refinement nodes and goes straight from `grid-generation` →
`grid-statistics` → `model-save`. The `NodeEngine` only makes a node available
when its dependencies are done and the context is valid for it, so the user is
presented with an **"Available next"** mix-and-match palette rather than a fixed
Back/Next sequence.

---

## Architecture: the node-network model

### `WorkflowNode` and `dependsOn`

A workflow declares a `nodes: WorkflowNode[]` array (kept alongside the legacy
`steps[]` for backward compatibility). Each node carries:

```ts
interface WorkflowNode {
  id: string; // stable node id within the workflow
  moduleId: string; // module from the catalog
  label: string;
  description?: string;
  dependsOn?: string[]; // node ids that must complete first
  auto?: boolean; // runs automatically when ready
  skippable?: boolean; // user may skip (uses defaults)
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}
```

### `NodeEngine` (graph-based playback)

[`workflow/NodeEngine.ts`](workflow/NodeEngine.ts) replaces the linear
index-cursor `WorkflowEngine` as the playback controller. It:

1. Builds the graph via `buildGraph(workflow)` (from `WorkflowGraph.ts`).
2. Tracks per-node lifecycle state (`pending | ready | active | done | skipped | error`).
3. **Context-validity gates** every node: a node is loadable only when all its
   `dependsOn` are `done` **and** its module's `io.required` keys exist in the
   context (`getReadyNodes` / `canRunModule`).
4. **Auto-runs** `auto` nodes as soon as they become ready, recursively in
   dependency order (`runAutoNodes`).
5. Exposes `getValidNextModules()` — the interactive (non-auto) ready nodes the
   user may choose next (the "mix and match" palette).

The React shell ([`ModelBuilderConfigurator.tsx`](ModelBuilderConfigurator.tsx))
drives the engine, renders the active node's module, and shows a **node palette**
(all nodes + their status) plus an **"Available next"** list.

### Context-validity gating

A node is **ready** when:

- it is not already `done` / `skipped` / `active`,
- all of its dependencies (explicit `dependsOn` plus edges derived from module
  `io.required` keys) are `done`,
- its module's `io.required` keys exist in the context.

This is the core "if the context is valid the node can load" logic, implemented
in [`workflow/WorkflowGraph.ts`](workflow/WorkflowGraph.ts) (`getReadyNodes`,
`getValidNextModules`, `isComplete`, `validateGraph`).

### Persistence / resume

[`workflow/FlowPersistence.ts`](workflow/FlowPersistence.ts) persists a
serializable `flowSnapshot` (`{ workflowId, workflowVersion, context,
nodeStates, savedAt }`) to `localStorage` under the key `"modular-workflow:flow"`.
Maps/Sets are round-tripped via a JSON replacer/reviver.

- The shell saves a debounced snapshot on every context change.
- On completion, the snapshot is cleared.
- [`ModelBuilderPage.tsx`](ModelBuilderPage.tsx) checks `hasFlowSnapshot()` on
  mount and offers a **"Resume previous flow?"** banner, seeding the configurator
  with the snapshot's `context` + `nodeStates`.

### Graph validation

Every workflow's `nodes`/`dependsOn` chain is validated by
[`workflows/graph-validate.test.ts`](workflows/graph-validate.test.ts), which runs
`validateGraph` against each registered workflow (and `defaultWorkflow`). It
asserts the dependency chain is acyclic and every node's `io.required` keys are
satisfiable by a dependency or a seeded context key.

---

## Module Details

### 1. Model Settings

- **What happens:** User enters a model name and selects scenario (season/duration/calliope).
- **Duration:** Derived from scenario via `scenarioToDateRange()`.
- **Status:** ✅ Done — `SimulationSettingsModule.tsx`
- **Data produced:**
  ```ts
  {
    modelName: string,
    scenario: SimulationScenario,
    fromDate: string,
    toDate: string,
    co2Preset: string,
    selfSufficiencyTarget: number,
    lineTypeLv: string,
    lineTypeMv: string,
    maxBatteryHours: number,
  }
  ```

### 2. Region Select

- **What happens:** User picks a region from a dropdown. Map moves to that region's bounding box.
- **API call:** `pylovoService.getAvailableRegions()` → returns `{ status, regions: AvailableRegion[] }`
- **Status:** ✅ Done — `RegionSelectModule.tsx`
- **Data produced:**
  ```ts
  {
    region: string;
  }
  ```

### 3. Area Draw

- **What happens:** User draws a polygon on the map to define the simulation area. On polygon draw completion, grid generation is triggered and the map shows buildings, connections, and transformers.
- **Status:** ✅ Done — `RegionSelectModule.tsx` (combined with step 2)
- **Data produced:**
  ```ts
  { polygons: [number, number][][] }
  ```

### 4. Grid Generation

- **What happens:** On polygon draw completion, grid generation is triggered. The map shows buildings, connections (lines), and transformers.
- **API call:** `pylovoService.generateGrid(payload)`
  - **Endpoint:** `POST /v2/pylovo/generate-grid`
  - **Payload:**
    ```ts
    {
      geom?: GeoJSON.Polygon | GeoJSON.MultiPolygon,  // preferred format
      polygon?: number[][],                              // legacy single polygon
      polygons?: number[][][],                           // legacy multiple polygons
      user_id?: string,                                  // for custom buildings filtering
      model_id?: number,                                 // for existing models (user-placed transformers)
      draft_id?: string,                                 // for new models before saving
      include_public_buildings?: boolean,
      include_private_buildings?: boolean,
      excluded_building_ids?: number[],
    }
    ```
  - **Response (`PylovoGridResponse`):**
    ```ts
    {
      status: string,
      buildings: GeoJSON.FeatureCollection,    // rendered on map
      transformers: GeoJSON.FeatureCollection,  // rendered on map
      lines: GeoJSON.FeatureCollection,         // rendered on map
      grids: GridInfo[],                        // grid metadata
    }
    ```
  - **`GridInfo`:**
    ```ts
    {
      grid_result_id: number,   // used for power flow, statistics, etc.
      kcid: number,
      bcid: number,
      plz: string,
      transformer_rated_power: number,
    }
    ```
- **Trigger:** On polygon draw completion (not a separate user click).
- **Old flow:** Passes `user_id`, `model_id`, `draft_id`, building filters. Response passed to `processPylovoData()` for map rendering.
- **Status:** ✅ Fixed — `GridGenerationModule.tsx`
  - Now triggers on polygon draw completion (via region-select), passes `user_id` / `model_id` / `draft_id`, renders the response on the map via `loadGridLayers`, and re-runs on polygon change.

### 5. Network Adjustment (Area Edit — separate module)

- **What happens:** User can adjust the network recommended by pylovo — add extra transformers, assign extra buildings to them, or remove some.
- **Status:** ✅ Done — `AreaEditModule.tsx` (separate module, not part of region-select)
- **API calls:**
  - `pylovoService.getTransformerSizes()` — list available transformer sizes
  - `pylovoService.addTransformer({ coordinates, kva, user_id, model_id })` — add new transformer
  - `pylovoService.deleteTransformer(gridResultId)` — remove transformer
  - `pylovoService.moveTransformer(gridResultId, newCoords)` — move transformer
  - `pylovoService.assignBuilding(osmId, gridResultId)` — assign building to transformer

### 6. Power Flow

- **What happens:** Sends data to pylovo again to regenerate the network with the new buildings and transformers that were added. Pypsa afterwards validates if the lines (cables) connecting the buildings and transformers are correct.
- **Trigger:** Separate step. Only triggers if pypsa is checked. Runs automatically whenever the grid changes.
- **API call:** `pylovoService.runPowerFlow(gridResultId, loadScaling?, buildingOsmIds?)`
  - Returns `PowerFlowResponse` with convergence status, network info, violations, results
- **Status:** ✅ Done — `PowerFlowModule.tsx` (only runs if pypsa enabled; auto-runs on grid change)

### 7. Technology Assignment

- **What happens:** Assign technologies (solar panels, batteries, etc.) to buildings. Each technology has its own configuration.
- **Status:** ✅ Done — `TechnologySelectionModule.tsx` (wraps `TechnologyDrawer` + `TechParameterDialog`)

### 8. Save Model

- **What happens:** Save the model and run it outside the configurator.
- **API call:** `modelService.createModel(data)` or `modelService.updateModel(id, data)`
- **Status:** ✅ Done — `ModelSaveModule.tsx`

---

## Configurator Data Flow (reference for the save pipeline)

> The following is distilled from `configuratorflow.md`. It documents exactly how the
> legacy configurator collects data and builds the final save payload. The modular
> workflow must reproduce the same result when running a full flow and pressing save.

### Entry point

The legacy feature is mounted by the router in `App.tsx`:

| Route                            | Component                        | Mode       |
| -------------------------------- | -------------------------------- | ---------- |
| `/app/model-dashboard/new-model` | `<AreaSelect />`                 | **create** |
| `/app/model-dashboard/edit/:id`  | `<AreaSelect editMode={true} />` | **edit**   |

`AreaSelect` is the top-level component. It calls the `useAreaSelect` hook and receives back `{ state, actions, pylovoLayers, techOperations, mapInteractions, ... }`.

### What data is collected (and how)

**User inputs (form state)** — rendered by `SidebarPanel.tsx`, live in `state` (typed `AreaSelectState`):

| Field            | Source                     | Type                      |
| ---------------- | -------------------------- | ------------------------- |
| `fromDate`       | date-range picker          | `string`                  |
| `toDate`         | date-range picker          | `string`                  |
| `modelName`      | text input                 | `string`                  |
| `resolution`     | resolution selector        | `number`                  |
| `advancedParams` | advanced parameters drawer | `AdvancedParametersState` |

**Map / geometry data** — drawn polygon coordinates stored in `state.allPolygons` (typed `[number, number][][]`). These are the selected area boundaries.

**Grid / network data (Pylovo)** — the map loads grid layers from `pylovoLayersData.pylovoGridData` (typed `PylovoGridData`): `buildings`, `lines`, `mv_lines`, `transformers`, `grids`. The user can edit buildings (demand, floors, area, household size, tech assignments, exclusions) and transformers (kVA rating) directly on the map; these edits are applied to the OpenLayers features in `pylovoLayersRef`.

**Snapshot of the current map state** — when a save is triggered, `getUpdatedPylovoData()` produces a fresh snapshot:

1. Starts from `pylovoLayersData.pylovoGridData`.
2. Iterates every layer in `pylovoLayersData.pylovoLayersRef.current`.
3. For each layer whose first feature has `feature_type === 'building'`, it serializes the features to GeoJSON (projected to `EPSG:4326`) and overwrites `updatedData.buildings`.

This ensures the saved `buildings` reflect all user edits made on the map.

### The save trigger

The save is only possible from the **"Unsaved changes" banner** in `SidebarPanel.tsx`. The banner renders when:

```
isModified && state.fromDate && state.toDate && state.modelName.trim()
```

It exposes two buttons:

| Button          | Handler                   | Behaviour                              |
| --------------- | ------------------------- | -------------------------------------- |
| **Save & Exit** | `actions.handleSave`      | saves, then navigates to the dashboard |
| **Save**        | `actions.handleQuickSave` | saves, stays on the page               |

Both are disabled unless `fromDate`, `toDate`, `modelName`, and at least one polygon are present.

### The save pipeline

`handleSave` simply awaits `handleQuickSave()` and then navigates to `DASHBOARD_ROUTE`.

`handleQuickSave` does three things:

1. Calls `getUpdatedPylovoData()` to snapshot the current map state.
2. Reads the current user from `useAuthStore.getState().user` to derive `userId`.
3. Calls the module-level `saveAreaData({...})` with:

```
fromDate, toDate, modelName, resolution, editMode, modelId,
onAreaSelected, polygonCoordinates: allPolygons, workspaceId,
updateModelMutation, createModelMutation, setIsSaving,
pylovoData: currentPylovoData, advancedParams,
draftId, userId, originalModel
```

`saveAreaData` is the core save function:

1. **Validates** via `isValidSaveData(fromDate, toDate, modelName, polygonCoordinates)` — requires all dates, a non-empty name, and at least one polygon. If invalid, it returns early.
2. Sets `isSaving(true)` and waits a short delay (`SAVE_DELAY_MS`).
3. Builds `areaData: AreaData`:

```ts
{ fromDate, toDate, resolution, modelName: modelName.trim(), timestamp: new Date().toISOString() }
```

4. **Embedded mode:** if `onAreaSelected` is provided, it calls `onAreaSelected(areaData)` and returns — no backend call.
5. Otherwise builds the payload:

```ts
const coordinatesGeoJSON = {
  type: "MultiPolygon",
  coordinates: polygonCoordinates.map((p) => [p]),
};
const config = buildSaveConfig(pylovoData, advancedParams);

const modelData = {
  title: areaData.modelName,
  from_date: areaData.fromDate,
  to_date: areaData.toDate,
  resolution: areaData.resolution,
  workspace_id: workspaceId,
  coordinates: coordinatesGeoJSON,
  config,
};
```

`buildSaveConfig` assembles the `config` object from the pylovo snapshot and advanced params:

- Copies `buildings`, `lines`, `mv_lines`, `transformers`, `grids` from `pylovoData` (if present).
- Adds a `pypsa` block (unless `advancedParams.pypsa_enabled === false`):

```ts
config.pypsa = {
  trafo_mv_lv_used: true,
  trafo_mv_lv_type: advancedParams?.trafo_mv_lv_type || "0.4 MVA 20/0.4 kV",
  line_type_mv: advancedParams?.line_type_mv || "NA2XS2Y 1x185 RM/25 12/20 kV",
  line_type_lv: advancedParams?.line_type_lv || "NAYY 4x150 SE",
};
```

- Returns `undefined` if the config would be empty.

**Edit vs. create branch:**

- **Edit path** (`editMode && modelId`): compares `originalModel` against the new values (title, dates, resolution, and a `configFingerprint` of the config) to detect real changes. Calls `updateModelMutation.mutateAsync({ id: modelId, data: updatePayload })`.
- **Create path**: calls `createModelMutation.mutateAsync(modelData)`. If a `draftId` exists, it then calls `pylovoService.finalizeTransformers(draftId, newModel.data.id, userId)` to attach user-placed transformers to the new model.

**Mutations → backend** — both mutations live in `useModelsQuery.ts`:

| Mutation                  | Payload type                                                                                     | Backend call                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `useCreateModelMutation`  | inline `{ title, from_date, to_date, resolution, workspace_id?, coordinates?, region, country }` | `modelService.createModel(modelData)` |
| `useUpdateModelMutation2` | `{ id, data: UpdateModelRequest }`                                                               | `modelService.updateModel(id, data)`  |

On success both invalidate the model list and stats queries.

### What is sent off (summary)

The final payload sent to the backend is a **model** with:

| Field          | Value                                    | Source                         |
| -------------- | ---------------------------------------- | ------------------------------ |
| `title`        | `modelName`                              | form input                     |
| `from_date`    | `fromDate`                               | form input                     |
| `to_date`      | `toDate`                                 | form input                     |
| `resolution`   | `resolution`                             | form input                     |
| `workspace_id` | current workspace id                     | workspace context              |
| `coordinates`  | `MultiPolygon` GeoJSON of drawn polygons | map drawing                    |
| `config`       | grid data + pypsa settings               | map snapshot + advanced params |

In **edit mode** the same shape is sent via `updateModel` (with a `status: 'modified'` marker when changes are detected). In **create mode** it is sent via `createModel`, and user-placed transformers are finalized afterwards.

### Component data flow (which TSX produces what)

This section maps each piece of saved data back to the **TSX component** that produced it, and how it flows into the final payload.

| Component                                 | Role                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AreaSelect.tsx`                          | Top-level orchestrator. Owns the map, dialogs, and the `useAreaSelect` hook. Wires every producer together and passes `state` + `actions` down to `SidebarPanel`. Hosts the map-interaction handlers that mutate the Pylovo layers.                                   |
| `SidebarPanel.tsx`                        | Primary **data producer** for the model's top-level fields: date range picker (`fromDate`/`toDate`), model name input (`modelName`), resolution selector (`resolution`), advanced parameters drawer, and the **Save & Exit** / **Save** buttons.                      |
| `AdvancedParametersDrawer.tsx`            | Edits `state.advancedParams`. Fields flow into `buildSaveConfig` and become the `config.pypsa` block: `pypsa_enabled`, `trafo_mv_lv_type`, `line_type_mv`, `line_type_lv`.                                                                                            |
| `AreaSelect.tsx` map-interaction handlers | Mutate the OpenLayers features that `getUpdatedPylovoData()` later serializes into `config.buildings`: `handleFClassDemandChange`, `handleSelectedFClassChange`, `handleFloorsChange`, `handleAreaChange`, `handleHouseholdSizeChange`, `handleTransformerKvaChange`. |
| `BuildingDialog.tsx`                      | Building edits (demand, floors, area, household size, f_class) plus **tech assignment**, **exclusion**, and **template application**.                                                                                                                                 |
| `TechParameterDialog.tsx`                 | Configures a specific technology's constraints. Persistence happens via `techOperations.handleSaveTechToBuildingBulk`, storing the tech + constraints on the building feature's `techs` map.                                                                          |
| `TransformerDialog.tsx`                   | Edits the transformer's kVA rating via `onChangeKva` → `handleTransformerKvaChange`, writing `ratedPowerKva` onto the transformer feature.                                                                                                                            |
| `TechnologyDrawer.tsx`                    | Tech drag & apply-to-all. Writes tech assignments onto building features, captured in `config.buildings` at save time.                                                                                                                                                |
| `MapOverlays.tsx`                         | Hosts the polygon-drawing interaction. Drawn polygons stored in `state.allPolygons` via `actions.handlePolygonDrawn` / `handlePolygonModified`. These become the `coordinates` field (`MultiPolygon`) in the final payload.                                           |

**Summary: producer → saved field**

| Saved field                           | Produced by                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `title`                               | `SidebarPanel` (model name input)                                                                     |
| `from_date` / `to_date`               | `SidebarPanel` (date range picker)                                                                    |
| `resolution`                          | `SidebarPanel` (resolution selector)                                                                  |
| `coordinates`                         | `MapOverlays` (drawn polygons → `state.allPolygons`)                                                  |
| `config.buildings`                    | `AreaSelect` handlers + `BuildingDialog` + `TechParameterDialog` + `TechnologyDrawer` (feature edits) |
| `config.transformers`                 | `AreaSelect` handler + `TransformerDialog` (kVA edits)                                                |
| `config.pypsa`                        | `AdvancedParametersDrawer` (`state.advancedParams`)                                                   |
| `config.lines` / `mv_lines` / `grids` | base `pylovoGridData` (unchanged by UI)                                                               |

### Type reference

| Type                                    | Location               |
| --------------------------------------- | ---------------------- |
| `AreaSelectState` / `AreaSelectActions` | `types/area-select.ts` |
| `AreaData`                              | `types/area-select.ts` |
| `PylovoGridData`                        | `types/area-select.ts` |
| `AdvancedParametersState`               | `types/area-select.ts` |
| `UpdateModelRequest`                    | `modelService.ts`      |

> **Note:** `saveAreaData`, `buildSaveConfig`, `configFingerprint`, and `isValidSaveData` are typed loosely with `any`, so the `config` payload and the save function itself are not strongly typed even though the surrounding types are.

---

## Current Module Inventory

| Module                         | Status        | Notes                                                                       |
| ------------------------------ | ------------- | --------------------------------------------------------------------------- |
| simulation-settings            | ✅ Done       | Model name + scenario + params; writes to `simulationSettings`              |
| region-select                  | ✅ Done       | Region pick + polygon draw combined; triggers grid generation on draw       |
| grid-generation                | ✅ Done       | Passes user_id/model_id/draft_id, renders on map, re-runs on polygon change |
| area-edit (network adjustment) | ✅ Done       | Separate module — add/delete/move transformers, assign buildings            |
| building-demand                | ⚠️ Stub       | Needs re-checking against the legacy flow                                   |
| transformer-topology           | ⚠️ Superseded | Replaced by `area-edit`                                                     |
| technology-selection           | ✅ Done       | Wraps TechnologyDrawer + TechParameterDialog                                |
| power-flow                     | ✅ Done       | Only triggers if pypsa checked; auto-runs on grid change                    |
| grid-statistics                | ⚠️ Stub       | Needs re-checking against the legacy flow                                   |
| cost-breakdown                 | ⚠️ Stub       | Needs re-checking against the legacy flow                                   |
| hosting-capacity               | ⚠️ Stub       | Needs re-checking against the legacy flow                                   |
| pipeline                       | ⚠️ Stub       | Needs re-checking against the legacy flow                                   |
| model-save                     | ✅ Done       | Reproduces the legacy save payload via `saveAreaData`                       |
| model-load                     | ✅ Done       |                                                                             |
| model-diff                     | ✅ Done       |                                                                             |

---

## Next Steps

1. **Node-network rework** — ✅ Complete: `NodeEngine` + `WorkflowGraph` + `nodes[]`/`dependsOn` + persistence/resume are in place.
2. **Save parity** — ✅ Complete: `ModelSaveModule` reproduces the exact legacy save payload via the shared `saveService`.
3. **Grid Generation** — ✅ Done: triggers on polygon draw, passes `user_id`/`model_id`/`draft_id`, renders on map.
4. **Region Select + Area Draw** — ✅ Done: polygon drawing works end-to-end and triggers grid generation.
5. **Area Edit (Network Adjustment)** — ✅ Done: separate module for add/delete/move transformers + building assignment.
6. **Power Flow** — ✅ Done: only triggers if pypsa checked, auto-runs on grid change.
7. **Technology Assignment** — ✅ Done: tech picker + config UI.
8. **Remaining stubs** — building-demand, grid-statistics, cost-breakdown, hosting-capacity, pipeline still need re-checking against the legacy flow.
