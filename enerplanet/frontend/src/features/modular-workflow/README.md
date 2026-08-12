# Modular Workflow

A **detached, side-by-side** replacement for the monolithic configurator. The old
[`AreaSelect.tsx`](../configurator/region-selector/AreaSelect.tsx) keeps running — this
feature is for beta testing until migration is complete.

The goal is to rebuild the model-builder flow as a set of small, composable **modules**,
each responsible for one logical step (model settings, region select, grid generation,
area edit, power flow, technology assignment, …). Modules are wired together by
**workflows** (JSON definitions) and played back by a graph-based **NodeEngine** (the
legacy linear **WorkflowEngine** is kept for backward compatibility).

> **Companion docs**
>
> - [`FLOW.md`](FLOW.md) — the node-network flow of the model builder, with the API
>   contract for each module. Read this first to understand _what_ each module should do.
> - [`STATUS.md`](STATUS.md) — current state of each module (done / stub / broken).

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │            ModelBuilderPage (route)          │
                    │   Tabs: Workflows | Configurator | Builder   │
                    └─────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
   ModelBuilderLanding      ModelBuilderConfigurator    WorkflowBuilder
   (workflow picker)        (playback shell)            (admin compose UI)
              │                       │                       │
              │                       ▼                       │
              │            ModelBuilderContextProvider        │
              │            (useReducer — shared state)        │
              │                       │                       │
              └───────────────► NodeEngine ◄─────────────────┘
                                (graph-based playback,
                                 context-validity gating,
                                 auto-run, persistence)
                                      │
                                      ▼
                              WorkflowGraph
                        (buildGraph, getReadyNodes,
                         getValidNextModules, validateGraph)
                                      │
                                      ▼
                              ModuleInventory
                        (registry + workflow-requirement lookup)
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │  Modules (each a BaseModule subclass)    │
                    │  read from / write to ConfiguratorContext│
                    └─────────────────────────────────────────┘
