# Modular Workflow — Status

> Living document tracking the rebuild of the ModelBuilder, module by module,
> following the steps performed in the legacy model builder. Modules are grouped
> into logical units and replace existing ones where required.

## Current Assessment (2026-08-10)

| Area                                              | Status      | Notes                                                                                                                                      |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model Settings** (`simulation-settings`)        | ✅ Good     | Model name, scenario (season / duration / calliope), scenario→date conversion, CO2 presets, battery hours, self-sufficiency, PyPSA toggle. |
| **Area Select** (`region-select`)                 | ✅ Improved | Map + polygon drawing works. Grid generation now triggers on polygon draw and renders buildings/transformers/lines on the map.             |
| **Grid Generation** (`grid-generation`)           | ✅ Fixed    | Now passes `user_id` / `model_id` / `draft_id`, renders the response on the map via `loadGridLayers`, and re-runs on polygon change.       |
| **Area Edit** (`area-edit`)                       | ✅ New      | Network adjustment: add / delete / move transformers, assign buildings. Replaces `transformer-topology`.                                   |
| **Power Flow** (`power-flow`)                     | ✅ Improved | Only runs if PyPSA is enabled; re-runs automatically when the grid changes.                                                                |
| **Technology Selection** (`technology-selection`) | ✅ Good     | Wraps `TechnologyDrawer` + `TechParameterDialog` for solar / battery / etc. with config.                                                   |

## Rebuild Plan

The legacy model builder is being replayed step-by-step. Each step is grouped
into a logical module and replaces the existing module where one exists.

- [x] **Step 1 — Model Settings** — done (see `simulation-settings`).
- [x] **Step 2 — Area Select** — done. Map moves to selected region; drawn
      polygon triggers grid generation.
- [x] **Step 3 — Grid Generation** — fixed. Receives the drawn area
      (`polygons`), passes `user_id` / `model_id` / `draft_id`, renders the
      returned buildings / transformers / lines on the map.
- [x] **Step 4 — Area Edit (Network Adjustment)** — new `area-edit` module.
      Add / delete / move transformers, assign buildings.
- [x] **Step 5 — Power Flow** — only runs if PyPSA enabled; auto-runs on grid
      change.
- [x] **Step 6 — Technology Assignment** — `technology-selection` module wraps
      the tech drawer + parameter dialog.
- [ ] Further steps TBD (building demand, grid statistics, cost breakdown,
      hosting capacity, pipeline).

## Module Inventory

| Module               | ID                     | Status                         |
| -------------------- | ---------------------- | ------------------------------ |
| Simulation Settings  | `simulation-settings`  | ✅                             |
| Region Select        | `region-select`        | ✅                             |
| Grid Generation      | `grid-generation`      | ✅                             |
| Area Edit            | `area-edit`            | ✅ (new)                       |
| Model Load           | `model-load`           | ✅                             |
| Model Save           | `model-save`           | ✅                             |
| Building Demand      | `building-demand`      | ⚠️ (needs re-check)            |
| Transformer Topology | `transformer-topology` | ⚠️ (superseded by `area-edit`) |
| Technology Selection | `technology-selection` | ✅                             |
| Power Flow           | `power-flow`           | ✅                             |
| Grid Statistics      | `grid-statistics`      | ⚠️ (needs re-check)            |
| Cost Breakdown       | `cost-breakdown`       | ⚠️ (needs re-check)            |
| Hosting Capacity     | `hosting-capacity`     | ⚠️ (needs re-check)            |
| Pipeline             | `pipeline`             | ⚠️ (needs re-check)            |
| Model Diff           | `model-diff`           | ✅                             |

## Known Issues

- **`modelYaml` recursive nesting** — fixed: `serialiseModel` now excludes
  `modelYaml` / `previousModelYaml` / `modelYamlEditMode` so the YAML document
  no longer embeds itself.
- **Area Edit coordinates** — `addTransformer` / `moveTransformer` currently
  use placeholder `[0, 0]` coordinates. These need to be wired to the map click
  position for real placement.
- **Building demand / statistics / cost / hosting / pipeline** — still stubs,
  need re-checking against the legacy flow.

## Workflows

| Workflow             | ID                     | Steps                                                                                                                                                      |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick Grid Analysis  | `quick-grid-analysis`  | simulation-settings → region-select → grid-generation → grid-statistics → model-save                                                                       |
| Full Energy Planning | `full-energy-planning` | simulation-settings → region-select → grid-generation → area-edit → building-demand → technology-selection → power-flow → grid-statistics → cost-breakdown |
| EV Hosting Analysis  | `ev-hosting-analysis`  | …                                                                                                                                                          |
| Cost Optimization    | `cost-optimization`    | …                                                                                                                                                          |
