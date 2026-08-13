# Node Modeller — Development Status (living document)

Plan: [`Plan.md`](Plan.md) · Backend needs: [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md)

**Legend:** ⬜ not started · 🟡 in progress · ✅ done

## Phases

| Phase | Scope                                                              | State |
| ----- | ------------------------------------------------------------------ | ----- |
| P1    | Context core (types, reducer, diffs, undo/redo, serialize) + tests | ✅    |
| P2    | Engine (runner, contracts, autofill) + adapter (http/local/mock)   | ✅    |
| P3    | Shell + Model Settings + Area/Grid nodes                           | ✅    |
| P4    | Demand + Technologies nodes                                        | ⬜    |
| P5    | Run + Results nodes                                                | ⬜    |
| P6    | History UI + branching                                             | ⬜    |
| P7    | Isolation mode (local adapter end-to-end)                          | ⬜    |

## Current state

- 2026-08-12 — Docs created: [`Plan.md`](Plan.md), [`BACKEND_REQUIREMENTS.md`](BACKEND_REQUIREMENTS.md), `STATUS.md`.
- 2026-08-12 — **P1 done.** `context/` (types, defaults, reducer with diff-based undo/redo, serialize). 15 reducer/serialization tests green.
- 2026-08-12 — **P2 done.** `engine/` (module contract, registry, runner, autofill, built-in workflows `default-planning` + `optimization`) and `adapter/` (`BackendAdapter` interface + http/local/mock). 12 engine tests green. **27/27 tests passing, `tsc -b` clean.** Notes: `techAssignments`/`pypsa` count as always-available slices (valid when empty); model-settings provides `pypsa` (advanced params live in node A); `context-load` workflows skip static contract checks (runtime autofill handles gaps). Next: P3 shell + first UI nodes.

- 2026-08-12 — **P3 done.** Shell (`components/NodeModeller.tsx` step nav + `UndoChip`), node UIs `ModelSettingsNode` (advanced pypsa collapsed) and `AreaGridNode` (own minimal OL `MapCanvas`, polygon draw → generate-grid → stats badge), placeholders for P4/P5 nodes. Host seam: `host/createAppAdapter.ts` + `host/NodeModellerPage.tsx` (only files importing app code; hydrate/serialize mappers are best-effort, TODO for P5 payload parity). Route `/app/node-modeller` registered, sidebar item added, i18n key `common.sidebar.nodeModeller` added to **en.json only** (other locales pending per maintainer). 27/27 tests green; `tsc -b` clean for node-modeller (one pre-existing AppLayout CSSProperties type conflict unrelated to this feature). Next: P4 Demand + Technologies nodes.

## Deferred (by design)

- Admin React Flow workflow builder + publishing (backend spec in BACKEND_REQUIREMENTS §2)
- User timeseries upload (backend spec in BACKEND_REQUIREMENTS §1)
- Server-side revision storage (BACKEND_REQUIREMENTS §3)

## Known blockers

- None.
