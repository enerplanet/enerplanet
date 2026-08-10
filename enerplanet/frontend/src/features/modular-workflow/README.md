# Modular Workflow

A **detached, side-by-side** replacement for the monolithic configurator. The old [`AreaSelect.tsx`](../configurator/region-selector/AreaSelect.tsx) keeps running — this feature is for beta testing until migration is complete.

## Architecture

```
Modules (input/simulation/analysis/output)
       │  read from / write to
       ▼
  ┌─────────────────┐
  │ ConfiguratorContext  │  ← shared data contract (single source of truth)
  └─────────────────┘
       │
       ▼
  WorkflowEngine (step playback, validation, data handoff)
       │
       ▼
  ModuleInventory (registry, workflow-requirement lookup)
```

Every module:

- **Reads input exclusively from the context** — never from external state
- **Writes output back to the context** — never passes data to another module directly
- **Declares its contract** via `io.inputs`, `io.outputs`, `io.required`

---

## Dependencies

### Light dependency on the old configurator (intentional)

The shared data contract [`types/context.ts`](types/context.ts) imports two types from the current configurator:

```
import type { AdvancedParametersState, PylovoGridData } from "../../configurator/types/area-select";
```

This is a **one-way dependency** (new → old). The old configurator has no knowledge of this feature.

**Why not duplicate?** To avoid maintaining two copies of the same shapes while the old configurator is still active. When the old configurator is eventually deprecated, we inline those types here and remove the dependency — it's a simple find-and-replace in one file.

**All other imports** are internal to this feature (`types/` ↔ `modules/`).

### External dependencies (from `package.json`)

- `react` — module components
- `geojson` — GeoJSON types used in the context

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

---

## How to Register & Use the Inventory

```ts
import { defaultModuleInventory } from "./modules";
import { myModule } from "./modules/my-module";

// Register at app bootstrap
defaultModuleInventory.register(myModule);
// or batch:
defaultModuleInventory.registerAll([moduleA, moduleB]);

// Access all modules
defaultModuleInventory.getAllModules();
defaultModuleInventory.getCatalogSummary();
// → [{ id, name, category, complexity, inputs, outputs, required }]

// Resolve workflow steps to their module definitions
const defs = defaultModuleInventory.getWorkflowRequiredDefinitions(workflow);
// → [ModuleDefinition, ModuleDefinition, ...]

// Aggregate what a workflow needs / produces
defaultModuleInventory.getWorkflowInputs(workflow);
defaultModuleInventory.getWorkflowOutputs(workflow);

// Validate the dependency chain (seeded context keys)
const { valid, errors } = defaultModuleInventory.validateWorkflow(
  workflow,
  ["modelId"] // pre-seeded context keys
);
```

---

## File Layout

```
src/features/modular-workflow/
├── types/
│   ├── context.ts        ← ConfiguratorContext (the data contract)
│   ├── module.ts         ← ModuleDefinition, ModuleMeta, ModuleIO, ModuleProps
│   └── workflow.ts       ← WorkflowDefinition, WorkflowStep
└── modules/
    ├── base/
    │   └── BaseModule.ts       ← base class + defineModule factory
    ├── ModuleInventory.ts      ← registry + workflow-requirement functions
    ├── region-select/          ← example module (stub)
    ├── grid-generation/        ← example module (stub)
    └── index.ts                ← barrel export
```

---

## Lifecycle of a Workflow Step

1. **onEnter** → module fetches/initialises data (optional)
2. **Render** → the module's React component receives `context` + `onUpdate`
3. **User interacts** → component calls `onUpdate({ outputKey: value })`
4. **validate** → checks `io.required` keys exist (or custom logic)
5. **onLeave** → module transforms/persists data before stepping forward (optional)
6. **Advance** → WorkflowEngine moves to next step

---

Built the template base module + module inventory system. Here's what was created:

Files created
File	Purpose
types/context.ts	Data contract — ConfiguratorContext with all typed fields (region, grid, buildings, transformers, technologies, simulation results, costs, YAML, UI state)
types/module.ts	Module types — ModuleMeta, ModuleIO, ModuleProps, ModuleDefinition, ModuleValidationResult
types/workflow.ts	Workflow types — WorkflowDefinition, WorkflowStep, WorkflowStartType
modules/base/BaseModule.ts	Template base module — abstract class with context helpers (getInputs, writeOutputs), default validation (checks io.required), lifecycle hooks (onEnter, onLeave), and getDefinition() adapter. Also exports defineModule() factory for functional composition.
modules/ModuleInventory.ts	Module inventory — registry with: getModule(), getAllModules(), getWorkflowRequiredDefinitions(workflow) (resolves step moduleIds to definitions), getWorkflowInputs(workflow) (aggregates all inputs), getWorkflowOutputs(workflow) (aggregates all outputs), validateWorkflow(workflow, seed?) (dependency chain validation), getCatalogSummary() (human-readable module list). Exports defaultModuleInventory singleton.
modules/region-select/RegionSelectModule.ts	Example module extending BaseModule — reads nothing, writes region + polygons
modules/grid-generation/GridGenerationModule.ts	Example module extending BaseModule — reads polygons + advancedParams, writes gridData + gridResultIds, requires polygons
modules/index.ts	Barrel export — re-exports everything and pre-registers example modules into defaultModuleInventory
How it works
Modules only talk to the context — all input comes from ConfiguratorContext, all output goes back into it. The BaseModule enforces this with getInputs(context) and writeOutputs(context, updates).

The inventory lets you see all modules and their contracts dynamically — getWorkflowRequiredDefinitions(workflow) resolves a workflow's steps into their ModuleDefinition objects, so the workflow builder can render the right components. validateWorkflow() checks the dependency chain (every step's required keys must be produced by an earlier step or seeded).

To add a new module, extend BaseModule and provide meta, io, and component:

class MyModule extends BaseModule {
  readonly meta = { id: "my-module", name: "My Module", ... };
  readonly io = { inputs: ["gridData"], outputs: ["myResult"], required: ["gridData"] };
  readonly component = MyComponent;
}
defaultModuleInventory.register(new MyModule());

---
