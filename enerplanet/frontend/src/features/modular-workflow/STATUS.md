# Modular Workflow — Status

> Living document tracking the rebuild of the ModelBuilder, module by module,
> following the steps performed in the legacy model builder. Modules are grouped
> into logical units and replace existing ones where required.

## Current Assessment (2026-08-11)

| Area                                              | Status      | Notes                                                                                                                                      |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node-network rework**                           | ✅ Complete | `NodeEngine` (graph-based) + `WorkflowGraph` helpers + `nodes[]`/`dependsOn` in all workflows + `graph-validate.test.ts`.                  |
| **Save parity**                                   | ✅ Complete | `ModelSaveModule` reproduces the exact legacy save payload via the shared `configurator/services/saveService.ts`.                          |
| **Persistence / resume**                          | ✅ Complete | `FlowPersistence` saves a debounced snapshot to `localStorage`; `ModelBuilderPage` offers a "Resume previous flow?" banner.                |
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
- [x] **Step 7 — Node-network rework** — complete. `NodeEngine` (graph-based)
      replaces the linear `WorkflowEngine` as the playback controller; all
      workflows declare `nodes[]`/`dependsOn`; flow state is persisted and
      resumable.
- [x] **Step 8 — Save parity** — complete. `ModelSaveModule` reproduces the
      exact legacy save payload via the shared `saveService`.
- [ ] Further steps TBD (building demand, grid statistics, cost breakdown,
      hosting capacity, pipeline).

## Module Inventory

| Module               | ID                     | Status                             |
| -------------------- | ---------------------- | ---------------------------------- |
| Simulation Settings  | `simulation-settings`  | ✅                                 |
| Region Select        | `region-select`        | ✅                                 |
| Grid Generation      | `grid-generation`      | ✅                                 |
| Area Edit            | `area-edit`            | ✅ (new)                           |
| Model Load           | `model-load`           | ✅                                 |
| Model Save           | `model-save`           | ✅ (save parity via `saveService`) |
| Building Demand      | `building-demand`      | ⚠️ (needs re-check)                |
| Transformer Topology | `transformer-topology` | ⚠️ (superseded by `area-edit`)     |
| Technology Selection | `technology-selection` | ✅                                 |
| Power Flow           | `power-flow`           | ✅                                 |
| Grid Statistics      | `grid-statistics`      | ⚠️ (needs re-check)                |
| Cost Breakdown       | `cost-breakdown`       | ⚠️ (needs re-check)                |
| Hosting Capacity     | `hosting-capacity`     | ⚠️ (needs re-check)                |
| Pipeline             | `pipeline`             | ⚠️ (needs re-check)                |
| Model Diff           | `model-diff`           | ✅                                 |

## Known Issues

**Resolved:**

- **`modelYaml` recursive nesting** — fixed: `serialiseModel` now excludes
  `modelYaml` / `previousModelYaml` / `modelYamlEditMode` so the YAML document
  no longer embeds itself.
- **Save parity** — resolved: `ModelSaveModule` reproduces the exact legacy save
  payload via the shared `configurator/services/saveService.ts`.
- **Node-network rework** — complete: `NodeEngine` + `WorkflowGraph` +
  `nodes[]`/`dependsOn` + persistence/resume are in place.

**Open:**

- **Area Edit coordinates** — `addTransformer` / `moveTransformer` currently
  use placeholder `[0, 0]` coordinates. These need to be wired to the map click
  position for real placement.
- **Building demand / statistics / cost / hosting / pipeline** — still stubs,
  need re-checking against the legacy flow.

## Changelog

### 2026-08-11 — Flow-state persistence (Phase 6)

