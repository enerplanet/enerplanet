# Model Builder

Modular, workflow-driven rebuild of the legacy configurator
(`features/configurator`, ~13k LOC). Built **beside** the legacy feature as a sibling and
decommissioned only at parity — the legacy feature is never modified in the process.

## Hard boundary rule

Everything this feature needs lives in this directory. **Nothing outside
`features/model-builder/` may be changed**, with one exception: a change outside is allowed
only if it is purely **additive** (one line registering a route, one sidebar entry). Any
edit to existing outside code needs an explicit request first.

Corollaries:

- The core must not import from `features/configurator` or any other feature. Backend I/O
  goes through an adapter interface this feature owns.
- The feature is gated by the `modelbuilder` feature flag (registered in
  `features/settings/flags.ts`, which lives on `dev`): `useFeatureFlag("modelbuilder")` or
  `<FeatureFlagGate flag="modelbuilder">`.

## Architecture

The authoritative documents are outside the repo tree, in `.local/ModularThesis/`:

| Doc | What it holds |
|---|---|
| `Plan.md` | the architecture and its four invariants (single store, one reducer, sealed influence-aware cascade, vector-keyed ports) |
| `Modules.md` | the module contract, the port catalog, the module catalog |
| `spec/core.md` | the core contract written as failing-first atomic tests (T1–T13) — the thing being implemented |

## `core/` — the React-free core

| File | Responsibility |
|---|---|
| `ports.ts` | the port catalog: `PortKey`, `ModelData`, energy vectors (an open set) |
| `module.ts` | the module contract: `params`, `affect`, `layout`, `run`, `validate` |
| `diff.ts` | reversible `DiffOp`s, sealed `Transaction`, pure path application |
| `store.ts` | the projection + the append-only transaction log (one write path) |
| `engine.ts` | runs a module, enforces the write boundary, seals one transaction |
| `errors.ts` | `PortWriteRejected` (`undeclared` / `clobber`) |

Implemented so far, all green: **T1–T3** (one sealed transaction per action; undeclared-port
writes rejected; anti-clobber). History/undo (T4–T6), the invalidator (T7–T8), gating
(T10–T12) and the save node (T13) are not written yet.

## Commands

```bash
# from enerplanet/frontend
npx vitest run src/features/model-builder   # this feature only
npx vitest run                             # whole frontend suite
npx tsc -p tsconfig.app.json --noEmit      # typecheck
npx eslint src/features/model-builder --ext .ts,.tsx
```

## Design notes worth knowing before you touch the core

- **Atomicity is by construction.** A transaction is sealed only after `run()` returns,
  so a module sees the pre-state for its entire run, and a rejected write means nothing
  happened at all.
- **Reading licenses rewriting.** `ctx.read(port)` marks a port as consumed; a write to a
  port that already holds a value is rejected with reason `clobber` unless it was read.
  Adding a port that is absent needs no read. This is anti-mistake, not anti-attack.
- **`ctx.store` is for inspection.** It is never mutated — modules build new values. Nested
  diff paths address object keys (`/buildingParams/electricity`), not array indices.
- **No-op writes produce no op.** A write whose value is reference-equal to the current one
  is dropped, and a run that changed nothing seals no transaction.
