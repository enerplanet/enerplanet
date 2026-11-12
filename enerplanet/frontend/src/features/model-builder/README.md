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
| `module.ts` | the module contract: `params`, `affect`, `layout`, `seal`, `run`, `validate` |
| `diff.ts` | reversible `DiffOp`s, sealed `Transaction` (carrying `nodeId` + `auto`), pure path application |
| `store.ts` | the projection + the append-only transaction log + the undo/redo cursor (one write path) |
| `engine.ts` | runs a module as one workflow node, enforces the write boundary, seals transactions |
| `invalidator.ts` | stages the cascade: the affected closure, minus what cannot be pruned |
| `fingerprint.ts` | stable value fingerprints — key order must not matter, array order must |
| `flow.ts` | gating: the available-set, the palette, and the validator — one predicate, applied twice |
| `influence.ts` | the influence-honesty prober: verifies a module's `affect` instead of trusting it |
| `errors.ts` | `PortWriteRejected` (`undeclared` / `clobber`) and `MissingRequiredPorts` |

Implemented so far, all green: **T1–T8, T10–T11, T14–T16 and T21** (one sealed transaction per
action; undeclared-port writes rejected; anti-clobber; undo restores pruned downstream edits
exactly; the discard tail; redo re-derives the cascade; undo skips auto work and lands on the
interactive boundary; undo alone never writes; per-commit vs at-completion sealing; the cascade
as affected closure ∩ present ∩ not-superseded; influence honesty verified per module; gating by
available-set with the builder and the validator sharing one predicate; and the runtime store
gate that refuses a node whose required ports are absent). Not written yet: the flow position +
re-run/elision + loopback (T20, T12), the artefact (T18), branching + the prompt (T17/T19) and
the save node (T13).

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
- **The cursor only rests on an interactive boundary.** Undo unwinds the trailing step *and*
  any auto node's work below it, and reports what it unwound (`{ transactions, nodeIds }`) so
  the shell can say *"undid: power-flow (auto), area-edit"*. Auto nodes run **only as part of a
  forward action** (activate / complete / redo) — never on a passive state change — because
  otherwise undo would be a silent no-op: the auto node's deps look satisfied again and it
  immediately re-runs. Both prototypes violated this (`runAutoNodes()` from `updateContext`).
- **Seal granularity is the module's call.** `seal: "at-completion"` (default) seals one
  transaction for the whole `run()`; `seal: "per-commit"` seals one atomic transaction per
  `commit()`, which buys field-level undo for modules whose writes are independent
  (settings fields) and is wrong for interdependent ones (`grid-generation`).
