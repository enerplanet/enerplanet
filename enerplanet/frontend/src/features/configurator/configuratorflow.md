# Configurator Data Flow

This document explains the full data process of the **Area Select / Configurator** feature, from the moment the user enters the screen to the moment a model is saved to the backend. It covers **what data is collected, how it is collected, and what is sent off**.

---

## 1. Entry point

The feature is mounted by the router in [`App.tsx`](../../../App.tsx):

| Route                            | Component                        | Mode       |
| -------------------------------- | -------------------------------- | ---------- |
| `/app/model-dashboard/new-model` | `<AreaSelect />`                 | **create** |
| `/app/model-dashboard/edit/:id`  | `<AreaSelect editMode={true} />` | **edit**   |

`AreaSelect` is the top-level component. It calls the `useAreaSelect` hook and receives back `{ state, actions, pylovoLayers, techOperations, mapInteractions, ... }`.

---

## 2. What data is collected (and how)

### 2.1 User inputs (form state)

The user fills in a form rendered by [`SidebarPanel.tsx`](region-selector/components/SidebarPanel.tsx). These values live in `state` (typed `AreaSelectState`):

| Field            | Source                     | Type                      |
| ---------------- | -------------------------- | ------------------------- |
| `fromDate`       | date-range picker          | `string`                  |
| `toDate`         | date-range picker          | `string`                  |
| `modelName`      | text input                 | `string`                  |
| `resolution`     | resolution selector        | `number`                  |
| `advancedParams` | advanced parameters drawer | `AdvancedParametersState` |

### 2.2 Map / geometry data

The user draws polygons on the map. The drawn coordinates are stored in `state.allPolygons` (typed `[number, number][][]`). These are the selected area boundaries.

### 2.3 Grid / network data (Pylovo)

The map loads grid layers from `pylovoLayersData.pylovoGridData` (typed `PylovoGridData`). This is the base network data:

- `buildings`
- `lines`
- `mv_lines`
- `transformers`
- `grids`

The user can edit buildings (demand, floors, area, household size, tech assignments, exclusions) and transformers (kVA rating) directly on the map. These edits are applied to the OpenLayers features in `pylovoLayersRef`.

### 2.4 Snapshot of the current map state

When a save is triggered, [`getUpdatedPylovoData()`](hooks/useAreaSelect.ts) produces a fresh snapshot:

1. Starts from `pylovoLayersData.pylovoGridData`.
2. Iterates every layer in `pylovoLayersData.pylovoLayersRef.current`.
3. For each layer whose first feature has `feature_type === 'building'`, it serializes the features to GeoJSON (projected to `EPSG:4326`) and overwrites `updatedData.buildings`.

This ensures the saved `buildings` reflect all user edits made on the map.

---

## 3. The save trigger

The save is only possible from the **"Unsaved changes" banner** in [`SidebarPanel.tsx`](region-selector/components/SidebarPanel.tsx). The banner renders when:

```
isModified && state.fromDate && state.toDate && state.modelName.trim()
```

It exposes two buttons:

| Button          | Handler                   | Behaviour                              |
| --------------- | ------------------------- | -------------------------------------- |
| **Save & Exit** | `actions.handleSave`      | saves, then navigates to the dashboard |
| **Save**        | `actions.handleQuickSave` | saves, stays on the page               |

Both are disabled unless `fromDate`, `toDate`, `modelName`, and at least one polygon are present.

---

## 4. The save pipeline

### 4.1 `handleSave` → `handleQuickSave`

[`handleSave`](hooks/useAreaSelect.ts) simply awaits `handleQuickSave()` and then navigates to `DASHBOARD_ROUTE`.

### 4.2 `handleQuickSave`

[`handleQuickSave`](hooks/useAreaSelect.ts) does three things:

1. Calls `getUpdatedPylovoData()` to snapshot the current map state (see §2.4).
2. Reads the current user from `useAuthStore.getState().user` to derive `userId`.
3. Calls the module-level `saveAreaData({...})` with:

