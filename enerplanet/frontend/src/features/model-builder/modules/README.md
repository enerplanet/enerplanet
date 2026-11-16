# Modules

One directory per module, and **each directory is its own workspace**. This is the guide: what a module
is, what it may touch, how to add one, how to test one, and how to work on one without ever booting the
app.

**Start here:** `example/` is a working module and the template. Read it before you write anything —
`scripts/new-module.mjs` copies it for you, so you mostly need to recognise the parts.

## The two packages a module depends on

A module imports **`@model-builder/core`** and nothing else from this repo. That single rule is what makes
a module portable and keeps the contract honest:

| package | where | what it is |
|---|---|---|
| `@model-builder/core` | `../core` | the contract: ports, the module contract, the view contract, the store, the engine, the history primitives — and `testSupport` for your tests. Dependency-free TypeScript, no build step. |
| `@spatialhub/i18n` | `../../../../../../../libs/i18n` | translation, for a module's UI. The **host** provides the provider at runtime; a module only needs the package to typecheck and test. |

Both are declared in the module's `package.json` as `file:` dependencies — exactly the way the app
declares `@spatialhub/*` — so `npm install` here links them into the module's **own** `node_modules`.

## What a module is

A module is three things bound together:

| part | where | what it is |
|---|---|---|
| the **core contract** | `@model-builder/core` (`defineModule`) | the declared port surface (`params`), the declared influence (`affect`), `run()`, `validate()` — and `layout`, the harness regions its UI wants |
| the **UI** | `index.tsx` | one component, rendered **once per region the module declared** |
| the **mock** | same file | the inputs the module needs to be developed in isolation: the seed of the scratch store |

`index.tsx` default-exports a `BuilderModule` — `{ module, Component, mock? }`, all three typed in the
core's `view.ts`.

## Rules the core enforces (checked, not conventional)

- **Declare what you touch.** A write to a port missing from `params` is rejected as `undeclared`.
- **Read before you overwrite.** Writing a port that already holds a value without reading it first is
  rejected as `clobber` — the anti-clobber rule.
- **`required` means "must already exist".** The flow gate keeps such a module unplaceable, and the
  engine refuses to run it at all (`MissingRequiredPorts`).
- **`affect` is verified, not trusted.** `core/influence.ts` probes every registered module and fails an
  under-declared one; over-declaring is only reported.
- **`run()` is the only write path.** It commits; nothing else may reach the store. Every commit is
  undoable and sealed together with the cascade it invalidated. A run that changes nothing still seals one
  transaction — a **zero-diff** one, with no ops — because a jump re-arms its target and the re-arm has to clear
  on a newer transaction, never on an edit the user did not make. (An `auto` node is the exception: a jump's
  re-arm does not apply to it, since there is nothing to re-apply, and it either passes over as done or was
  pruned by a real input change — T15.)

`example/index.test.ts` demonstrates each of these by trying to break them, which is the quickest way to
see what the boundary actually refuses.

## Regions

`layout: Region[]` names where the UI mounts. The host composes the page; a module never does — and a
module that declares nothing is headless. An `auto` node still runs headlessly (it has no forward action), but
it declares the `overlay` slot so it can show its own run state — in progress / done / failed — full-screen while
the session sits on it. The frame:

```
┌ header (host-owned: title · prior/current/next · undo/redo/save · dev mode select) ┐
├──────────┬───────────────────────────────────────┤
│ sidebar  │ map        ← the main area (flex-1)   │
│ w-80     ├───────────────────────────────────────┤
│          │ bottom     ← footer bar, capped at ¼ │
└──────────┴───────────────────────────────────────┘
   overlay  ← scoped to the content area, above all of it
   steps panel (host-owned, the frame's right-hand band)
   error strip (host-owned, only when something throws)
```

| slot | what it is | what the module gets |
|---|---|---|
| `sidebar` | the primary panel: forms, settings, lists, a fixed `w-80` column on the left | — |
| `map` | **the map host's slot** — the engine's canvas fills it and your controls render over it in a pass-through layer (see "Putting UI on the map") | `MapService` |
| `bottom` | a footer bar across the content area: status, summaries, stats | — |
| `overlay` | a full-screen panel above everything, opened and closed on demand | `OverlayControl` |

