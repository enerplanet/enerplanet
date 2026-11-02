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
  - Open: resolved 2026-11-02 — `skipNode` now applies a skip-defaults path: the module's
    `defaults` are merged for declared output keys that are still absent (never
    clobbering existing values, undeclared keys filtered).

## Major

- [x] **M3 — no invalidation / data causality.** ✅ Resolved 2026-11-02.
  - Root cause: a done node never reruns; re-completing upstream does not reset downstream.
    Change region after grid generation ⇒ stale `gridData`/`powerFlowResult` while UI shows
    `done`. `Module.md` §6 semantics (`invalidates`, rerun-before-continue, loop guard,
    fingerprint) are absent.
  - Fix: `completeNode` detects redo (reactivation tracking + per-node output
    fingerprint); a changed redo resets every transitive downstream node to `pending`
    and clears its outputs (the graph is the invalidation map), then auto re-runs. No-op
    redos are inert. m5 (palette) fixed so redo is reachable. Verified by
    `workflow/NodeEngine.test.ts`.

- [x] **M4 — writer discipline is convention only, and already violated.** ✅ Resolved 2026-11-02.
  - Root cause: `updateContext` merges arbitrary partials; nothing validates writes against
    `io.outputs`. `region-select` writes `gridData`/`gridResultIds`
    (`RegionSelectModule.tsx:112`) not declared; `grid-generation` declares them but never
    writes. `region`/`polygons` have dual writers.
  - Fix: `validateGraph` enforces one-writer-per-key; contracts corrected — `region-select`
    owns area + grid generation, `grid-generation` is a checkpoint node (outputs none),
    `model-load` is a pre-seeder (not a producer; drops the phantom/one-writer collisions).
    `run()` outputs already filtered (C1). Deliberate exception: the interactive `onUpdate`
    path is not key-filtered (the shell + model-diff own `modelYaml`/edit-mode keys); the
    validator is the contract gate.

## Minor

- [x] **m5 — node palette never renders.** ✅ Resolved 2026-11-02. `ModelBuilderConfigurator.tsx:480`
      `activeNode?.id == "done"` — palette now renders unconditionally (also the redo/undo hook for M3).
- [x] **m6 — `activateNode` has no readiness check** — ✅ Resolved 2026-11-02. Activation
      now gates on `getReadyNodes` (deps done + required present) or reactivation of a
      done/skipped node; throws a clear error otherwise.
- [x] **m7 — `validateGraph` satisfiability only credits explicit `dependsOn` producers,** ✅ Resolved 2026-11-02
      but `buildGraph` adds implicit `io.required` edges ⇒ validator/runtime disagree. Now
      satisfied by any other producer (`WorkflowGraph.ts:281`) — required by the M4 ownership change.
- [x] **m8 — fresh runs read dead `advancedParams`.** ✅ Resolved 2026-11-02. power-flow
      reads `simulationSettings?.pypsa_enabled` first (typed, canonical) with
      `advancedParams` fallback in `run()` and component; unused `advancedParams` inputs
      dropped from `grid-generation`/`technology-selection`.

## Also worth deciding (from ARCHITECTURE.md §6)

- [x] Which workflows actually ship — ✅ Resolved 2026-11-02: `full-energy-planning` only.
      `quick-grid-analysis.json`/`cost-optimization.json` were unimported dead files and
      were deleted. Register new workflows when their modules are real, not as stubs.