```
fromDate, toDate, modelName, resolution, editMode, modelId,
onAreaSelected, polygonCoordinates: allPolygons, workspaceId,
updateModelMutation, createModelMutation, setIsSaving,
pylovoData: currentPylovoData, advancedParams,
draftId, userId, originalModel
```

### 4.3 `saveAreaData`

[`saveAreaData`](hooks/useAreaSelect.ts) is the core save function:

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

### 4.4 `buildSaveConfig`

[`buildSaveConfig`](hooks/useAreaSelect.ts) assembles the `config` object from the pylovo snapshot and advanced params:

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

### 4.5 Edit vs. create branch

- **Edit path** (`editMode && modelId`): compares `originalModel` against the new values (title, dates, resolution, and a `configFingerprint` of the config) to detect real changes. Calls `updateModelMutation.mutateAsync({ id: modelId, data: updatePayload })`.
- **Create path**: calls `createModelMutation.mutateAsync(modelData)`. If a `draftId` exists, it then calls `pylovoService.finalizeTransformers(draftId, newModel.data.id, userId)` to attach user-placed transformers to the new model.

### 4.6 Mutations → backend

Both mutations live in [`useModelsQuery.ts`](../../model-dashboard/hooks/useModelsQuery.ts):

| Mutation                  | Payload type                                                                                     | Backend call                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `useCreateModelMutation`  | inline `{ title, from_date, to_date, resolution, workspace_id?, coordinates?, region, country }` | `modelService.createModel(modelData)` |
| `useUpdateModelMutation2` | `{ id, data: UpdateModelRequest }`                                                               | `modelService.updateModel(id, data)`  |

On success both invalidate the model list and stats queries.

---

## 5. What is sent off (summary)

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

---

## 6. Component data flow (which TSX produces what)

This section maps each piece of saved data back to the **TSX component** that produced it, and how it flows into the final payload.

### 6.1 [`AreaSelect.tsx`](region-selector/AreaSelect.tsx) — the orchestrator

`AreaSelect` is the top-level component. It owns the map, the dialogs, and the `useAreaSelect` hook. It does **not** produce form data itself, but it wires every producer together and passes `state` + `actions` down to `SidebarPanel`. It also hosts the map-interaction handlers that mutate the Pylovo layers (see §6.4).

### 6.2 [`SidebarPanel.tsx`](region-selector/components/SidebarPanel.tsx) — form inputs + save buttons

This is the primary **data producer** for the model's top-level fields. It renders:

- **Date range picker** → `state.fromDate`, `state.toDate`
- **Model name input** → `state.modelName`
- **Resolution selector** → `state.resolution`
- **Advanced parameters drawer** (see §6.3)
- **Save & Exit** button → `actions.handleSave`
- **Save** button → `actions.handleQuickSave`

These values are written into `state` via `actions.setModelName`, `actions.setFromDate`, etc., and are read back by `handleQuickSave` when building the payload.

### 6.3 [`AdvancedParametersDrawer.tsx`](region-selector/AdvancedParametersDrawer.tsx) — pypsa config

Rendered inside `SidebarPanel` (line 500). It edits `state.advancedParams` (typed `AdvancedParametersState`). The relevant fields flow into `buildSaveConfig` and become the `config.pypsa` block:

- `pypsa_enabled` → whether the `pypsa` block is included
- `trafo_mv_lv_type` → `config.pypsa.trafo_mv_lv_type`
- `line_type_mv` → `config.pypsa.line_type_mv`
- `line_type_lv` → `config.pypsa.line_type_lv`

### 6.4 Map-interaction handlers in [`AreaSelect.tsx`](region-selector/AreaSelect.tsx) — grid edits

These handlers mutate the OpenLayers features that `getUpdatedPylovoData()` later serializes into `config.buildings`:

