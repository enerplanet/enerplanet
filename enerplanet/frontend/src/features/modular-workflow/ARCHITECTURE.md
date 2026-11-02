# Node Model Builder — Architecture (LIVING DOC)

> **Living document.** Canonical description of `features/modular-workflow` on branch
> `sk_node_modelbuilder`. This is the top-level doc: `README.md` (usage),
> `FLOW.md` (module-level flow / save pipeline) and `STATUS.md` (rebuild history)
> defer here. **Update this doc on every design change that lands**, the same pass
> you touch the code — never after the fact.

## Status header

- **Version:** 1.3 · **Last reviewed:** 2026-11-02
- **What changed since the last review:**
  - **v1.3 — remaining minors resolved (m6, m8, defaults-on-skip; dead workflows deleted).**
    m6: `activateNode` now gates on readiness (done/skipped re-activation still allowed for
    M3 redo). m8: power-flow reads `simulationSettings?.pypsa_enabled` (canonical) with
    legacy `advancedParams` fallback in both `run()` and component; unused `advancedParams`
    inputs dropped from `grid-generation` + `technology-selection` (contract hygiene).
    `skipNode` now applies a module's declared `defaults` to absent output keys.
    `quick-grid-analysis.json` + `cost-optimization.json` deleted (were never registered);
    `graph-validate.test.ts` now validates `full-energy-planning` + `defaultWorkflow`.
    Tests: 16 green.
  - **v1.2 — M3 + M4 resolved (m5, m7 folded in).** … (see below)
  - **v1.1 — C1 + C2 resolved.** Headless `run()`; auto nodes execute; skipped deps
    satisfied (see detail below).
  - **v1.0 — created the consolidated reference**, corrected doc-vs-code drift
    (only `full-energy-planning` is registered; `ev-hosting-analysis` does not exist).
- **Branches / state:** feature builds on `sk_node_modelbuilder`; it is gated behind
  `VITE_MODELBUILDER_ENABLED` (default off) at route `/app/modelbuilder`.

---

## 1. What it is

A **graph-based rebuild** of the monolithic configurator. The model is not built by a
fixed linear sequence but as a **node network**: each node runs one module (one logical
job), nodes declare their order via `dependsOn`, and a module only loads when the shared
context is **valid for it** (context-validity gating). This lets modules be **mixed and
matched** across workflows and lets `auto` nodes run themselves.

Design intent (unchanged): reproduce the exact legacy configurator result when pressing
**Save** in a full flow; decommission the legacy feature only at parity.

## 2. The data contract

Three types are the shared vocabulary. **Define or change these first** — the schema is
the contract between the workflow JSON, the engine, the shell and every module.

### 2.1 `WorkflowDefinition` → `WorkflowNode` (`types/workflow.ts`)

```ts
WorkflowNode {
  id: string;            // stable within the workflow
  moduleId: string;      // key into the ModuleInventory
  label: string;
  dependsOn?: string[];  // node ids that must complete first
  auto?: boolean;        // runs automatically when ready (no UI step)
  skippable?: boolean;   // user may skip
  inputMapping?/outputMapping?: Record<string,string>;
}
WorkflowGraph { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
NodeStatus = "pending" | "ready" | "active" | "done" | "skipped" | "error"
```

Workflows keep a **legacy `steps[]`** array alongside `nodes[]` for backward
compatibility with the old linear `WorkflowEngine`; the graph helpers prefer `nodes`.

### 2.2 `ModuleDefinition` / `BaseModule` (`types/module.ts`, `modules/base/BaseModule.ts`)

```ts
ModuleDefinition {
  meta: { id, name, category, defaultComplexity };
  io:   { inputs: string[]; outputs: string[]; required: string[] }; // context keys
  component: React.FC<{ context, onUpdate, complexity }>;
  defaults?: Record<string, unknown>;   // currently DEAD — never applied on skip
  validate(context): { valid, errors? };
  run?: (context) => Promise<Partial<ConfiguratorContext>>;  // headless work for auto nodes
  onEnter?/onLeave?: (context) => Promise<...>;  // lifecycle hooks (secondary)
}
```

`io` is the port contract: `inputs` = context keys read, `outputs` = keys written,
`required` = keys that must exist to run. Modules register via `registerAll()` in
`modules/index.ts` (the `defaultModuleInventory` singleton).

### 2.3 `ConfiguratorContext` — the single store (`types/context.ts`)

One store holds everything; modules never pass data to each other directly:

