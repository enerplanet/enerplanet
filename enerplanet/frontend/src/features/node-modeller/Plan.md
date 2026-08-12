# Node Modeller — Implementation Plan

Interpretation of [`README.md`](README.md) + [`README_V2.md`](README_V2.md), informed by [`VALIDATION.md`](VALIDATION.md).

**Scope constraint:** fully isolated component under `frontend/src/features/node-modeller/`. Nothing in `features/configurator` (or any other feature) is imported or modified. Backend calls go through a single adapter interface; no backend changes in this phase.

**Living documents:** [`STATUS.md`](STATUS.md) tracks development state per phase; [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md) specs the new APIs/DB changes behind stubbed adapter methods (Postgres+PostGIS, no object DB).

---

## 1. Guiding decisions

| #   | Decision                                                             | Rationale (from VALIDATION.md)                                                                                                                                   |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Context core first** — pure TS, no UI                              | README_V2 marks it the mandatory foundation; trivially testable                                                                                                  |
| 2   | **Hardcoded default workflow**, engine executes it                   | Defer the admin visual builder (rec. 3) — workflows are JSON data, React Flow editor comes last                                                                  |
| 3   | **Diff-based history from day one, branching minimal**               | Diffs + undo/redo are nearly free via the reducer; full Git-style branching is V2 scope — we ship "branch from revision" without merge                           |
| 4   | **Adapter inversion for all I/O**                                    | Real adapter → existing API routes; mock adapter → tests; local adapter → isolation mode (download `.enerplanet.json`)                                           |
| 5   | **Port, don't share** — rewrite needed UI pieces against the context | No coupling to configurator; its code serves only as reference                                                                                                   |
| 6   | **New backend endpoints stubbed in adapter**                         | Timeseries CRUD + workflow CRUD are adapter methods returning "not supported" until backend lands — spec in [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md) |

## 2. Module layout

```
node-modeller/
├── context/            # Aspect 1 — pure, no React
│   ├── types.ts        # ModelContext, slices, ContextAction, ContextDiff
│   ├── reducer.ts      # apply(ctx, action) → { next, diff } + undo/redo
│   ├── defaults.ts     # getDefaultMeta/Pypsa/... per slice
│   └── serialize.ts    # to/from JSON (isolation download format)
├── engine/             # Aspect 2/3 core — pure
│   ├── types.ts        # NodeModule, WorkflowDefinition, ValidationResult
│   ├── registry.ts     # built-in node modules
│   ├── runner.ts       # sequential execution + contract checks
│   ├── autofill.ts     # insert missing dependency nodes on context-load
│   └── workflows/      # JSON definitions (default-planning, optimization)
├── adapter/            # BackendAdapter interface + implementations
│   ├── types.ts        # interface (models, pylovo, technologies, results, timeseries*, workflows*)
│   ├── http.ts         # real adapter (axios, existing routes)
│   ├── local.ts        # isolation: download/upload .enerplanet.json, localStorage model list
│   └── mock.ts         # test adapter
├── nodes/              # UI per workflow node (Aspect 2 + 6)
│   ├── ModelSettingsNode.tsx
│   ├── AreaGridNode.tsx        # map, polygon draw, grid stats badge
│   ├── DemandNode.tsx
│   ├── TechnologiesNode.tsx    # select→assign→configure sub-loop
│   ├── RunNode.tsx
│   ├── ResultsNode.tsx         # results + Optimize/New/Branch exits
│   └── shared/                 # context-driven side panel, node help
├── history/            # Aspect 5
│   ├── HistoryPanel.tsx        # timeline, undo/redo chip, run comparison
│   └── branch.ts               # snapshot-at-revision → new context (parentId)
├── components/         # shell
│   ├── NodeModeller.tsx        # entry: engine + context provider + step nav
│   └── ContextPanel.tsx        # single side panel (replaces modal sprawl)
└── __tests__/          # vitest, mirroring structure above
```

## 3. Implementation phases

Each phase is self-contained and shippable.

**P1 — Context core + tests.** Types, reducer, diffs, undo/redo, serialization, defaults. Vitest round-trip suite. _No UI._

**P2 — Engine + adapter.** `NodeModule` contract, runner, JSON workflow definitions (default-planning + optimization), `BackendAdapter` interface with http/local/mock implementations. Engine tests with mock adapter.

**P3 — Shell + first two nodes.** `NodeModeller` shell (step nav, context provider, side panel), Model Settings + Area/Grid nodes (OpenLayers map owned by this feature), save/load via adapter.

**P4 — Demand + Technologies nodes.** Estimate-energy batch, tech assignment sub-loop, context-driven side panel.

**P5 — Run + Results.** Start calculation, poll status, results views, post-results exits (Optimize / New / Branch).

**P6 — History UI + branching.** History panel, persistent undo/redo chip, run comparison, branch-from-revision with origin link.

**P7 — Isolation mode polish.** Local adapter end-to-end: download `.enerplanet.json`, local model list, no auth/network.

**Deferred (documented, not built):** admin React Flow workflow builder + publishing RBAC (Aspect 3 UI), user timeseries upload UI (Aspect 4, needs backend), server-side revision storage. Adapter interfaces reserve the methods so these slot in without refactors.

## 4. Testing strategy (Aspect 7)

- **Pure first:** reducer, engine, autofill, branching — no DOM, highest value.
- **Module tests:** each node with `mock` adapter, assert context after run.
- **Component tests:** map/side-panel interactions emit the right `ContextAction`s.
- **No tests import anything outside `node-modeller/`** — enforced by keeping all imports relative.

## 5. Key risks

| Risk                                                     | Mitigation                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Map code duplication vs. configurator                    | Accepted deliberately (isolation); shared extraction is a later, separate decision |
| Backend lacks timeseries/workflow/revision endpoints     | Adapter stubs; feature degrades gracefully                                         |
| Diff storage growth in history                           | Compact on save (V2 §5.3); cap redo stack                                          |
| Run/status polling semantics unknown per backend version | Encapsulated entirely in `http.ts` adapter                                         |