| Handler                                  | Produces                  | Writes to                           |
| ---------------------------------------- | ------------------------- | ----------------------------------- |
| `handleFClassDemandChange` (line 865)    | per-f_class yearly demand | building feature `fClassDetails`    |
| `handleSelectedFClassChange` (line 1139) | selected f_class          | building feature `selected_f_class` |
| `handleFloorsChange` (line 907)          | floors / floors_3dbag     | building feature                    |
| `handleAreaChange` (line 924)            | building area             | building feature                    |
| `handleHouseholdSizeChange` (line 935)   | household size            | building feature                    |
| `handleTransformerKvaChange` (line 846)  | transformer kVA           | transformer feature `ratedPowerKva` |

All of these call `pylovoLayers.updateBuildingProperty(...)` / `updateBuildingFClassDemand(...)` / `updateTransformerKva(...)`, which write directly onto the map features. Because `getUpdatedPylovoData()` re-serializes the live features at save time, these edits are captured automatically.

### 6.5 [`BuildingDialog.tsx`](region-selector/components/BuildingDialog.tsx) — building edits

Opened when a building is clicked. It drives the same handlers as §6.4 (demand, floors, area, household size, f_class) and also:

- **Tech assignment** — via `onEditTech` / `onRemoveTech` (wired in `AreaSelect.tsx` lines 2017–2034), which update the building feature's `techs` map.
- **Exclusion** — via `actions.toggleBuildingExclusion` (line 2061), which marks a building as excluded.
- **Template application** — `onApplyTemplate` (line 2063) sets a batch of techs on the feature.

### 6.6 [`TechParameterDialog.tsx`](region-selector/components/TechParameterDialog.tsx) — technology parameters

Opened from the building dialog to configure a specific technology. Its local `handleSave` (line 718) / `handleSaveToAll` (line 748) write the tech's constraints. The actual persistence to the feature happens through `techOperations.handleSaveTechToBuildingBulk` (wired as `onSave` in `AreaSelect.tsx` line 2094), which stores the tech + constraints on the building feature's `techs` map.

### 6.7 [`TransformerDialog.tsx`](region-selector/components/TransformerDialog.tsx) — transformer edits

Opened when a transformer is clicked. It edits the transformer's kVA rating via `onChangeKva` → `handleTransformerKvaChange` (§6.4), writing `ratedPowerKva` onto the transformer feature.

### 6.8 [`TechnologyDrawer.tsx`](region-selector/components/TechnologyDrawer.tsx) — tech drag & apply-to-all

Rendered inside `SidebarPanel`. It lets the user drag technologies onto the map (`onTechDragStart`/`onTechDragEnd`) and apply techs to all buildings (`onAddTechToAll`/`onRemoveTechFromAll`). These write tech assignments onto building features, which are captured in `config.buildings` at save time.

### 6.9 [`MapOverlays.tsx`](region-selector/components/MapOverlays.tsx) — polygon drawing

Hosts the polygon-drawing interaction. Drawn polygons are stored in `state.allPolygons` via `actions.handlePolygonDrawn` / `handlePolygonModified`. These become the `coordinates` field (`MultiPolygon`) in the final payload.

### 6.10 Summary: producer → saved field

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

---

## 7. Type reference

| Type                                    | Location                                                            |
| --------------------------------------- | ------------------------------------------------------------------- |
| `AreaSelectState` / `AreaSelectActions` | [`types/area-select.ts`](types/area-select.ts)                      |
| `AreaData`                              | [`types/area-select.ts`](types/area-select.ts)                      |
| `PylovoGridData`                        | [`types/area-select.ts`](types/area-select.ts)                      |
| `AdvancedParametersState`               | [`types/area-select.ts`](types/area-select.ts)                      |
| `UpdateModelRequest`                    | [`modelService.ts`](../../model-dashboard/services/modelService.ts) |

> **Note:** `saveAreaData`, `buildSaveConfig`, `configFingerprint`, and `isValidSaveData` are typed loosely with `any`, so the `config` payload and the save function itself are not strongly typed even though the surrounding types are.
