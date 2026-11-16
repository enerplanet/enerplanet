# Example modules — the templates

Two **teaching templates** a new module is copied from: `interactive/` — a step the user fills in and submits —
and `auto/` — a step that runs on arrival.

They are **not live modules**. Neither is registered in the shell's catalogue (`../shell/moduleRegistry.ts`),
neither is placed in the dev flow, and nothing in the app imports them. They exist to be read and copied.

They are also **not workspaces**, and **not installable in place**. Each carries the `package.json` a *copy*
needs, and its two `file:` dependencies are **depth-relative** — `@model-builder/core` at `../../core`,
`@spatialhub/i18n` at `../../../../../../../libs/i18n` — which are correct from where a copy **lands**
(`modules/<id>/`), not from where the template sits here. That is deliberate: a plain copy to `modules/<id>/`
then needs no path rewriting at all. `npm install` *in the template directory itself* would resolve those paths
wrong, so do not run it there.

## Copying one

```bash
cp -r src/features/model-builder/modules/examples/interactive \
      src/features/model-builder/modules/tariff-settings
```

Then: change the id, the `name` and the `modelBuilder.<id>.` i18n prefix; register it (below); and make its
test say something true about *it* rather than about the example. `../README.md` § "Adding a module" has the
full walkthrough and the scaffold script (whose interface is being reworked).

| template | what it is |
|---|---|
| `interactive/` | a step with a forward action: the user collects values and commits them. Declares **all four regions** on purpose — it is the demonstration of the frame. |
| `auto/` | a step with **no forward action**: it runs on arrival and advances by itself. Declares `overlay` (its run state) and `bottom`. |

## What a module author needs (index)

This is the getting-started surface. `../README.md` is the host-side guide — read it for the full rules. The
pointers below name the part each template demonstrates.

**Regions.** `layout: Region[]` names where a module's UI mounts; a module whose `layout` is empty is a headless
host module. The frame offers four, and every render is handed `{ nodeId, region, data, run }` plus one
region-specific thing:

| region | handed |
|---|---|
| `sidebar` | — (a fixed `w-80` left column) |
| `map` | `MapService` |
| `bottom` | — (a footer bar, capped at ¼ of the content area) |
| `overlay` | `OverlayControl` |

A module's `Component` renders **once per declared region** — two regions are two instances with two
`useState`s, so anything two regions share belongs to the module, not to a render. The `interactive` template
keeps its collected values in a module-scope `hold`, keyed to the node, for exactly this reason.

**The map service (`map` region).** A transient interaction service, never model state. `requestPoint()` /
`requestPolygon()` create geometry and **return** it (nothing is drawn yet); `createLayer(id)` /
`removeLayer(id)` / `addFeatures(id, geojson)` / `clearLayer(id)` place it; `setInteractiveLayer(id | null)`
picks the click target; `getLayerOrder()` / `setLayerOrder(order)` manage the stack; `fitTo(geojson)` frames
it; `onElementClick(listener)` returns its own unsubscribe. A module **names its own layer**. Anything a module
must keep (a drawn ring, a selection) it commits to the store — the map host never writes the store.

**Overlay (`overlay` region).** `OverlayControl` — `open()`, `close()`, `isOpen`. The host owns the scrim, the
centring and the Escape handling; a declared overlay stays closed until the module opens it.

**Automatic steps (`Module.auto`).** `auto: true` says the step runs itself; it has **no forward action
anywhere**. The frame runs it **on arrival**, once its inputs are present, and advances when the run lands. Its
only UI is the run's state, handed as `AutoRunState` (`state: "running" | "done" | "error"`, `message?`,
`rerun()`) — and the one control it offers is a manual re-run, only after an `error`. `auto/` is the template.

**The store contract.** A module declares its whole surface in `params` and touches nothing else; `run()` is
the only write path, and the engine seals what it commits.

- a write to a port **not** in `params` is rejected — `undeclared`;
- a write to a port that already holds a value is rejected as `clobber` unless the run **read** it first — the
  anti-clobber rule;
- `required: true` means the port must already exist: the flow gate keeps the node unplaceable until it does,
  and the engine refuses to run it (`MissingRequiredPorts`);
- `affect` is the declared influence, and it must be honest. `core/influence.ts` derives a module's *observed*
  influence and **fails an under-declared one**; over-declaring is only reported. It is a prober a module's own
  test calls (as `core/influence.test.ts` shows) — not a sweep the app runs over every registered module — so
  declare `affect` honestly and let the module's test assert it.

**`seal`.** `"at-completion"` (the default) seals **one** transaction for the whole `run()` — right when the
writes are interdependent. `"per-commit"` seals one **atomic** transaction per `commit()` — right when the
writes are independent, and it buys field-level undo. The `interactive` template uses `per-commit`; `auto`
leaves the default.

**`validate`.** The module's own completeness gate: `(ctx: { store }) => ValidationIssue[]`. A node that ran is
`done` only while `validate` reports nothing, so "every node is done" means the model is whole. Both templates
implement it.

**The `hold` seam.** A module's UI collects values that only `run()` can commit, so the module holds them
itself and `run()` commits them — that held state is the module's own model and never crosses the contract (it
is the design, not a hole in it). `interactive/` exports `hold(nodeId, values)`: a module-scope seam keyed to
the node it was collected for, so a value collected on one node is never committed against another. It is also
how a test drives the module.

**`testSupport`.** `contractIssues(module)` judges the declaration (ports, `required` against the `mock`,
`affect`, regions); `runInScratch(module)` runs it through the **real engine** on a scratch store. Both ship in
`@model-builder/core`.

**Linking a module up.** Four things, none of them automatic:

1. **Registry** — an import and one entry in `../shell/moduleRegistry.ts` (one per line, so the script can
   splice it).
2. **Workspaces** — `frontend/package.json` globs `src/features/model-builder/modules/*`, and a module is a
   workspace only when it has a `package.json`. The templates here (and `building-configurator`) have none, and
   npm simply ignores a glob-matched directory without one.
3. **Locale keys** — add `modelBuilder.<id>.*` to `src/locales/{en,de,es,nl}.json` **by hand**.
   `npm run i18n:check` fails a statically-used key missing from any locale file, and an inline fallback does
   not exempt it.
4. **Placing it in a flow** — the workflow editor (or the `shell/workflow.dev.json` fixture), provided every
   `required` port is produced upstream.

## Limitations to design around

- **No DOM in tests.** The app runs vitest with `environment: "node"` — no jsdom, no testing-library — so a
  module's UI is not rendered into a DOM in a test. A **static** render (`react-dom/server`'s
  `renderToStaticMarkup`) needs none, and is how both templates pin which controls appear.
- **One component per region.** The module's `Component` is the whole UI and branches on `region`; there is no
  second component, and each region is a separate React instance.
- **Two imports, and only two.** A module may import `@model-builder/core` and `@spatialhub/i18n` — nothing
  else from this repo. That is what keeps it portable.
- **A module can only write ports the core declares** (`core/ports.ts`, `ModelData`). A value that deserves its
  own port means a **core change**; until then a module carries it in the shared `advancedParams` bag under a
  key it namespaces to itself (`auto/` does this).
- **The map regions need the provider installed.** `MapService` comes from the host module the shell loads
  (`../shell/moduleRegistry.ts`'s `MAP_PROVIDER`, the `map-provider` module); without it a `map` region is
  handed no service.
- **Locale keys are merged by hand.** There is no extraction step; the four JSON files are edited directly.

For the host side — the frame, the floor, `seal` in depth, the slot conventions, and working on a module
without the app — read `../README.md`.
