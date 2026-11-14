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
| `spec/core.md` | the core contract written as failing-first atomic tests (T1–T13, T20) — the thing being implemented |

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
| `replay.ts` | rebuild a projection from the log — the artefact's recovery path, and history's side of elision |
| `position.ts` | the flow's derived state: `done` / `stale` / `pending`, and where the session sits in it |
| `rerun.ts` | jump mechanics — the narrowed discard, the re-armed target, and the tail walk |
| `artefact.ts` | what persists a session: the projection, the log, the cursor, and the fingerprint that keeps them honest |
| `branch.ts` | "New Model" — full-duplex branching off the cursor, leaving the source untouched |
| `prompt.ts` | the edit-while-behind decision: three outcomes, no fourth path, and the payload that saves without sealing |
| `errors.ts` | `PortWriteRejected` (`undeclared` / `clobber`) and `MissingRequiredPorts` |

## `save/` — the backend seam and the save node

| file | what it holds |
|---|---|
| `gateway.ts` | the adapter interface this feature owns. **Call A** (`createModel` / `updateModel`) is the legacy payload; **Call B** (`saveSession` / `loadSession`) is the session artefact. The legacy side-effects of a create — finalising draft transformers, claiming the draft's series — live behind `createModel`, so the save logic never grows a legacy special case. |
| `httpGateway.ts` | the real adapter: the gateway bound to the backend over `@/lib/axios` (the app-wide, CSRF-aware client — not another feature's service module). The client is injectable so the endpoint paths and payload keys are pinned in tests. |
| `saveModel.ts` | the two-call save (T13): the legacy payload built from the ports, the flow-derived status, and a partial save reported rather than thrown away. |
| `saveNode.ts` | the `model-save` **node**: declares the whole persisted surface, requires `coordinates` (the backend resolves the country from them), and seals the save as one transaction. A refusal throws, so nothing is sealed. |

## `shell/` — the frame

| file | what it holds |
|---|---|
| `contract.ts` | the shell's front door to the core's contracts; re-exports only, so nothing in `shell/` reaches into the core by a drifting path |
| `moduleRegistry.ts` | the modules available to a workflow — listed **manually, on purpose**, and read by `toWorkflow` to build the core's registry |
| `workflow.ts` | turns a workflow definition (untrusted) into what the core takes: `Flow`, `ModuleRegistry`, seed ports. Refuses anything unwalkable |
| `workflow.dev.json` | the dev workflow itself: a seed and one node. Static now; hosted later, which changes one binding |
| `frameMode.ts` | which module the frame shows and what its session starts from: **workflow** mode (the node the session sits on, seeded from the flow) or **test mode** (one module, on its own test data, no position) |
| `barState.ts` | the workflow bar's state — prior / current / next, derived from `(flow, registry, store)` |
| `WorkflowBar.tsx` | the top band: workflow label, prior/current/next framing, a completion chip, **undo / redo / save**. A prior click is a module-wide undo, the next walks that tail back to the tip; each is a control only when it can actually move the session, and plain greyed text otherwise. Plus the dev-only mode select and Reset |
| `actions.ts` | the bar's actions. Thin by design (§3.1: every control maps onto a core operation): `undo`/`redo` go straight to the store, `undoToNode` is the module-wide undo behind a prior click, `redoToTip` walks the tail back to the tip, and `saveSession` is the bar's save with the status pinned to `incomplete` |
| `ledgerState.ts` | the ledger bar's state — the log with the cursor, newest first, each entry marked applied or discarded. No discard *structure*: the tail beyond the cursor is it |
| `LedgerBar.tsx` | the bottom band: collapsed it is the last applied transaction as a signed line plus the discard marker; expanded (⅕ of the frame) it is the whole log |
| `stepsState.ts` | the steps panel's state — every step's derived state, which one is current, and the *reason* behind a step that is not done (`pruned`, `blocked`) |
| `StepsPanel.tsx` | the right-hand band, a **sibling** of the module column so it keeps full height: a state-dot rail collapsed by default, labels and reasons when expanded to ⅓ |
| `BuilderShell.tsx` | the region frame (`sidebar` / `map` / `bottom` / `overlay`), composed from the module's declaration; re-seeds its session when the mode changes |
| `useStoreVersion.ts` | the host's subscription to the store: the store announces every applied change, this re-renders |

`/app/modelbuilder`, behind the `modelbuilder` runtime flag (Settings → Experimental — the sidebar entry is gated in the render path, so a toggle adds and removes it live).

## `core/` — a package, not a folder

`core/` is **`@model-builder/core`**: its own `package.json`, its own tsconfig, its own vitest config, and
its own install. It holds the contract (ports, the module contract, the view contract), the store, the
engine and the history primitives, and it imports nothing from this app — that is what lets a module
depend on it, and only on it, from a workspace of its own.

The app declares it as a `file:` dependency (`"@model-builder/core": "file:./src/features/model-builder/core"`),
the same mechanism already used for `@spatialhub/*`, so npm symlinks it into `node_modules` and both vite
and tsc resolve the specifier with no alias config.

```bash
cd src/features/model-builder/core && npm install && npm run verify   # standalone: typecheck + tests
```

## `modules/` — one workspace per module

`modules/README.md` is the developer guide: the two packages a module depends on, the contract, the rules
the core *checks* (declared ports, anti-clobber, `required`, verified `affect`), the regions, how to add a
module, how to test one, and how to work on one without the app. `example/` is the reference shape and the
proof the shell wiring works end to end — and it is a workspace in its own right:

```bash
cd src/features/model-builder/modules/example && npm install && npm run verify
```

## `load/` — opening a session

| file | what it holds |
|---|---|
| `loader.ts` | the Loader (`Plan.md` §9): the artefact comes back from its own call, `fromArtefact` adopts the stored projection **without replaying**, and the flow is reattached **by reference** — returning the re-derived position and node states, which is what T18 asks for. A model with no session is `{ kind: "none" }`, an answer rather than an error. |

The payload shape is pinned against `.local/ModularThesis/prototypes/sk-node-workflow/integration/saveService.ts`, a verbatim extraction of the legacy `saveAreaData` — that extraction is the oracle `save/saveModel.test.ts` checks against. Two deliberate differences: the config is **never absent** (an unfinished flow sends `{}` rather than `undefined`, because Call A requires one and a half-built model should look unfinished), and the status comes from the flow (`incomplete` / `draft` / `modified`) instead of a fingerprint comparison.

Implemented so far, all green: **T1–T8, T10–T11, T14–T21** (one sealed transaction
per action; undeclared-port writes rejected; anti-clobber; undo restores pruned downstream edits
exactly; the discard tail; redo re-derives the cascade; undo skips auto work and lands on the
interactive boundary; undo alone never writes; per-commit vs at-completion sealing; the cascade
as affected closure ∩ present ∩ not-superseded; influence honesty verified per module; gating by
available-set with the builder and the validator sharing one predicate; and the runtime store
gate that refuses a node whose required ports are absent). T20 covers the jump transaction, the
derived position and the re-run: a jump's discarded values ride in its own `cascade`, the session's
position is read off `(projection, log, cursor)` rather than stored — so undo repositions the flow
for free — and walking the tail re-runs only the nodes the jump actually invalidated, eliding the
rest. T18 makes a session persistable: the artefact carries the projection, the log, the cursor and
a fingerprint of the projection, so a load is instant (no replay) while undo and redo still work,
and replay stays the recovery path rather than the load path. T17 branches a session full-duplex: a
copy of the state at the cursor and of the log prefix, plus the pending edit as the branch's own
first transaction, while the source keeps its log, cursor and redo tail exactly as they were. T19
resolves the edit-while-behind prompt with exactly three outcomes and no fourth path, and supplies
the payload that saves the current model without sealing it — so a failed save or copy leaves the
session exactly as cancel would. T13 saves a session in two calls, A first: the legacy payload (whose
shape is pinned against the extracted legacy `saveAreaData`), then the artefact through the isolated
session API — with `incomplete` while the flow is unfinished and a failed second call reported rather
than losing the model that was just created. Its framing is closed: the adapter interface plus the real
`httpGateway`, the `model-save` node, and the Loader that opens a session and reattaches the flow by
reference. Left: the modules themselves (built one at a time in the shell, against mock data), the
workflow link-up that replaces the shell's manual picker, and adopting a legacy model's `config` into
a builder session.

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
