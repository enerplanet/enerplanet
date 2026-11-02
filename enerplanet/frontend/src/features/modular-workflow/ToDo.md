# Node Model Builder — To Do

> Working task list for the `features/modular-workflow` execution defects.
> Canonical analysis, code evidence, and issue IDs live in
> [`ARCHITECTURE.md`](ARCHITECTURE.md) §5 (the ledger). Tick items off here **and** the
> ledger in the same pass. Order matters: C1 and C2 unblock the rest.

## Critical

- [x] **C1 — auto nodes execute nothing.** ✅ Resolved 2026-11-02.
  - Root cause: `NodeEngine.runAutoNodes` (`NodeEngine.ts:247`) marks a node `done`
    without rendering its component; every module's real work lives in a React `useEffect`
    (grid gen `GridGenerationModule.tsx:63`, power flow `PowerFlowModule.tsx:42`) and no
    module defines `onEnter`/`onLeave`.
  - Consequence: `grid-generation`, `power-flow`, `grid-statistics`, `cost-breakdown` are
    all no-ops on the auto path. `power-flow` never runs; `grid-generation` only appears to
    work because the region-select component pre-wrote `gridData`/`gridResultIds`.
  - Fix direction: headless `run()` on the module contract; `runAutoNodes` executes `auto`
    nodes via `run()`. `grid-generation` + `power-flow` implement `run()`. Legacy
    onEnter/onLeave path kept as fallback. Verified by `workflow/NodeEngine.test.ts`.
    `grid-statistics`/`cost-breakdown` are stubs and get `run()` as they're built.

- [x] **C2 — skipping a dependency permanently deadlocks the graph.** ✅ Resolved 2026-11-02.
  - Root cause: `dependenciesDone` (`WorkflowGraph.ts:139`) requires `=== "done"`; a
    `skipped` dependency never satisfies. `deriveEdges` also adds implicit edges from
    `io.required` producers, so `model-load` (outputs `region`+`polygons`,
    `ModelLoadModule.tsx:35`) blocks every consumer (`grid-generation`, `pipeline`,
    `model-save`) when skipped. In `full-energy-planning`, `power-flow` depends on the
    skippable `area-edit` ⇒ skip → workflow never completes.
  - Fix: `dependenciesDone` accepts `done || skipped`; the `io.required` context-presence
    check in `getReadyNodes` stays the real gate (no garbage runs). Verified by
    `workflow/NodeEngine.test.ts`.
  - Open (not part of criticals): `skipNode` never applies `defaults` — decide for a
    sole-optional-provider skippable module.

## Major

- [ ] **M3 — no invalidation / data causality.**
  - Root cause: a done node never reruns; re-completing upstream does not reset downstream.
    Change region after grid generation ⇒ stale `gridData`/`powerFlowResult` while UI shows
    `done`. `Module.md` §6 semantics (`invalidates`, rerun-before-continue, loop guard,
    fingerprint) are absent.
  - Fix direction: add `invalidates` to nodes/modules; on upstream re-complete, reset
    invalidated downstream nodes to `pending`, clear their produced keys, rerun `auto`,
    loop-guard once-per-pass, fingerprint writes.

- [ ] **M4 — writer discipline is convention only, and already violated.**
  - Root cause: `updateContext` merges arbitrary partials; nothing validates writes against
    `io.outputs`. `region-select` writes `gridData`/`gridResultIds`
    (`RegionSelectModule.tsx:112`) not declared; `grid-generation` declares them but never
    writes. `region`/`polygons` have dual writers.
  - Fix direction: enforce writes against `io.outputs` in the engine; validate
    one-writer-per-key at graph build. Decide the importer special case: `model-load`
    seeds the store (region/polygons/advancedParams) — treat it as a pre-seeder, not a
    producer, so it doesn't violate the rule.
  - Partial (2026-11-02): the **auto** path now filters `run()` outputs to declared keys
    (`mergeRunOutputs`). Interactive `onUpdate` path still unvalidated.

## Minor

- [ ] **m5 — node palette never renders.** `ModelBuilderConfigurator.tsx:480`
      `activeNode?.id == "done"` compares a node id to the literal string `"done"`.
- [ ] **m6 — `activateNode` has no readiness check** (`NodeEngine.ts:175`) — a pending node
      with unmet deps can be activated and run against an empty context.
- [ ] **m7 — `validateGraph` satisfiability only credits explicit `dependsOn` producers,**
      but `buildGraph` adds implicit `io.required` edges ⇒ validator/runtime disagree
      (`WorkflowGraph.ts:281`).
- [ ] **m8 — fresh runs read dead `advancedParams`.** `grid-generation`/`power-flow`/
      `technology-selection` read `advancedParams`, which only `model-load` seeds and
      `simulation-settings` no longer writes ⇒ `advancedParams.pypsa_enabled` is undefined
      on a no-import run ⇒ power flow effectively off by default (`PowerFlowModule.tsx:39`).

## Also worth deciding (from ARCHITECTURE.md §6)

- [ ] Which workflows actually ship — wire `quick-grid-analysis.json`/`cost-optimization.json`
      into `workflows/index.ts` or remove them. (`ev-hosting-analysis` doesn't exist.)