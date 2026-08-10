# Modular Workflow

A **detached, side-by-side** replacement for the monolithic configurator. The old
[`AreaSelect.tsx`](../configurator/region-selector/AreaSelect.tsx) keeps running — this
feature is for beta testing until migration is complete.

The goal is to rebuild the model-builder flow as a set of small, composable **modules**,
each responsible for one logical step (model settings, region select, grid generation,
area edit, power flow, technology assignment, …). Modules are wired together by
**workflows** (JSON definitions) and played back by a **WorkflowEngine**.

> **Companion docs**
>
> - [`FLOW.md`](FLOW.md) — the step-by-step flow of the legacy builder, with the API
>   contract for each step. Read this first to understand _what_ each module should do.
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
              └───────────────► WorkflowEngine ◄──────────────┘
                                (step playback, validation,
                                 data handoff)
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

### The engine: `WorkflowEngine`

[`workflow/WorkflowEngine.ts`](workflow/WorkflowEngine.ts) is a framework-agnostic
controller that:

1. Owns the workflow definition, the current step index, and a working copy of the context.
2. Resolves each step's `moduleId` to a `ModuleDefinition` via the `ModuleInventory`.
3. Validates `io.required` keys before advancing.
4. Calls lifecycle hooks (`onEnter` / `onLeave`).
5. Merges module output back into the context.

The React playback shell ([`ModelBuilderConfigurator.tsx`](ModelBuilderConfigurator.tsx))
drives the engine and syncs the resulting context into the
`ModelBuilderContextProvider` via `onContextChange`.

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

| Tab                  | Component                                                      | Purpose                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflows**        | [`ModelBuilderLanding.tsx`](ModelBuilderLanding.tsx)           | Model-aware workflow picker. Lists all runnable workflows, gated on whether an existing model is available. Starting a `from-existing-model` workflow loads the model into context first. |
| **Configurator**     | [`ModelBuilderConfigurator.tsx`](ModelBuilderConfigurator.tsx) | The playback shell for the active workflow. Renders the current step's module, handles next/previous, shows recommendations and the model diff.                                           |
| **Workflow Builder** | [`workflow/WorkflowBuilder.tsx`](workflow/WorkflowBuilder.tsx) | Admin UI to compose, validate, import, and export workflows.                                                                                                                              |

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

Workflows are JSON files in [`workflows/`](workflows/). Each step references a module by
`moduleId`:

```json
{
  "id": "my-workflow",
  "name": "My Workflow",
  "description": "What it does.",
  "version": "1.0.0",
  "startType": "from-scratch",
  "tags": ["my", "workflow"],
  "followUpWorkflows": [],
  "steps": [
    { "moduleId": "simulation-settings", "label": "Simulation Settings", "skippable": true },
    { "moduleId": "region-select", "label": "Select Region", "skippable": false },
    { "moduleId": "grid-generation", "label": "Generate Grid", "auto": true }
  ]
}
```

Step flags:

- `skippable` — user can skip this step
- `auto` — runs automatically without user interaction (e.g. grid generation, power flow)

Register the workflow in [`workflows/index.ts`](workflows/index.ts) so it's available in
the `defaultWorkflowRegistry`.

---

## Lifecycle of a Workflow Step

1. **onEnter** → module fetches/initialises data (optional)
2. **Render** → the module's React component receives `context` + `onUpdate`
3. **User interacts** → component calls `onUpdate({ outputKey: value })`
4. **validate** → checks `io.required` keys exist (or custom logic)
5. **onLeave** → module transforms/persists data before stepping forward (optional)
6. **Advance** → WorkflowEngine moves to the next step

---

## File Layout

```
src/features/modular-workflow/
├── flags.ts                        ← feature flag + route constant
├── index.ts                        ← public API exports
├── ModelBuilderPage.tsx            ← route page (3 tabs)
├── ModelBuilderLanding.tsx         ← workflow picker (model-aware)
├── ModelBuilderConfigurator.tsx    ← playback shell
├── FLOW.md                         ← legacy flow + API contracts
├── STATUS.md                       ← module status tracker
├── context/
│   ├── ModelBuilderContext.tsx     ← useReducer context provider
│   └── useModelBuilderContext.ts   ← hook
├── types/
│   ├── context.ts                  ← ConfiguratorContext (data contract)
│   ├── module.ts                   ← ModuleDefinition, ModuleMeta, ModuleIO, ModuleProps
│   └── workflow.ts                 ← WorkflowDefinition, WorkflowStep
├── modules/
│   ├── base/BaseModule.ts          ← base class + defineModule factory
│   ├── ModuleInventory.ts          ← registry + workflow-requirement functions
│   ├── index.ts                    ← barrel export + registerAll() side-effect
│   ├── simulation-settings/        ← model name + scenario + params
│   ├── region-select/              ← region pick + polygon draw + grid trigger
│   ├── grid-generation/            ← pylovo grid generation + map render
│   ├── area-edit/                  ← network adjustment (transformers/buildings)
│   ├── model-load/                 ← load existing model
│   ├── model-save/                 ← save model
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
│   ├── WorkflowEngine.ts           ← step playback controller
│   ├── WorkflowRegistry.ts         ← workflow CRUD + import/export
│   ├── WorkflowRecommender.ts      ← follow-up workflow recommendations
│   └── WorkflowBuilder.tsx         ← admin compose/validate/import/export UI
└── workflows/
    ├── index.ts                    ← registers all workflows
    ├── defaultWorkflow.ts
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

- **Area Edit coordinates** — `addTransformer` / `moveTransformer` currently use
  placeholder `[0,0]` coordinates. They need wiring to the map click position.
- **Stub modules** — `building-demand`, `grid-statistics`, `cost-breakdown`,
  `hosting-capacity`, `pipeline` still need re-checking against the legacy flow.
- **`modelYaml` recursive nesting** — fixed: `serialiseModel` excludes
  `modelYaml` / `previousModelYaml` / `modelYamlEditMode`.