`workflowId/Version`, `nodeStates`, `activeNodeId`, `flowSnapshot`, `dataSources`,
`region`, `polygons`, `gridData`, `gridResultIds`, `gridStatistics`,
`buildingEstimates`, `buildingFilters`, `transformers`, `transformerAssignments`,
`technologies`, `techParameters`, `advancedParams` (legacy), `simulationSettings`,
`powerFlowResult`, `hostingCapacity`, `pipelineJob`, `costBreakdown`,
`modelYaml`/`previousModelYaml`/`modelYamlEditMode`, `modelName/modelId/workspaceId/
draftId`, `originalModel`.

## 3. The workflow — what actually runs

> **Ground truth is the JSON + registry.** Do not trust older doc descriptions of
> "four workflows" — verify against `workflows/*.json` and `workflows/index.ts`.

### Registered & runnable: `full-energy-planning`

`workflows/index.ts` registers **only** `fullEnergyPlanning`. It is the only workflow the
landing page offers. `quick-grid-analysis.json` and `cost-optimization.json` were dead
files (written, never imported) and were **deleted 2026-11-02**; `ev-hosting-analysis`
never existed. `defaultWorkflow.ts` (inline definition, id `quick-grid-analysis`) stays
exported for standalone route mounting.

**`full-energy-planning` node-graph** (from `workflows/full-energy-planning.json`):

| # | node | module | auto | skippable | dependsOn |
|---|------|--------|------|-----------|-----------|
| 1 | Import Model | `model-load` | — | ✅ | — |
| 2 | Simulation Settings | `simulation-settings` | — | ✅ | — |
| 3 | Select Region | `region-select` | — | ❌ | — |
| 4 | Generate Grid | `grid-generation` | ✅ | — | region-select |
| 5 | Area Edit | `area-edit` | — | ✅ | grid-generation |
| 6 | Building Demand | `building-demand` | — | ✅ | grid-generation |
| 7 | Technology Selection | `technology-selection` | — | ✅ | grid-generation |
| 8 | Power Flow | `power-flow` | ✅ | — | grid-generation, area-edit |
| 9 | Grid Statistics | `grid-statistics` | ✅ | — | grid-generation |
| 10 | Cost Breakdown | `cost-breakdown` | ✅ | — | grid-statistics |
| 11 | Save Model | `model-save` | — | ❌ | simulation-settings, region-select, grid-generation |

Every workflow begins with a `model-load` entry asking whether to import an existing
model; if yes it seeds `region`/`polygons`/`advancedParams` (+ metadata), if no it
proceeds with an empty context.

### Module I/O contract (as declared, `modules/*/index.ts`)

| module | inputs | outputs | required |
|--------|--------|---------|----------|
| `model-load` | — | advancedParams, sourceModelId (pre-seeder — distributes model into store via onUpdate without claiming graph ownership) | — |
| `simulation-settings` | — | simulationSettings | — |
| `region-select` | — | region, polygons, gridData, gridResultIds (owns area **and** grid generation — fires generateGrid on draw) | — |
| `grid-generation` | polygons, gridData, gridResultIds | — (checkpoint node — region-select is the writer) | polygons |
| `area-edit` | gridData, gridResultIds | transformers, transformerAssignments | gridData, gridResultIds |
| `building-demand` | gridData | buildingEstimates, buildingFilters | gridData |
| `technology-selection` | gridData | technologies, techParameters | gridData |
| `power-flow` | gridResultIds, advancedParams, simulationSettings | powerFlowResult | gridResultIds |
| `grid-statistics` | gridResultIds | gridStatistics | gridResultIds |
| `cost-breakdown` | gridStatistics, technologies | costBreakdown | gridStatistics |
| `model-save` | region, polygons, gridData, simulationSettings, modelName, workspaceId | modelId | polygons, simulationSettings |
| `model-diff` | modelYaml | modelYaml, previousModelYaml, modelYamlEditMode | — |

## 4. How it runs (execution model)

1. **`buildGraph(workflow)`** (`workflow/WorkflowGraph.ts`) derives `{ nodes, edges }`.
   Edges come from **two sources**: each node's explicit `dependsOn[]` **plus**
   contract-derived edges — for every `io.required` key, an edge from every node whose
   module `io.outputs` that key (via an output index). `WorkflowGraph.ts:68`.
2. **Context-validity gating — `getReadyNodes()`** (`WorkflowGraph.ts:153`): a node is
   `ready` when it is not `done/skipped/active`, every dependency edge is `done`
   (`WorkflowGraph.ts:139` — **only `done`, `skipped` does NOT count**), and its module's
   `io.required` keys exist in context (`canRunModule`).