```

The legacy linear **`WorkflowEngine`** still exists in
[`workflow/WorkflowEngine.ts`](workflow/WorkflowEngine.ts) and is exported from
[`index.ts`](index.ts), but the playback shell now drives the graph-based
**`NodeEngine`**. Workflows keep their `steps[]` array so the legacy engine can
still play them back, but the graph helpers and `NodeEngine` prefer the `nodes[]`
form when present.

### The data contract: `ConfiguratorContext`

Every module reads its input **exclusively** from the shared context and writes its
output **back** to it. Modules never pass data to each other directly — the context is
the single source of truth.

- **Reads** are declared via `io.inputs`
- **Writes** are declared via `io.outputs`
- **Prerequisites** are declared via `io.required` (validated before a step can advance)

The context type lives in [`types/context.ts`](types/context.ts). It holds everything:
region, polygons, grid data, transformers, technologies, simulation results, costs, the
serialised model YAML, and model metadata (`modelId`, `draftId`, `workspaceId`).

### The engine: `NodeEngine` (graph-based)

[`workflow/NodeEngine.ts`](workflow/NodeEngine.ts) is the current playback controller.
It is a framework-agnostic, **graph-based** engine that replaces the linear
index-cursor `WorkflowEngine`:

1. Builds the graph via `buildGraph(workflow)` (from `WorkflowGraph.ts`).
2. Tracks per-node lifecycle state (`pending | ready | active | done | skipped | error`).
3. **Context-validity gates** every node: a node loads only when all its `dependsOn`
   are `done` **and** its module's `io.required` keys exist in the context.
4. **Auto-runs** `auto` nodes as soon as they become ready, recursively in dependency
   order (`runAutoNodes`).
5. Exposes `getValidNextModules()` — the interactive (non-auto) ready nodes the user
   may choose next (the "mix and match" palette).

The React playback shell ([`ModelBuilderConfigurator.tsx`](ModelBuilderConfigurator.tsx))
drives the engine and syncs the resulting context into the
`ModelBuilderContextProvider` via `onContextChange`.

### The graph helpers: `WorkflowGraph`

[`workflow/WorkflowGraph.ts`](workflow/WorkflowGraph.ts) provides the pure, framework-
agnostic node-network helpers:

- `buildGraph(workflow)` — derive `{ nodes, edges }` from a workflow's `nodes[]`
  (or from `steps[]` when `nodes` is absent). Edges come from each node's explicit
  `dependsOn` plus its module's `io.required` / `io.inputs` contract.
- `getReadyNodes(graph, context, nodeStates)` — nodes whose dependencies are all
  `done` AND whose module `io.required` keys exist in context (the "if the context
  is valid the node can load" logic).
- `getValidNextModules(graph, context, nodeStates)` — the interactive (non-auto)
  ready nodes a user may choose next.
- `isComplete(graph, nodeStates)` — all nodes `done` or `skipped`.
- `validateGraph(workflow, seed?)` — checks the dependency chain is acyclic and every
  node's `io.required` keys are satisfiable by a dependency or a seeded context key.

### The legacy engine: `WorkflowEngine`

[`workflow/WorkflowEngine.ts`](workflow/WorkflowEngine.ts) is the original linear
controller (step index + `io.required` validation + lifecycle hooks). It is kept for
backward compatibility and still exported from [`index.ts`](index.ts), but the playback
shell now drives `NodeEngine`. Workflows keep their `steps[]` array so the legacy
engine can still play them back.

### Persistence / resume: `FlowPersistence`

[`workflow/FlowPersistence.ts`](workflow/FlowPersistence.ts) persists a serializable
`flowSnapshot` (`{ workflowId, workflowVersion, context, nodeStates, savedAt }`) to
`localStorage` under the key `"modular-workflow:flow"`. Maps/Sets are round-tripped via
a JSON replacer/reviver. The shell saves a debounced snapshot on every context change
and clears it on completion; [`ModelBuilderPage.tsx`](ModelBuilderPage.tsx) offers a
"Resume previous flow?" banner on mount when a snapshot exists.

### The registry: `ModuleInventory`

[`modules/ModuleInventory.ts`](modules/ModuleInventory.ts) is the registry of all modules.
It also provides workflow-level helpers:

- `getWorkflowRequiredDefinitions(workflow)` — resolve step `moduleId`s to definitions
- `getWorkflowInputs(workflow)` / `getWorkflowOutputs(workflow)` — aggregate a workflow's needs
- `validateWorkflow(workflow, seed?)` — check the dependency chain is sound
- `getCatalogSummary()` — human-readable module list

> **Important:** the `defaultModuleInventory` singleton is populated by the `registerAll()`
> side-effect in [`modules/index.ts`](modules/index.ts). Always import the inventory from
> the **barrel** (`../modules`) — importing the raw `ModuleInventory` file directly will
> skip that side-effect and leave the registry empty.

### The workflow registry: `WorkflowRegistry`

[`workflow/WorkflowRegistry.ts`](workflow/WorkflowRegistry.ts) is the single source of
truth for "what workflows exist". It loads, caches, and looks up workflows by ID, and
validates each JSON through `ModuleInventory.validateWorkflow()` before registering.
Consumed by the Workflow Builder, the Workflow Recommender, and the landing page.

---

## Feature Flag & Routing

The feature is gated behind a flag in [`flags.ts`](flags.ts):

- `VITE_MODELBUILDER_ENABLED=true` enables it (env var)
- `DEFAULT_ENABLED` is the constant fallback (currently `false`)

The route is mounted under the normal `/app` context:

```
MODELBUILDER_ROUTE = "/app/modelbuilder"
```

It's registered in [`App.tsx`](../../App.tsx) and linked from the sidebar in
[`AppLayout.tsx`](../../components/app-layout/AppLayout.tsx).

---

## UI: Three Views

[`ModelBuilderPage.tsx`](ModelBuilderPage.tsx) hosts three tabs:

| Tab                  | Component                                                      | Purpose                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workflows**        | [`ModelBuilderLanding.tsx`](ModelBuilderLanding.tsx)           | Workflow picker. Lists all runnable workflows. Each workflow starts with a model-import module that asks whether to load an existing model into the context. |
| **Configurator**     | [`ModelBuilderConfigurator.tsx`](ModelBuilderConfigurator.tsx) | The playback shell for the active workflow. Renders the current step's module, handles next/previous, shows recommendations and the model diff.              |
| **Workflow Builder** | [`workflow/WorkflowBuilder.tsx`](workflow/WorkflowBuilder.tsx) | Admin UI to compose, validate, import, and export workflows.                                                                                                 |

---

## Module Inventory (current)

| Module               | ID                     | Status | Notes                                                                                                                                 |
| -------------------- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Simulation Settings  | `simulation-settings`  | ✅     | Model name, scenario (season/duration/calliope), scenario→date conversion, CO2 presets, battery hours, self-sufficiency, PyPSA toggle |
| Region Select        | `region-select`        | ✅     | Region pick + polygon draw; triggers grid generation on draw                                                                          |
| Grid Generation      | `grid-generation`      | ✅     | Passes `user_id`/`model_id`/`draft_id`, renders on map, re-runs on polygon change                                                     |
| Area Edit            | `area-edit`            | ✅     | Network adjustment: add/delete/move transformers, assign buildings                                                                    |
| Model Load           | `model-load`           | ✅     | List + load existing model into context                                                                                               |
| Model Save           | `model-save`           | ✅     | Save model, run outside configurator                                                                                                  |
| Technology Selection | `technology-selection` | ✅     | Wraps `TechnologyDrawer` + `TechParameterDialog`                                                                                      |
| Power Flow           | `power-flow`           | ✅     | Only runs if PyPSA enabled; auto-runs on grid change                                                                                  |
| Building Demand      | `building-demand`      | ⚠️     | Stub — needs re-check                                                                                                                 |
| Transformer Topology | `transformer-topology` | ⚠️     | Superseded by `area-edit`                                                                                                             |
| Grid Statistics      | `grid-statistics`      | ⚠️     | Stub — needs re-check                                                                                                                 |
| Cost Breakdown       | `cost-breakdown`       | ⚠️     | Stub — needs re-check                                                                                                                 |
| Hosting Capacity     | `hosting-capacity`     | ⚠️     | Stub — needs re-check                                                                                                                 |
| Pipeline             | `pipeline`             | ⚠️     | Stub — needs re-check                                                                                                                 |
| Model Diff           | `model-diff`           | ✅     | YAML serialise/diff/viewer                                                                                                            |

---

## How to Add a New Module

### Option A: Extend `BaseModule` (recommended)

```ts
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";

