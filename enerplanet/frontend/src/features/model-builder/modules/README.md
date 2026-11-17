# Modules

One directory per module. Each live directory is its own workspace — its own `package.json`,
tsconfig, vitest config and install — with one exception: `building-configurator/` carries no
`package.json` and resolves everything from the frontend root.

**Start here:** `modules/examples/` holds the two templates — `interactive/` and `auto/`. Read one
before you write anything; `scripts/new-module.mjs` copies one. Its README is the getting-started index.

## What a module is

A module is three things bound together:

| part | where | what it is |
|---|---|---|
| the **core contract** | `@model-builder/core` (`defineModule`) | the declared port surface (`params`), the declared influence (`affect`), `run()`, `validate()` — and `layout`, the regions its UI wants |
| the **UI** | `index.tsx` | one component, rendered **once per region the module declared** |
| the **mock** | same file | the inputs the module needs to develop in isolation: the seed of the scratch store |

`index.tsx` default-exports a `BuilderModule` — `{ module, Component, mock? }`, typed in the core's `view.ts`.

## The two packages a module depends on

A module imports **`@model-builder/core`** and `@spatialhub/i18n` — nothing else from this repo, which
is what makes it portable. Both are `file:` dependencies of the module's `package.json`, so
`npm install` links them into its **own** `node_modules`:

| package | where | what it is |
|---|---|---|
| `@model-builder/core` | `../core` | ports, the module contract, the view contract, the store, the engine, the history primitives — and `testSupport` for your tests. Dependency-free TypeScript, no build step. |
| `@spatialhub/i18n` | `../../../../../../../libs/i18n` | translation, for a module's UI. The host provides the provider at runtime; a module needs the package only to typecheck and test. |

## Rules the core enforces (checked, not conventional)

- **Declare what you touch.** A write to a port missing from `params` is rejected as `undeclared`.
- **Read before you overwrite.** Writing a port that already holds a value without reading it first is rejected as `clobber` — the anti-clobber rule.
- **`required` means "must already exist".** The flow gate keeps such a module unplaceable, and the engine refuses to run it (`MissingRequiredPorts`).
- **`affect` must be honest.** `core/influence.ts` derives a module's *observed* influence and fails one that under-declares it; over-declaring is only reported. A module's own test calls it (`influence.test.ts`).
- **`run()` is the only write path.** It commits; nothing else may reach the store. A run that changes nothing still seals one zero-diff transaction.

## Regions

`layout: Region[]` names where the UI mounts; the host composes the page, a module never does — a
module that declares nothing is headless. The frame:

```
┌ header (host-owned: title · prior/current/next · undo/redo/save · dev mode select) ┐
├──────────┬───────────────────────────────────────┤
│ sidebar  │ map        ← the main area (flex-1)   │
│ w-80     ├───────────────────────────────────────┤
│          │ bottom     ← footer bar, capped at ¼ │
└──────────┴───────────────────────────────────────┘
   overlay  ← scoped to the content area, above all of it
   steps panel (host-owned, the frame's right-hand band)
```

| slot | what it is | what the module gets |
|---|---|---|
| `sidebar` | the primary panel: forms, settings, lists, a fixed `w-80` column | — |
| `map` | the map host's slot — the canvas fills it, your controls render over it in a pass-through layer | `MapService` |
| `bottom` | a footer bar across the content area: status, summaries, stats | — |
| `overlay` | a full-screen panel above everything, opened and closed on demand | `OverlayControl` |

The `map` region's `MapService` is a transient interaction service, **not model state** — anything a
module must keep (a drawn polygon, a selection) is committed to the store. The engine is **MapLibre**,
but a module never imports `maplibre-gl`; it talks to `MapService` and gets GeoJSON back.

## Putting UI on the map

A module puts UI over the map by **declaring the `map` region** — that region *is* the overlay. The
host's wrapper is `pointer-events-none`, so a panel never swallows a map click by accident; anything
that *should* take clicks opts in with `pointer-events-auto`. The floating-panel convention:

```tsx
<div className="pointer-events-auto flex max-h-full max-w-md flex-col gap-3 overflow-auto
                rounded-lg border border-border bg-card/95 p-4 shadow-sm"> … </div>
```

For a **modal** over the module column, declare `overlay` and call `OverlayControl.open()`; the host
keeps the scrim, centring and Escape handling, and it stays closed until the module opens it.

## Slot conventions (rules, not preferences)

- **You own your overflow.** The host gives you a bounded box and **never scrolls your content**; content that silently overflows its box is a bug.
- **Never size the page.** No `h-screen`, no full-viewport overlays, no frame-level layout.
- **A module renders once per region** — two regions are two instances with two `useState`s, so anything two regions share belongs to the module (an external store + `useSyncExternalStore`), not to a render.
- **A source slot is installed *after* your effects run.** A mount-time `useEffect` that reads it finds `null`, bails, and is never retried. Start the load from the installer, not the mount: keep the list outside React and have `setXSource` kick it off (`modules/model-start/regions.ts` is the shape to copy).

## Where a module's work comes from, and how it lands: `seal`

A module's UI collects values that only `run()` can commit, so the module holds them and `run()`
commits them; what crosses the boundary is the ports it declares — and how often commits land is its call:

| `seal` | what lands | right when |
|---|---|---|
| `"per-commit"` | one **atomic** transaction per `commit()`, each with its own sealed cascade | the writes are **independent** fields (settings): it buys field-level undo |
| `"at-completion"` *(default)* | **one** transaction for the whole `run()`, so the module sees the pre-state throughout | the writes are **interdependent** — e.g. `grid-generation`'s buildings + transformers + lines + grids |

## Adding a module

```bash
node src/features/model-builder/scripts/new-module.mjs tariff-settings "Tariff settings"
```

That copies a template from `modules/examples/`, rewrites the id, label and i18n prefix, registers
the entry in `../shell/moduleRegistry.ts`, and prints the remaining steps. Then:

1. `cd modules/tariff-settings && npm install && npm test`
2. Write the core contract with `defineModule` — the port surface first and honestly.
3. Write the UI for each region you declared.
4. Make the mock the smallest set of inputs that lets the module do its work.
5. Make the copied test say something true about *your* module.
6. Add the locale keys (`modelBuilder.<id>.*`) to `src/locales/{en,de,es,nl}.json`.

## Testing a module

`testSupport` ships in the core — a module gets it from its only dependency:

```ts
import { contractIssues, runInScratch } from "@model-builder/core";
```

`contractIssues` judges the **declaration** (ports, `required` against the mock, `affect`, regions);
`runInScratch` runs the module through the **real engine** on a scratch store. There is no DOM test
environment; a **static** render (`react-dom/server`'s `renderToStaticMarkup`) is how a UI is pinned.

## Working on a module without the app

```bash
cd ../..                     # enerplanet/frontend
npm install

cd src/features/model-builder/modules/area-draw     # any module with its own package.json
npm run verify               # typecheck + test, both standalone
npm run test:watch           # the loop you actually want
```

The templates under `modules/examples/` are **not installable in place** (their `file:` paths are
relative to where a copy lands), so copy one first — see `modules/examples/README.md`. Nothing here
touches the app, and the module's `tsconfig.json` mirrors the app's, so **green here means green there**.