3. **`NodeEngine`** (`workflow/NodeEngine.ts`) plays the graph: `activateNode` →
   `completeNode` / `skipNode`. On complete it runs `onLeave`, merges the module's
   `io.outputs`, marks `done`, then **auto-runs** any newly-ready `auto` nodes
   recursively (`runAutoNodes`, `:247`). **Auto nodes execute via the module's headless
   `run()`** (returned keys are filtered to `io.outputs`); modules without `run()` fall
   back to onEnter/onLeave + adopt pre-declared context keys. **Invalidation (M3):**
   re-completing a node (re-activated from the palette) whose output fingerprint changed
   resets every transitive downstream node to `pending` and clears its outputs — the
   graph itself is the invalidation map. Advance to the next interactive-ready node.
4. **Persistence / resume** (`workflow/FlowPersistence.ts`): a debounced `flowSnapshot
   { workflowId, workflowVersion, context, nodeStates, savedAt }` is saved to
   `localStorage` (`modular-workflow:flow`) on every context change; `ModelBuilderPage`
   offers a "Resume previous flow?" banner. Cleared on completion.
5. **Validation** (`graph-validate.test.ts`, `validateGraph`): every registered workflow
   is checked acyclic, all modules registered, each `io.required` key satisfiable by
   another producer or a seed (matching `deriveEdges`), **and one-writer-per-key (M4)** —
   a context key may be produced by exactly one node in the workflow.

## 5. Critical known issues — the ledger

> The execution model in §4 has structural defects that will surface in normal use. This
> table is the working list to drive the fix design; tick off rows as fixes land.

| ID | Sev | Issue | Evidence | Symptom | Status |
|----|-----|-------|----------|---------|--------|
| C1 | **Critical** | **Auto nodes execute nothing.** Work for every module lives in the React component's `useEffect`; no module defines `onEnter/onLeave`, and `runAutoNodes` never renders the component. It only merges pre-existing context keys and marks `done`. | `NodeEngine.ts:247`, `BaseModule.ts:94-98` (all optional), grep: zero `onEnter/onLeave` across modules | Power flow never actually runs (silent). Grid generation only "works" because region-select's component generated the grid and wrote undeclared `gridData`/`gridResultIds`. | ✅ **Resolved (2026-11-02)** — headless `run()` on the module contract; `runAutoNodes` executes `auto` nodes via `run()`. `grid-generation` + `power-flow` implement `run()`. Legacy path stays as fallback. Tests: `workflow/NodeEngine.test.ts`. |
| C2 | **Critical** | **Skipped dependencies block the graph forever.** `dependenciesDone` requires `=== "done"` — a `skipped` dep never satisfies. `model-load` outputs `region`/`polygons` (same keys region-select outputs) ⇒ every consumer of those keys also waits on model-load. Skip model-load (or skip `area-edit`, which `power-flow` depends on) ⇒ downstream stuck at `pending` ⇒ `isComplete()` never true. `skipNode` also never applies `defaults` (the field is dead code). | `WorkflowGraph.ts:139`, `deriveEdges:68`, `NodeEngine.ts:224` | Workflow deadlocks after a skip. | ✅ **Resolved (2026-11-02)** — `dependenciesDone` accepts `done || skipped`; the `io.required` context-presence gate still keeps nodes `pending` when a required key's only provider was skipped. Tests: `workflow/NodeEngine.test.ts`. `defaults`-on-skip still open (see §6). |
| M3 | **Major** | **No invalidation / data causality.** A done node never reruns; re-activating upstream (`region-select`) and completing it does not mark downstream stale. Change the region after grid generation ⇒ `gridData`/`powerFlowResult` stay stale while UI shows `done`. No `invalidates`, rerun-before-continue, loop guard, or fingerprint. | `NodeEngine.ts:195-218` (`completeNode`), shell `:232` re-render after reset | Stale downstream results presented as current. | ✅ **Resolved (2026-11-02)** — `completeNode` detects redo via reactivation tracking + a per-node output fingerprint; on a changed redo it resets every transitive downstream node to `pending` and clears their declared outputs (the graph is the invalidation map), then auto re-runs. No-op redos leave the pipeline intact. m5 (palette) fixed so redo is reachable. Tests: `workflow/NodeEngine.test.ts`. |
| M4 | **Major** | **Writer discipline is advisory, not enforced — and already leaking.** `ModuleProps.onUpdate` + `engine.updateContext` merge arbitrary partials; nothing validates writes against `io.outputs`. `region-select` writes `gridData`/`gridResultIds` not in its `io.outputs`; `grid-generation` *declares* them but never writes. `region`/`polygons` have two writers (`model-load` + `region-select`) ⇒ phantom ordering edges onto every consumer. | `RegionSelectModule.tsx:112`, `GridGenerationModule.tsx:30`, `NodeEngine.ts:152` | Dual-writer keys; contract drift. | ✅ **Resolved (2026-11-02)** — `validateGraph` enforces one-writer-per-key; contracts corrected (`region-select` owns area+grid; `grid-generation` checkpoint; `model-load` pre-seeder); `run()` outputs filtered to `io.outputs`. Deliberate exception: the interactive `onUpdate` path is not key-filtered (the shell + model-diff own `modelYaml`/edit-mode keys); the validator is the contract gate. |
| m5 | Minor | **Node palette never renders.** Shell gating `activeNode?.id == "done"` compares a node id to the literal string `"done"` — always false. | `ModelBuilderConfigurator.tsx:480` | Palette is dead UI. | ✅ **Resolved (2026-11-02)** — palette renders unconditionally (also the redo hook for M3). |
| m6 | Minor | **`activateNode` has no readiness check** — a pending node with unmet deps can be activated and run against an empty context. | `NodeEngine.ts:175` | Skipped/forward activation of incomplete nodes. | ✅ **Resolved (2026-11-02)** — activation gates on `getReadyNodes` (or reactivation of done/skipped); throws a clear error otherwise. |
| m7 | Minor | **`validateGraph` satisfiability only credits explicit `dependsOn`** producers, but `buildGraph` also adds implicit `io.required` edges ⇒ a valid implicit-edge workflow fails validation (conservative inconsistency). | `WorkflowGraph.ts:281-291` | Validator/runtime disagree. | ✅ **Resolved (2026-11-02)** — satisfiability credits any other producer (matches `deriveEdges`); required by the M4 ownership change. |
| m8 | Minor | **Fresh runs read dead `advancedParams`.** `grid-generation`/`power-flow`/`technology-selection` read `advancedParams`, which only `model-load` seeds and `simulation-settings` no longer writes (it writes `simulationSettings`). On a no-import run `advancedParams.pypsa_enabled` is `undefined` ⇒ power flow is effectively always off. | `PowerFlowModule.tsx:39`, `SimulationSettingsModule.tsx:245` | Power flow dead on default path. | ✅ **Resolved (2026-11-02)** — power-flow reads `simulationSettings?.pypsa_enabled` first (typed, canonical) with `advancedParams` fallback; unused `advancedParams` inputs dropped from `grid-generation`/`technology-selection`. |

