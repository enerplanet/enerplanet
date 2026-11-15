# Model Builder — validation walkthrough

A click-by-click pass over the built flow, with what to expect at each step and what is worth
sending back. The goal is a **saved model** — the first end-to-end run of the whole chain.

**What is built:** `model-start` → `area-draw` → `grid-generation` → `model-save`, all four live in
the dev flow.

## Before you start

- **Vite is up** (I started it — `:3000`). The Go backend is on `:8080` and its container is healthy.
- **Feature flag on** as you normally do, then open **`/app/modelbuilder`**.
- **DevTools open on the Network tab.** Two calls are worth watching: `POST /models` (Call A) and
  `PUT /models/{id}/session` (Call B). Those two *are* the save.

## The walk

### 1. `model-start` — region and identity
Pick the region, fill the name and the period, press **Apply**.

**Expect:** the map frames the region on its own (no button), and the step turns **green**.

Worth a look: clear the name and press Apply — the node should stay **unfinished** rather than
advance. That is the new rule (T22) doing its job: a node that runs but does not finish its outputs
is not `done`, so the flow rests on it.

### 2. `area-draw` — draw the area
Press **Draw area**, click at least three points, **double-click** to close the ring, then **Apply**.

**Expect:** the polygon appears on the map, and the step turns **green**. A second polygon appends;
Escape adds nothing.

### 3. `grid-generation` — generate
Press **Generate**. This calls the real pylovo backend, so give it a few seconds.

**Expect:** buildings, transformers and cables on the map — **transformers drawn on top of the
cables**. The bottom strip lists all five ports (`buildings`, `transformers`, `lines`, `mvLines`,
`grids`) with what the store holds.

This is the step most likely to have a real-world surprise (the backend, the area, the region you
picked) — if it errors, the message on screen is what I need.

### 4. `model-save` — the verdict, the payload, the save
You should now be on the last node.

**Expect, in order:**
1. **The verdict** — "Everything the model needs is here" if all four nodes are done.
2. **The `model.json` preview** — this is the conversion output. It should have `title`, `from_date`,
   `to_date`, `resolution`, `coordinates` (a MultiPolygon), `config` (with `buildings`, `lines`,
   `mv_lines`, `transformers`, `grids` and `pypsa`) and `status: "draft"`.
3. Press **Save** → "Saved.", `POST /models` returns 201, then `PUT .../session` returns 200.

**Send me the preview JSON** — that alone tells me whether the legacy parity is right, and it is the
artefact we have been building toward.

## Four checks that are worth more than the happy path

1. **The cascade.** After the grid is generated, go back and **change the region** or **redraw the
   area**. The grid node should turn **orange (stale)** by itself — nothing was re-run, its outputs
   were pruned because the change affects them. Exactly the grid's ports, exactly once.
2. **The verdict is derived, not cached.** Change the area after generating: the save node's verdict
   should immediately report what is now missing.
3. **The step colours.** green = done, orange = stale, grey = pending, blue = current.
4. **Nothing invented in the payload.** The preview must be built from the store — if a value looks
   plausible but wrong, that is a parity bug and the most valuable thing you can find.

## What is *not* built yet (so you don't go looking)

- **`weather`, `building-demand`, `technologies`, the building configurator** — not built. So a
  *run* is not possible yet; the **save** is, and that is what this pass is about.
- **Bar movement is still undo/redo** — the position-move rebuild (and `Continue`) is the next slice.
  The bar's own save still writes `incomplete` on purpose; the *node* is what promotes to `draft`.
- **Clicking a building** to configure it — that is the building-configurator module, next after the
  above.

## What to send back

- The **`model.json` preview** (copied out of the panel) — most useful.
- A **screenshot** of anything visually wrong (layer order, framing, the strip).
- The **Network tab** entry for `POST /models` if the save fails, and the on-screen error.
- Anything that made you go "that should not be possible" — those are the cases I cannot test from
  here, and the only ones that will bite us later.

## What I know is still open

- `grid-generation`'s gate checks that its **inputs** exist, not that its **result** is usable: an
  area with no buildings would currently read as done and save as a draft. Fixing that is the next
  small commit (your rule needs it — a module whose output is empty must not be done).
- A module's `validate` is typed `ModuleCtx` in the modules and `ValidationCtx` in core. Harmless
  (TypeScript accepts it), but the intent is the narrower one; a tidy-up, not a bug.