export class MyModule extends BaseModule {
  readonly meta = {
    id: "my-module",
    name: "My Module",
    description: "What this module does.",
    icon: "bolt",
    category: "analysis",
    defaultComplexity: "basic",
  };

  readonly io = {
    inputs: ["gridData"],          // reads from context
    outputs: ["myResult"],         // writes to context
    required: ["gridData"],        // must exist before this runs
  };

  readonly component = MyComponent;

  // Optional: custom validation
  override validate(context: ConfiguratorContext) {
    if (!context.myResult) {
      return { valid: false, errors: ["No result yet."] };
    }
    return { valid: true };
  }

  // Optional: lifecycle hooks
  override async onEnter(context: ConfiguratorContext): Promise<void> {
    // fetch data, initialise
  }
}

function MyComponent({ context, onUpdate, complexity }: ModuleProps) {
  // Read from context, call onUpdate({ myResult: ... }) to write back
  return <div>...</div>;
}

export const myModule = new MyModule();
```

### Option B: Use the `defineModule` factory (composition)

```ts
import { defineModule } from "../base/BaseModule";

export const myModule = defineModule({
  meta: { id: "my-module", name: "My Module", ... },
  io: { inputs: ["gridData"], outputs: ["myResult"], required: ["gridData"] },
  component: MyComponent,
  // validate gets a sensible default (checks required keys exist)
});
```

### Register the module

Add it to [`modules/index.ts`](modules/index.ts) — both the barrel export **and** the
`registerAll([...])` array (this is what populates the singleton):

```ts
export { myModule, MyModule } from "./my-module/MyModule";
// ...
import { myModule } from "./my-module/MyModule";
defaultModuleInventory.registerAll([, /* ... */ myModule]);
```

---

## How to Add a New Workflow

Workflows are JSON files in [`workflows/`](workflows/). The **primary** form is the
node-network `nodes` array (played back by `NodeEngine`). Each node references a module
by `moduleId` and declares its dependencies via `dependsOn`. Every workflow starts
with a `model-load` entry node that asks whether to import an existing model into
the context:

```json
{
  "id": "my-workflow",
  "name": "My Workflow",
  "description": "What it does.",
  "version": "1.0.0",
  "tags": ["my", "workflow"],
  "followUpWorkflows": [],
  "nodes": [
    {
      "id": "model-load",
      "moduleId": "model-load",
      "label": "Import Model",
      "skippable": true
    },
    {
      "id": "simulation-settings",
      "moduleId": "simulation-settings",
      "label": "Simulation Settings",
      "skippable": true
    },
    {
      "id": "region-select",
      "moduleId": "region-select",
      "label": "Select Region",
      "skippable": false
    },
    {
      "id": "grid-generation",
      "moduleId": "grid-generation",
      "label": "Generate Grid",
      "dependsOn": ["region-select"],
      "auto": true
    }
  ]
}
```

Node flags:

- `dependsOn` — node ids that must complete before this node can run
- `skippable` — user can skip this node (uses defaults)
- `auto` — runs automatically without user interaction (e.g. grid generation, power flow)

Register the workflow in [`workflows/index.ts`](workflows/index.ts) so it's available in
the `defaultWorkflowRegistry`.

### Legacy `steps` form

Workflows also keep a `steps` array for backward compatibility with the legacy
`WorkflowEngine`. The graph helpers and `NodeEngine` prefer `nodes` when present; when
`nodes` is absent, `buildGraph` derives nodes from `steps` automatically.

```json
{
  "id": "my-workflow",
  "steps": [
    { "moduleId": "region-select", "label": "Select Region" },
    { "moduleId": "grid-generation", "label": "Generate Grid", "auto": true }
  ],
  "nodes": [
    { "id": "region-select", "moduleId": "region-select", "label": "Select Region" },
    {
      "id": "grid-generation",
      "moduleId": "grid-generation",
      "label": "Generate Grid",
      "dependsOn": ["region-select"],
      "auto": true
    }
  ]
}
```

### Validating the graph

Every workflow's `nodes`/`dependsOn` chain is checked by
[`workflows/graph-validate.test.ts`](workflows/graph-validate.test.ts), which runs
`validateGraph` from [`workflow/WorkflowGraph.ts`](workflow/WorkflowGraph.ts) against
each registered workflow (and the `defaultWorkflow`). It asserts the dependency chain
is acyclic and every node's `io.required` keys are satisfiable by a dependency or a
seeded context key. Run it with:

```sh
npx vitest run src/features/modular-workflow/workflows/graph-validate.test.ts
```

> **Note:** Every workflow starts with a `model-load` entry node that asks the
> user whether to import an existing model into the context. If yes, context keys
> such as `polygons` / `region` / `gridData` / `gridResultIds` are seeded from
> the loaded model. If no, the workflow proceeds with an empty context.

---

## Lifecycle of a Workflow Node

1. **Ready** → the `NodeEngine` marks a node `ready` when all its `dependsOn` are
   `done` and its module's `io.required` keys exist in the context.
2. **Activate** → `activateNode(nodeId)` sets it `active` and calls the module's
   `onEnter` (optional).
3. **Render** → the module's React component receives `context` + `onUpdate`.
4. **User interacts** → component calls `onUpdate({ outputKey: value })`, which the
   shell syncs back into the engine via `updateContext`.
5. **Complete** → `completeNode(nodeId)` calls `onLeave`, merges the module's declared
   `io.outputs` into the context, marks it `done`, auto-runs any newly-ready `auto`
   nodes, and sets the active node to the next ready interactive node.
6. **Skip** → `skipNode(nodeId)` marks a `skippable` node `skipped` and advances.

---

## File Layout

```
src/features/modular-workflow/
├── flags.ts                        ← feature flag + route constant
├── index.ts                        ← public API exports
├── ModelBuilderPage.tsx            ← route page (3 tabs) + resume banner
├── ModelBuilderLanding.tsx         ← workflow picker (model-aware)
├── ModelBuilderConfigurator.tsx    ← playback shell (drives NodeEngine)
├── FLOW.md                         ← node-network flow + API contracts
├── STATUS.md                       ← module status tracker
├── context/
│   ├── ModelBuilderContext.tsx     ← useReducer context provider
│   └── useModelBuilderContext.ts   ← hook
├── types/
│   ├── context.ts                  ← ConfiguratorContext (data contract)
│   ├── module.ts                   ← ModuleDefinition, ModuleMeta, ModuleIO, ModuleProps
│   └── workflow.ts                 ← WorkflowDefinition, WorkflowNode, NodeStatus, WorkflowGraph
├── modules/
│   ├── base/BaseModule.ts          ← base class + defineModule factory
│   ├── ModuleInventory.ts          ← registry + workflow-requirement functions
│   ├── index.ts                    ← barrel export + registerAll() side-effect
│   ├── simulation-settings/        ← model name + scenario + params
│   ├── region-select/              ← region pick + polygon draw + grid trigger
│   ├── grid-generation/            ← pylovo grid generation + map render
│   ├── area-edit/                  ← network adjustment (transformers/buildings)
│   ├── model-load/                 ← load existing model
│   ├── model-save/                 ← save model (reproduces legacy payload)
│   ├── technology-selection/       ← tech picker + config
│   ├── power-flow/                 ← pypsa/pylovo validation
│   ├── building-demand/            ← (stub)
│   ├── transformer-topology/       ← (superseded by area-edit)
│   ├── grid-statistics/            ← (stub)
│   ├── cost-breakdown/             ← (stub)
│   ├── hosting-capacity/           ← (stub)
│   ├── pipeline/                   ← (stub)
│   └── model-diff/                 ← YAML serialise/diff/viewer
├── workflow/
│   ├── NodeEngine.ts               ← graph-based playback controller
│   ├── WorkflowGraph.ts            ← buildGraph, getReadyNodes, validateGraph, …
│   ├── FlowPersistence.ts          ← save/load/clear/has flow snapshot (localStorage)
│   ├── WorkflowEngine.ts           ← legacy linear step playback controller
│   ├── WorkflowRegistry.ts         ← workflow CRUD + import/export
│   ├── WorkflowRecommender.ts      ← follow-up workflow recommendations
│   └── WorkflowBuilder.tsx         ← admin compose/validate/import/export UI
└── workflows/
    ├── index.ts                    ← registers all workflows
    ├── defaultWorkflow.ts
    ├── graph-validate.test.ts      ← validates each workflow's nodes/dependsOn
    ├── quick-grid-analysis.json
    ├── full-energy-planning.json
    ├── ev-hosting-analysis.json
    └── cost-optimization.json