- **New `workflow/FlowPersistence.ts`** — a localStorage-backed persistence
  layer so a flow's state is not discarded when the user leaves the flow,
  loses connection, or exits while waiting on a long model run.
  - `saveFlowSnapshot(snapshot)` — serializes `{ workflowId, workflowVersion,
context, nodeStates, savedAt }` to `localStorage` under the stable key
    `"modular-workflow:flow"`. A JSON replacer converts `Map` / `Set` values
    (e.g. `buildingEstimates`, `buildingFilters.excludedIds`) into tagged
    plain objects so they survive `JSON.stringify`.
  - `loadFlowSnapshot()` — reads and parses the snapshot, restoring Maps/Sets
    via a matching reviver. Returns `null` when nothing is stored or the data
    is invalid.
  - `clearFlowSnapshot()` — removes the key (called on successful save/complete).
  - `hasFlowSnapshot()` — whether a snapshot is currently persisted.
  - All `localStorage` access is guarded in try/catch (SSR / privacy-mode safe).
- **`ModelBuilderConfigurator.tsx`** — on every context change a debounced
  (300ms) effect builds a `flowSnapshot` from `{ workflowId, workflowVersion,
context, nodeStates, savedAt }` and calls `saveFlowSnapshot`. When the flow
  completes (`isComplete()`), `clearFlowSnapshot()` is called so a finished
  flow is not offered for resume.
- **`ModelBuilderPage.tsx`** — on mount, if `hasFlowSnapshot()`, loads the
  snapshot, looks up the workflow by `workflowId` in the registry, and shows a
  "Resume previous flow?" banner. Resuming seeds the configurator with the
  snapshot's `context` + `nodeStates` (the `NodeEngine` restores persisted
  node states for resume). Dismissing clears the snapshot.
- `npx tsc --noEmit -p tsconfig.json` passes with zero errors.

### 2026-08-11 — Workflows declare `nodes` (Phase 5)

- **All workflows now declare an explicit `nodes: WorkflowNode[]` array** alongside
  the legacy `steps` (kept intact for backward compatibility with `WorkflowEngine`).
  Each node has a stable `id`, `moduleId`, `label`, and an explicit `dependsOn` list
  that expresses the node-network (mix-and-match, context-validity gating) so the
  `NodeEngine` can play them back.
- **`quick-grid-analysis`** — `region-select` + `simulation-settings` (entry) →
  `grid-generation` (auto, depends on `region-select`) → `grid-statistics` (auto,
  depends on `grid-generation`) → `model-save` (depends on `simulation-settings`,
  `region-select`, `grid-generation`).
- **`full-energy-planning`** — entry `simulation-settings` + `region-select` →
  `grid-generation` (auto) → optional refinements `area-edit` / `building-demand` /
  `technology-selection` (skippable, depend on `grid-generation`) → `power-flow`
  (auto, depends on `grid-generation` + `area-edit`) → `grid-statistics` (auto) →
  `cost-breakdown` (auto, depends on `grid-statistics`) → `model-save`.
- **`ev-hosting-analysis`** — entry `region-select` + `simulation-settings` →
  `grid-generation` (auto) → `grid-statistics` (auto) → `hosting-capacity` (auto,
  depends on `grid-statistics`) → `model-save`.
- **`cost-optimization`** — entry `model-load` (import prompt) → `simulation-settings` +
  `grid-generation` (auto, polygons seeded from the loaded model if imported) →
  `technology-selection` (skippable) / `power-flow` (auto) / `grid-statistics` (auto)
  → `cost-breakdown` (auto) → `model-save`.
- **`defaultWorkflow.ts`** — also declares `nodes` (`region-select` →
  `grid-generation`).
- **New `workflows/graph-validate.test.ts`** — runs `validateGraph` against every
  workflow (and `defaultWorkflow`) to assert the dependency chain is acyclic and each
  node's `io.required` keys are satisfiable. Documented in `README.md`.
- `npx tsc --noEmit -p tsconfig.json` passes with zero errors.

### 2026-08-11 — Graph-aware shell (Phase 4)

- **`ModelBuilderConfigurator.tsx` now drives `NodeEngine`** instead of the
  linear `WorkflowEngine`. The engine is created in a ref with
  `(workflow, initialContext, { inventory, onContextChange })`; context is
  synced both ways (engine → provider via `onContextChange`, provider → engine
  via `updateContext` on every render).
- **Node palette** — lists every node in the workflow with its live status
  (`pending` / `ready` / `active` / `done` / `skipped` / `error`) from
  `getNodeStates()`. `done` / `skipped` nodes can be re-activated (jump back);
  `ready` nodes can be activated.