The `map` region's `MapService` — the A–H surface: `requestPoint`/`requestPolygon` (create geometry and return
it), `onElementClick`, `createLayer`/`removeLayer`/`addFeatures`/`clearLayer`, `setInteractiveLayer`,
`getLayerOrder`/`setLayerOrder`, `fitTo` — is
a transient interaction service, **not model state**: it holds render/interaction state only, and anything
a module must keep (a drawn polygon, a selection) is committed to the store as a normal transaction. The
map host never writes the store.

### The engine is MapLibre

The provider renders with **MapLibre only**, 2D and 3D from one engine: a raster/vector basemap, and 3D as a
tilted camera over extruded data (the legacy's LOD2 buildings). Two things follow:

- **Nothing about the engine reaches a module.** A module never imports `maplibre-gl`; it talks to `MapService`
  and gets GeoJSON back — which is what keeps the provider replaceable.
- **OpenLayers is not gone from the app.** The legacy configurator and six other features (`polygon-drawer`,
  `assessment-viewer`, `settings/MapPointPicker`, `simulation-charts/ComparisonMapPanel`, `model-results`,
  `interactive-map` utils) still run on it, including the multi-CRS area import in
  `configurator/utils/areaGeoJSON.ts`. It leaves with the legacy, at parity; the Model Builder does not depend
  on it either way.

G/H are why named layers matter: MapLibre's own `moveLayer(id, beforeId)` and style-layer order *are* that list,
so the provider hands it through rather than inventing a mapping.

### A module renders once per region

A module's `Component` is rendered **once for each region it declares** — two regions, two elements, two React
instances, **two `useState`s**. That is harmless until two regions must agree on something: each would paint its
own copy, whichever re-rendered last would win, and two effects would take turns clearing the same map layer.

So anything two regions share belongs to the *module*, not to a render of it — the same reason `hold()` is
module-level. `area-draw` keeps its draft in `draft.ts` and both regions subscribe with `useSyncExternalStore`,
and its map effects are guarded to the `map` region so only one instance writes the layer.

A module whose regions never share a value (a form in the sidebar, a status strip in `bottom`) needs none of
this: `useState` is fine when only one region reads it. The rule bites exactly when a region reads a value
another region writes.

### Putting UI on the map

A module puts UI over the map by **declaring the `map` region** — that region *is* the overlay. The frame renders
the map host's canvas underneath and the module's element above it in a **pass-through layer**: the host's wrapper
is `pointer-events-none`, so a panel never swallows a map click by accident, and anything that *should* take
clicks opts in with `pointer-events-auto`.

The floating-panel convention, as the example and `area-draw` do it — copy this:

```tsx
<div className="pointer-events-auto flex max-h-full max-w-md flex-col gap-3 overflow-auto
                rounded-lg border border-border bg-card/95 p-4 shadow-sm"> … </div>
```

`max-h-full` and `overflow-auto` because the frame hands over a bounded box and the module owns its overflow; the
card background because a panel over a map is unreadable without one.

For a **modal** over the whole module column — the map, the sidebar and the bars — declare `overlay` and call
`OverlayControl.open()`. The host keeps the scrim, the centring and the Escape handling, and a declared overlay
stays closed until the module asks for it.

A module cannot style its *map layers* yet: `createLayer` has no style option, so every layer draws in the same
fill, line and circle. A custom (non-GeoJSON) layer — the three.js/LoD2 case — is provider territory too.

### Testing the flow

`shell/workflow.dev.json` is the flow the frame walks in **workflow mode**: an ordered node list, no edges. It
carries every step that is *built*, in the legacy order (`Modules.md` §5), and grows as each module lands — a
node whose `moduleId` is not registered makes the loader throw, so the chain is always exactly what exists:

    model-start  →  area-draw  →  grid-generation

Each node's `required` ports must be satisfied by an earlier node or by the seed, and that is **tested**:
`isValidFlow(flow, registry, seeds)` in `shell/workflow.test.ts` is the core's own gating, so a chain that cannot
be walked fails the suite rather than the browser.

To walk it: turn the `modelbuilder` flag on and open `/app/modelbuilder` in **workflow mode**. The workflow bar
moves the session and the steps panel shows which step is done, current or pending. A node whose required ports
are missing refuses to run, and `validate()` names what is missing — which is how the hand-off from one step to
the next is checked without reading any code.

`OverlayControl` (`open()`, `close()`, `isOpen`) lets a module ask for the full-screen slot without owning
its chrome. A declared overlay is **closed until the module opens it**, and the host keeps the scrim, the
centring and the Escape handling — so an overlay is a panel the module fills, not a full-screen div it
draws. Like the map, it is transient view state; nothing about it is committed.

`example/` declares **all four slots** on purpose: it is the demonstration of the frame. Most modules want
two or three — declare what you actually use.

## Slot conventions (rules, not preferences)

- **You own your overflow.** The host gives you a bounded box and **never scrolls your content for you**.
  If your module has more content than fits, that is your decision: your own scroll container, or tabs
  inside the slot. Content that silently overflows its box is a bug.
- **Never size the page.** No `h-screen`, no full-viewport overlays, no frame-level layout. You fill the
  box you are given.
- **Know your box:**

| slot | the box you get |
|---|---|
| `sidebar` | full height of the content area, up to ⅓ of the content area wide (never narrower than 20rem) |
| `map` | `flex-1`, `min-h-0` — the map host fills it, you layer into it |
| `bottom` | intrinsic height, **capped at ¼ of the content area** (a cap, not a quota: a one-line status renders one line) |
| `overlay` | scoped to the content area; the host renders the scrim and the card, you fill and scroll it |

The module's `bottom` slot is the *only* thing called "bottom": the host's own bars (a workflow bar at the
top, a ledger bar at the very bottom) are frame chrome and no module renders into them.

- **A source slot is installed *after* your effects run.** Your UI mounts as a child of the shell, and React
  runs child effects before parent ones — so a mount-time `useEffect` that reads the installed source finds
  `null`, bails, and is **never retried**. The symptom is a picker that shows "loading" for good with no
  request in flight. **Start the load from the installer, not the mount**: keep the list outside React (an
  external store + `useSyncExternalStore`) and have `setXSource` kick it off. `modules/model-start/regions.ts`
  is the shape to copy — three modules have hit this, and the obvious "fix" is to delete that line and load
  from the mount effect again, which is what breaks it.

## Where a module's work comes from, and how it lands: `seal`

A module's UI collects values that only `run()` can commit, so the module holds them and `run()` commits them —
that is the module's own model, and it is the whole design, not a hole in it. The value never travels *through*
the contract: the module's internal state is its own business, and what crosses the boundary is the ports it
declares.

**How often those commits land is the module's declaration** (`spec/core.md` T16, `Plan.md` §5):

| `seal` | what lands | right when |
|---|---|---|
| `"per-commit"` | one **atomic** transaction per `commit()` — two commits in one `run()` append two entries, each with its own sealed cascade | the writes are **independent** fields, as in settings: a partial state is still one the module stands behind, and it buys field-level undo |
| `"at-completion"` *(default)* | **one** transaction for the whole `run()`, so the module sees the pre-state throughout and any rejection means nothing happened | the writes are **interdependent** — `grid-generation` writes buildings + transformers + lines + grids from one drawn area, where undoing one of those leaves a store violating the module's own guarantee |

Atomicity is a property of the *transaction* either way; only the group differs. Granularity is the module's
call because whether its writes are independent is a module property, not an engine one.

`example/` declares `per-commit`, and makes **one** `commit()` per gesture, so its atomicity is visible without
the log getting noisy. Its tests fill the module's own values the way its regions do and then run the real
engine; `runInScratch` covers the other half — that the declaration is consistent, and that a run does not
throw.

## Adding a module

```bash
node src/features/model-builder/scripts/new-module.mjs tariff-settings "Tariff settings"
```

That copies `example/` — manifest, tsconfig, test config and all — rewrites the id, the label and the
i18n key prefix, registers the entry in `../shell/moduleRegistry.ts`, and prints the remaining steps. Then:

1. `cd modules/tariff-settings && npm install && npm test`
2. Write the core contract with `defineModule` — the port surface **first and honestly**, because
   `affect` and the flow gate are checked against it.
3. Write the UI for each region you declared.
4. Make the mock the smallest set of inputs that lets the module do its work.
5. Make the copied test say something true about *your* module.
6. Add the locale keys (`modelBuilder.<id>.*`) to `src/locales/{en,de,es,nl}.json`.

## Testing a module

`testSupport` ships **in the core**, so a module gets it from the only dependency it has:

```ts
import { contractIssues, runInScratch } from "@model-builder/core";
import myModule from "./index";

it("is consistent with the contract", () => {
  expect(contractIssues(myModule)).toEqual([]);
});

it("does its job", async () => {
  const { store, error, issues } = await runInScratch(myModule);
  expect(error).toBeUndefined();
  expect(store.data.somePort).toBe("what I expect");
  expect(issues).toEqual([]); // the module's own validate(), asked before the run
});
```

`contractIssues` judges the **declaration** (ports, `required` against the mock, `affect`, regions);
`runInScratch` runs the module through the **real engine** on a scratch store, so the write boundary and
the cascade behave exactly as they do in a host.

There is no DOM test environment (no `@testing-library`, no jsdom), so a module's UI is not rendered into a
DOM in tests. Adding one is a deliberate decision rather than an oversight — it would belong in a module's own
workspace, where its own `package.json` can carry `react`, RTL and jsdom without weighing on the app. A
**static** render needs none of that, though: `building-demand/overlay.test.tsx` renders its auto state view with
`react-dom/server`'s `renderToStaticMarkup` (no DOM, `react` hoisted from the app) purely to pin which controls
appear — the only control on an auto node being its manual re-run, and only after a failure.

## Working on a module without the app

```bash
# One install covers the app AND every module: the modules are npm workspaces of the frontend, so their
# dependencies are declared in their own package.json and installed here, hoisted and deduped.
cd ../..                     # enerplanet/frontend
npm install

cd src/features/model-builder/modules/example
npm run verify               # typecheck + test, both standalone
npm run test:watch           # the loop you actually want
```

**Test mode.** Running a module on its own — here or in the shell's module preview — puts it in *test
mode*: nothing has to pre-exist, because the module's own `mock` seeds the scratch store before `run()`,
so none of its inputs are unsatisfied. That is **not** the `required` gate switched off — it is satisfied
by construction, and your module's test asserts it: `contractIssues` fails a module whose `mock` does not
supply every port it declares `required`. So write `mock` as your module's **test data** — the inputs a
real run needs — not as a stub to keep the type-checker quiet.

Nothing here touches the app: no vite, no backend, no build. The module's `tsconfig.json` mirrors the
app's compiler settings on purpose, so **green here means green in the app** — the stricter of the two
would be a lie in one direction or the other.

The app still runs everything the module does: `shell/moduleRegistry.ts` registers the module, the app's
test run picks up its tests, and the dev workflow places it. `/app/modelbuilder` (flag: Settings →
Experimental → *Model Builder*) is now **workflow-driven**: the session starts from the workflow's seed, the
module on screen is the node the session sits on, and running it advances the position, which the workflow
bar shows.

The frame shows the module its **mode** names, and nothing else — that is the only dead end. In *workflow
mode* the module on screen is the node the session sits on, so it has to be placed by the dev workflow first.
In *test mode* the frame shows one module on its own, seeded from its own **test data**, with no workflow and
no position at all — which is how a module's UI is seen before it is wired into anything. The dev-only mode
select in the bar switches between them, and *Reset* re-seeds the session either way.

Nothing in the isolated shell talks to the backend. A module's I/O goes through the gateway this feature
owns (`../save/gateway.ts`), so a module that needs a backend call takes it as a dependency from the host
rather than reaching for another feature's service.

## Status

| module | status |
|---|---|
| `example` | the template. Handles the model name (a real, if small, job), renders into **all four** regions and owns each region's overflow (so the slot conventions are shown, not just described), and carries the tests that document the contract. Scaffold from it; do not delete it. |