## 6. Design decisions & open questions

- **Legacy `WorkflowEngine` + `steps[]`** kept for backward compatibility; the graph
  engine and node form are the forward path. Decided.
- **Headless execution** — `run()` on the module contract, executed by `auto` nodes
  (C1). Resolved 2026-11-02.
- **Invalidation** — redo via reactivation + per-node output fingerprint; transitive
  downstream reset (M3). Resolved 2026-11-02. Remaining refinement: selective/port-scoped
  invalidation and a loop guard are not yet in (the acyclic graph + fingerprint already
  prevent infinite recompute).
- **One writer per key** — enforced at graph-build (M4). Deliberate exception: the
  interactive `onUpdate` path stays unfiltered because the shell + model-diff own
  `modelYaml`/edit-mode keys; the validator is the contract gate. Decided.
- **Workflows that ship** — `full-energy-planning` only; the two dead JSONs were deleted
  2026-11-02 (register new workflows when their modules are real, not as stubs).
- **All ledger issues are resolved as of 2026-11-02.** Future work is not defects:
  module stubs (`grid-statistics`, `cost-breakdown`, `hosting-capacity`, `pipeline`,
  `building-demand`), selective/port-scoped invalidation, and optional key-level write
  filtering on the interactive path (see M4 exception).

## 7. Corrections to earlier docs (reconciliation)

`README.md`, `FLOW.md`, `STATUS.md` had drifted from code. The following are now stated
authoritatively here and are being corrected in the siblings:

1. **Only `full-energy-planning` is registered/runnable** — not "four workflows".
   `quick-grid-analysis.json` + `cost-optimization.json` were unimported dead files and
   were deleted 2026-11-02; `ev-hosting-analysis` never existed (STATUS referenced it).
2. **Entry node is `model-load`** in every workflow — older flow diagrams showed
   `simulation-settings`/`region-select` as the entry and omitted `model-load`.
3. **`grid-generation` and `power-flow` are NOT "✅ done / auto-runs"** — see C1: their auto
   execution is a no-op. Marking them done was inherited from pre-analysis STATUS text.

### Links

- `ToDo.md` — actionable task list mapped to §5 issue IDs (C1, C2, M3, M4, m5–m8). Tick both.
- `README.md` — usage, how to add modules/workflows, file layout.
- `FLOW.md` — module-level flow details + the legacy configurator save pipeline reference.
- `STATUS.md` — rebuild step history and per-module status.
- Upstream thesis convention: repo-root `Plan.md` + `Module.md` (invalidation semantics, module contract, coupling law).