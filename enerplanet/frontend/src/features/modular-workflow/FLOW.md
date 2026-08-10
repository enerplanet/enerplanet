# Modular Workflow — Flow Document

> Living document capturing the step-by-step flow of the old configurator,
> to be rebuilt as modules in the new modular-workflow system.

---

## Overall Flow (High-Level)

```
[1] Model Settings (name + scenario → dates)
         │
         ▼
[2] Region Select (pick dataset region)
         │
         ▼
[3] Area Draw (draw polygon on map)
         │
         ▼
[4] Grid Generation (pylovo API → buildings, transformers, lines rendered on map)
         │
         ▼
[5] Network Adjustment (optional — add extra transformers, assign extra buildings or remove some)
         │
         ▼
[6] Power Flow (pypsa + pylovo validation, here its more that we send the data to pylovo again to regenerate the network with the new buildings and transformers that were added, pypsa afterwards is used ot validate if the lines(cables) connecting the buildings and transformers used are correct or not.)
         │
         ▼
[7] Technology Assignment (solar, battery, etc. with config)
         │
         ▼
[8] Save Model → run outside configurator
```

---

## Step Details

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

## Current Module Inventory

| Module                         | Status        | Notes                                                                       |
| ------------------------------ | ------------- | --------------------------------------------------------------------------- |
| simulation-settings            | ✅ Done       | Model name + scenario + params                                              |
| region-select                  | ✅ Done       | Region pick + polygon draw combined; triggers grid generation on draw       |
| grid-generation                | ✅ Fixed      | Passes user_id/model_id/draft_id, renders on map, re-runs on polygon change |
| area-edit (network adjustment) | ✅ Done       | Separate module — add/delete/move transformers, assign buildings            |
| building-demand                | ⚠️ Stub       |                                                                             |
| transformer-topology           | ⚠️ Superseded | Replaced by `area-edit`                                                     |
| technology-selection           | ✅ Done       | Wraps TechnologyDrawer + TechParameterDialog                                |
| power-flow                     | ✅ Done       | Only triggers if pypsa checked; auto-runs on grid change                    |
| grid-statistics                | ⚠️ Stub       |                                                                             |
| cost-breakdown                 | ⚠️ Stub       |                                                                             |
| hosting-capacity               | ⚠️ Stub       |                                                                             |
| pipeline                       | ⚠️ Stub       |                                                                             |
| model-save                     | ✅ Done       |                                                                             |
| model-load                     | ✅ Done       |                                                                             |
| model-diff                     | ✅ Done       |                                                                             |

---

## Next Steps

1. **Grid Generation** — ✅ Fixed: triggers on polygon draw, passes `user_id`/`model_id`/`draft_id`, renders on map.
2. **Region Select + Area Draw** — ✅ Done: polygon drawing works end-to-end and triggers grid generation.
3. **Area Edit (Network Adjustment)** — ✅ Done: separate module for add/delete/move transformers + building assignment.
4. **Power Flow** — ✅ Done: only triggers if pypsa checked, auto-runs on grid change.
5. **Technology Assignment** — ✅ Done: tech picker + config UI.
6. **Remaining stubs** — building-demand, grid-statistics, cost-breakdown, hosting-capacity, pipeline still need re-checking against the legacy flow.
