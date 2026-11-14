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
  undoable and sealed together with the cascade it invalidated. A run that changes nothing seals nothing.

`example/index.test.ts` demonstrates each of these by trying to break them, which is the quickest way to
see what the boundary actually refuses.

## Regions

`layout: Region[]` names where the UI mounts. The host composes the page; a module never does — and a
module that declares nothing is headless, which is how an `auto` node renders nothing. The frame:

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
| `map` | **the main centre area**, `flex-1`; named for the interactive map host it is meant to carry, but structurally it is simply the big region | `MapService` |
| `bottom` | a footer bar across the content area: status, summaries, stats | — |
| `overlay` | a full-screen panel above everything, opened and closed on demand | `OverlayControl` |

The `map` region's `MapService` — `addLayer`/`removeLayer`, `fitTo`, `requestPoint`/`requestPolygon` — is
a transient interaction service, **not model state**: it holds render/interaction state only, and anything
a module must keep (a drawn polygon, a selection) is committed to the store as a normal transaction. The
map host never writes the store.

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

There is no DOM test environment (no `@testing-library`, no jsdom), so a module's UI is not rendered in
tests. Adding one is a deliberate decision rather than an oversight — it would belong in a module's own
workspace, where its own `package.json` can carry `react`, RTL and jsdom without weighing on the app.

## Working on a module without the app

```bash
cd modules/example
npm install          # links @model-builder/core and the module's tools into ./node_modules
npm run verify       # typecheck + test, both standalone
npm run test:watch   # the loop you actually want
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
