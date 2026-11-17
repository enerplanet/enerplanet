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
  the first and computes verdicts per position, but the tabbed multi-candidate choice and the ask at
  run time are not built — the verdict function is already the seam.
- **`skippable`** — declared in the core's node shape and read by nothing. It is what an optional step
  needs, and the second `result-overview` pass is its first customer.
- **A run's record is not tied to what was persisted.** A run reads `modelId`, which a configuration
  edit never moves, so editing and re-saving *after* a run finished does not invalidate that run. The
  flows that exist put the run after the save, so it does not bite; closing it means the save
  publishing a revision of what it persisted, which the run nodes then require.