- **"Available next" list** — the interactive ready nodes from
  `getValidNextModules()` (the mix-and-match palette). Clicking one calls
  `activateNode(nodeId)`.
- **Complete step** — calls `completeNode(activeNodeId)` (runs `onLeave`,
  merges outputs, auto-runs auto nodes, advances to the next ready interactive
  node). **Skip** — calls `skipNode(activeNodeId)` for `skippable` nodes.
- **Progress** uses `getProgress()` (done/skipped vs total nodes).
- Kept the completion screen (summary, key results, recommendations via
  `defaultWorkflowRecommender`, "Start over", "Stop — go to dashboard",
  "Browse all workflows"), the `handleStartWorkflow` fallback that swaps the
  engine, the Basic/Expert toggle, the collapsible context summary, and the
  `ModelDiffViewer` panel.

### 2026-08-11 — NodeEngine (Phase 3)

- **New `workflow/NodeEngine.ts`** — a graph-based playback controller that
  replaces the linear index-cursor `WorkflowEngine`. It builds the graph via
  `buildGraph(workflow)`, tracks per-node `nodeStates`, and drives execution
  on top of the Phase 2 `WorkflowGraph` helpers.
- **Context-validity gating** — a node is loadable only when all its
  `dependsOn` are `done` AND its module's `io.required` keys exist in context
  (reuses `getReadyNodes` / `canRunModule`). `updateContext` merges changes
  and recomputes ready nodes.
- **Auto-run** — `auto` nodes run automatically as soon as they become ready.
  `completeNode` / `updateContext` detect newly-ready auto nodes and run them
  recursively in dependency order (`runAutoNodes`).
- **API** mirrors `WorkflowEngine` so the shell can swap it in: `getContext`,
  `updateContext`, `getReadyNodes`, `getValidNextModules`, `getActiveNode`,
  `getActiveModule`, `activateNode`, `completeNode`, `skipNode`,
  `runAutoNodes`, `isComplete`, `getProgress`, `getNodeStates`, `getGraph`,
  `getWorkflow`. Constructor accepts `(workflow, initialContext, options)`
  and restores persisted `nodeStates` for resume support.
- **Exported** `NodeEngine` from `index.ts` alongside `WorkflowEngine`.
- `WorkflowEngine.ts` and the shell (`ModelBuilderConfigurator.tsx`) are
  unchanged; the shell swap is Phase 4.

### 2026-08-11 — Node-graph model (Phase 2)

- **New graph types** in `types/workflow.ts`: `WorkflowNode` (id, moduleId,
  label, description, dependsOn, auto, skippable, inputMapping,
  outputMapping), `NodeStatus` (`pending | ready | active | done | skipped |
error`), `WorkflowEdge`, and `WorkflowGraph` (`{ nodes, edges }`).
- **`WorkflowDefinition.nodes`** added alongside the existing `steps` for
  backward compatibility — the legacy linear shell keeps using `steps`.
- **New node-state fields** on `ConfiguratorContext` in `types/context.ts`:
  `nodeStates` (per-node status), `activeNodeId`, and `flowSnapshot` (a
  serializable persistence snapshot for a later phase).
- **New `workflow/WorkflowGraph.ts`** with pure graph helpers:
  - `buildGraph(workflow)` — derives edges from each node's `dependsOn` plus
    its module's `io.required`/`io.inputs` (resolved via the inventory).
  - `getReadyNodes(graph, context, nodeStates)` — nodes whose dependencies are
    all `done` AND whose module `io.required` keys exist in context (reuses
    `canRunModule`/`validate`). This is the "if the context is valid the node
    can load" logic.
  - `getValidNextModules(graph, context, nodeStates)` — the interactive
    (non-auto) ready nodes a user may choose next (the "mix and match"
    palette).
  - `isComplete(graph, nodeStates)` — all nodes `done` or `skipped`.
  - `validateGraph(workflow, seed?)` — checks the dependency chain is acyclic
    and every node's `required` is satisfiable by a dependency or seed.
- The graph engine and shell rewrite are a later phase; `WorkflowEngine.ts`
  and the existing workflows are unchanged.

