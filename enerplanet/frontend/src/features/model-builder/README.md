# Model Builder

Modular, workflow-driven rebuild of the legacy configurator (`features/configurator`, ~13k LOC).
Built **beside** the legacy feature and decommissioned only at parity — the legacy feature is never
modified in the process. Route `/app/modelbuilder`, gated by the `modelbuilder` feature flag
(Settings → Experimental → *Model Builder*).

## Hard boundary rule

Everything this feature needs lives in this directory. **Nothing outside `features/model-builder/`
may be changed**, with one exception: a change outside is allowed only if it is purely **additive**
(one line registering a route, one sidebar entry). Any edit to existing outside code needs an
explicit request first. The core must not import from `features/configurator` or any other feature;
backend I/O goes through an adapter this feature owns.

## `core/` — a package, not a folder

`core/` is **`@model-builder/core`**: its own `package.json`, tsconfig, vitest config and install. It
holds the contract (ports, the module contract, the view contract), the store, the engine and the
history primitives, and imports nothing from this app — which lets a module depend on it, and only on
it, from a workspace of its own. The app declares it as a `file:` dependency
(`"@model-builder/core": "file:./src/features/model-builder/core"`), so npm symlinks it into
`node_modules`.

```bash
cd src/features/model-builder/core && npm install && npm run verify   # standalone: typecheck + tests
```

## `modules/` — one directory per module

`modules/README.md` is the module author's guide: the contract, the rules the core checks, the
regions, and how to add, test and work on a module without the app. The two templates a new module is
copied from live under `modules/examples/` (not registered modules, not installable in place). Most
modules are workspaces of their own (`building-configurator/` is the exception).

```bash
cd src/features/model-builder/modules/area-draw && npm install && npm run verify
```

## Commands

```bash
# from enerplanet/frontend
npx vitest run src/features/model-builder   # this feature only
npx vitest run                             # whole frontend suite
npx tsc -p tsconfig.app.json --noEmit      # typecheck
npx eslint src/features/model-builder --ext .ts,.tsx
```

## History — a move is a view, a run is a commit

The feature's history is **commit-oriented**. Three things, and each owns
exactly one fact:

- the **commit log** is append-only: every entry (`core/diff.ts`'s `Transaction`) is enacted work with
  a diff, and nothing rewrites an entry in place;
- the **view** is where the session is *looking* — a read-only pointer, never a commit;
- the **transcript** is the flow actually enacted: the session's placed flow, plus every commit's
  placement, in log order (`core/flow.ts`'s `transcript`).

What follows from that:

- **A move writes nothing.** Stepping back to look at an earlier node sets the view; there is no
  `jump` transaction, so nothing goes stale and no redo tail is produced. The module on screen then
  renders **the state that node was committed with** (`shell/viewedProjection.ts` replays the log up
  to that commit's revision), while everything else — the position, the steps panel — keeps
  describing the current world. Acting snaps the view back to the tip, so a run reads the live state.
- **A run appends a placement.** A run targets a placement: one with no commit is **filled**, one
  that already ran gets a **successor placement** with a fresh id — `"<n>-<name>"`, `n` counting up
  from `0` over every placement ever added and never reused (`core/rerun.ts`). The flow *grows*: the
  transcript of a change-and-repair loop is `A B C D E C D E`, the earlier occurrences kept as the
  superseded ones. A completed run that wrote nothing still leaves its zero-diff trace, because a
  placement is `done` only once it has a commit (`core/engine.ts`).
- **Undo and redo are rollback commits.** An undo appends a commit whose `primary` is the inverse of
  the target's change + cascade, carrying `rollback: { of }` and no placement; a redo inverts a
  rollback. Nothing is truncated and nothing is rewritten — the log only ever gains an entry
  (`core/store.ts`).
- **The flow is a transcript, not a fixed plan.** "The history presents the final flow that was
  enacted on a model" is literal: `workflow.json` defines only the starting point.

Everything the shell shows derives from `(flow, registry, store)` — the workflow bar, the steps
panel, and the ledger (which reads `store.log`, newest first). None of them holds history of its own.

## The session artefact

A session persists as an **artefact** (`core/artefact.ts`):
`{ version, workflow, modelId?, initial, projection, flow, log, fingerprint }`. The **`flow`** field
is the **placed flow** — the session's seed placements plus any appended ones, **including the nodes
that have not run yet** — written on save and read back on load, so the run-side never re-derives the
plan. There is no `cursor` and no `discarded` section: a move is not persisted, and there is no redo
tail to record. The `projection` is the fast path and the `log` the recovery path; the fingerprint
stops the two from lying to each other silently.

## Suggested next steps

A workflow may declare **suggested next steps** (`workflows/types.ts`, the `recommended` field): follow-up
steps offered to the user to **append** once a run (or a compare) has finished — the malleable-flow side of
"we start with a predefined workflow and add to it". They are a **plain list**, applied to the chain's **last
node**, so nothing needs re-anchoring when the chain is edited. Each carries a title, a `description` stating
its goal, and a **key derived once from the title** — a functional handle the edit helpers match on, never
shown and never typed. A step may be a **module or a workflow**.

Appending one is a **plan addition** (`workflows/recommended.ts`): it grows the placed flow by fresh
placements, validated like any other, so a suggestion can never append a broken node — a subflow is flattened
into its module nodes first, because a subflow is never a runtime node. `recommendedFor` decides what is on
offer, once the last placed node has finished; `takeableSections` drops what this build cannot run — a module
it does not declare, or a workflow no longer stored.

## The flows this feature runs

Two stored workflows are seeded (`cmd/seed/`), and the editor authors more.

- **The default flow** — `… → model-save → run-calliope → run-pypsa → result-overview`. It is what
  the builder loads when nothing is requested. **It really runs models**: walking past the save to
  the run nodes submits a real MEME run, which takes minutes and spends compute. There is no dry-run
  mode.
- **The variant flow** (`?workflow=<id>`) — `model-save → model-variant → adjust → run → run →
  compare-variant`. `?workflow=` sits beside the existing `?model=<id>` and loads a named stored
  workflow; with no request the default is used.
- **A subflow node** (`{ id, workflows: […] }`, not a module) is expanded in place by the loader,
  each composed node's id namespaced by its container. A **fragment** is a stored workflow whose
  document says `isSubflow: true`: authored without standalone validation and offered as an insert.

## Not built yet

Planned, and known rather than hidden:

- **`grid-editor`** — moving and deleting transformers. The generated grid is what we validate against.
- **Loading an existing model** — the data layer is done (`load/unfold.ts` lifts a saved config back
  into the store's ports, round-trip tested); the UI to browse saved models is not there.
- **Several candidates at one position.** A subflow node's `workflows` is a list; the editor renders
  the first and computes verdicts per position (`workflows/gate.ts`), but the tabbed multi-candidate
  choice and the ask at run time are not built — the verdict function is already the seam.
- **`skippable`** — declared in the core's node shape and read by nothing. It is what an optional step
  needs, and the second `result-overview` pass is its first customer.