```

---

## Getting Started (for a new developer)

1. **Read [`FLOW.md`](FLOW.md)** — understand the legacy builder's steps and the API
   contract for each one.
2. **Read [`STATUS.md`](STATUS.md)** — see which modules are done vs. stubs.
3. **Enable the feature** — set `VITE_MODELBUILDER_ENABLED=true` (or flip
   `DEFAULT_ENABLED` in [`flags.ts`](flags.ts)) and open `/app/modelbuilder`.
4. **Pick a stub module** (e.g. `building-demand`, `grid-statistics`) and rebuild it
   following the pattern in a working module like `grid-generation` or `area-edit`.
5. **Register** any new module in [`modules/index.ts`](modules/index.ts) and any new
   workflow in [`workflows/index.ts`](workflows/index.ts).
6. **Typecheck** with `npx tsc --noEmit -p tsconfig.json` and confirm zero errors in
   `modular-workflow/`.

---

## Known Issues / Next Steps

**Done (Phases 1–6):**

- **Save parity** — `ModelSaveModule` reproduces the exact legacy save payload via the
  shared `configurator/services/saveService.ts` (`buildSaveConfig`, `configFingerprint`,
  `isValidSaveData`, `saveAreaData`, `getUpdatedPylovoData`,
  `mapSimulationSettingsToAdvancedParams`).
- **Node-network** — `NodeEngine` (graph-based) + `WorkflowGraph` helpers + `nodes[]` /
  `dependsOn` in all workflows + `graph-validate.test.ts`.
- **Persistence / resume** — `FlowPersistence` saves a debounced snapshot to
  `localStorage`; `ModelBuilderPage` offers a "Resume previous flow?" banner.
- **`modelYaml` recursive nesting** — fixed: `serialiseModel` excludes
  `modelYaml` / `previousModelYaml` / `modelYamlEditMode`.

**Remaining:**

- **Area Edit coordinates** — `addTransformer` / `moveTransformer` currently use
  placeholder `[0,0]` coordinates. They need wiring to the map click position.
- **Stub modules** — `building-demand`, `grid-statistics`, `cost-breakdown`,
  `hosting-capacity`, `pipeline` still need re-checking against the legacy flow.