### 2026-08-11 — Save parity (Phase 1)

- **New shared save service** at `configurator/services/saveService.ts`:
  `buildSaveConfig`, `configFingerprint`, `isValidSaveData`, `saveAreaData`,
  `getUpdatedPylovoData`, `mapSimulationSettingsToAdvancedParams`.
  Reproduces the exact save payload shape from the legacy configurator
  (buildings/lines/mv_lines/transformers/grids/pypsa, resolution,
  finalizeTransformers, edit-vs-create branch with `status:'modified'`).
- **New `simulationSettings` field** on `ConfiguratorContext` — a dedicated
  typed field holding `{ modelName, scenario, fromDate, toDate, line_type_lv,
line_type_mv, co2_limit, max_hours, autarky, pypsa_enabled }`. Replaces the
  `as unknown as` casts that were used to store `SimulationSettings` inside
  `advancedParams`.
- **`SimulationSettingsModule`** now writes to `simulationSettings` instead of
  `advancedParams`. The `io.outputs` and `validate` method updated accordingly.
- **`ModelSaveModule`** rewritten to call `saveAreaData` from the shared
  service, passing `simulationSettings` (mapped to the legacy
  `AdvancedParametersState` shape via `mapSimulationSettingsToAdvancedParams`),
  `gridData`, `polygons`, `workspaceId`, `draftId`, and `originalModel`.
- **`originalModel` field** added to `ConfiguratorContext` for edit-mode change
  detection.

### 2026-08-11 — Fix: infinite render loop on workflow open

- **Symptom:** opening a workflow without starting a step flooded the console
  with `Maximum update depth exceeded` (60+ times in under a minute).
- **Root cause:** the shell's context-sync effect in
  `ModelBuilderConfigurator.tsx` (`useEffect(() => { void engine.updateContext(context) }, [context, engine])`)
  fed the full React `context` back into the engine on every render. Because
  `NodeEngine.updateContext` unconditionally called `notifyContextChange()`
  (which the shell wires to `onUpdate`), and both the engine merge
  (`{ ...this.context, ...updates }`) and the reducer (`{ ...state, ...updates }`)
  always produce a fresh object reference, each pass created a new `context`
  reference → the effect re-ran → infinite loop. The `tick` counter was **not**
  the cause (it is only bumped in event handlers, never in an effect), and the
  debounced persistence effect does not call `setState`.
- **Fix:** `NodeEngine.updateContext` now only calls `notifyContextChange()`
  when the merged context actually changed (shallow equality guard). Legitimate
  module updates still propagate; the redundant echo-back that re-triggered the
  effect is suppressed, so the loop terminates after at most one sync pass.
- **Verified:** `npx tsc --noEmit -p tsconfig.json` exits 0.

## Workflows

All workflows declare a `nodes[]` array (with `dependsOn`) alongside the legacy
`steps[]`. Each graph is validated by `workflows/graph-validate.test.ts`.

| Workflow             | ID                     | Nodes (node-network)                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quick Grid Analysis  | `quick-grid-analysis`  | region-select + simulation-settings (entry) → grid-generation (auto, depends on region-select) → grid-statistics (auto, depends on grid-generation) → model-save (depends on simulation-settings + region-select + grid-generation)                                                                                                              |
| Full Energy Planning | `full-energy-planning` | simulation-settings + region-select (entry) → grid-generation (auto, depends on region-select) → area-edit / building-demand / technology-selection (skippable, depend on grid-generation) → power-flow (auto, depends on grid-generation + area-edit) → grid-statistics (auto) → cost-breakdown (auto, depends on grid-statistics) → model-save |
| EV Hosting Analysis  | `ev-hosting-analysis`  | region-select + simulation-settings (entry) → grid-generation (auto, depends on region-select) → grid-statistics (auto) → hosting-capacity (auto, depends on grid-statistics) → model-save                                                                                                                                                       |
| Cost Optimization    | `cost-optimization`    | simulation-settings + grid-generation (auto, entry; polygons seeded from the loaded model) → technology-selection (skippable) / power-flow (auto) / grid-statistics (auto) → cost-breakdown (auto) → model-save                                                                                                                                  |
