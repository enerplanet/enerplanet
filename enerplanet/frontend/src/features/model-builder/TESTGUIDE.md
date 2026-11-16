# Model Builder — validation walkthrough

A click-by-click pass over the **whole flow**, with what to expect at each step and what is worth
sending back. The goal is a **saved model** — the first end-to-end run of every node, including the
building configurator.

**What is built:** `model-start` → `area-draw` → `grid-generation` → `weather` →
`building-demand` (auto) → `building-configurator` → `technologies` → `model-save`. All eight live in
the dev flow.

## Before you start

- **Vite is up** (I started it — `:3000`). The Go backend is on `:8080`.
- **Feature flag on**, then open **`/app/modelbuilder`**.
- **DevTools open on the Network tab.** Two calls are worth watching: `POST /models` (Call A) and
  `PUT /models/{id}/session` (Call B). Those two *are* the save.

## How the bar moves now

**The bar moves by position, not by undo.** The prior-step control is a *jump*: it takes you back to
an earlier node and **discards nothing** — no data is pruned, no redo tail appears. The forward
control is **Continue**: it runs the node you are on and keeps walking through any `auto` node it
lands on, stopping at the next node you can act on. That is how `building-demand` runs — it has no
button of its own.

## The walk

### 1. `model-start` — region and identity
Pick the region, fill the name and the period, press **Apply**.

**Expect:** the map frames the region on its own, and the step turns **green**.

Worth a look: clear the name and press Apply — the node should stay **unfinished** rather than
advance. That is T22 doing its job: a node that runs but does not fill its outputs is not `done`.

### 2. `area-draw` — draw the area
Press **Draw area**, click at least three points, **double-click** to close the ring, then **Apply**.

**Expect:** the polygon on the map, and the step turns **green**.

### 3. `grid-generation` — generate
Press **Generate**. This calls the real pylovo backend, so give it a few seconds.

**Expect:** buildings, transformers and cables on the map — **transformers drawn on top**. The
bottom strip lists all five ports (`buildings`, `transformers`, `lines`, `mvLines`, `grids`).

The step most likely to surprise us (the backend, the area, the region). If it errors, the message
on screen is what I need.

### 4. `weather` — pick the weather
Choose a year or a scenario, then apply.

**Expect:** the step turns **green**. Note it also declares for the period — if you go back and
change the dates in `model-start`, the weather step should go **orange** on its own.

### 5. `building-demand` — runs itself
**Expect:** you do not press anything. Press **Continue** on `weather`'s successor and the walk
passes straight through this node, calling pylovo per building.

If it stops here instead, the node is telling you something is missing — the message is the point.

### 6. `building-configurator` — **click a building**
This is the new one. **Click a building on the map.** The bottom bar tells you to; there is no button
because there would be nothing to act on until you pick one.

**Expect:** the **legacy 3D configurator opens full-screen** on that building — the same view the old
configurator shows (envelope, thermal parameters, a Technologies tab), with a back arrow. The left
sidebar lists the buildings and which are configured.

Change something, then **close it**. The building's data should land on the workflow; nothing is
written while the view is open, so closing without changing anything changes nothing.

### 7. `technologies` — supply the buildings
Assign a technology (there is an assign-to-all), and use **Fill in heat automatically** if you want
the expected-fit pass. An autoplaced technology is flagged as an *estimate* — that flag is deliberate
and should reach the payload.

**Expect:** the step turns **green** once every building with heat demand has a supply.

### 8. `model-save` — the verdict, the payload, the save
You should now be on the last node.

**Expect, in order:**
1. **The verdict** — "Everything the model needs is here" if all eight nodes are done.
2. **The `model.json` preview** — the conversion output. It should have `title`, `from_date`,
   `to_date`, `resolution` (60), `coordinates` (a MultiPolygon), `config` (with `buildings`, `lines`,
   `mv_lines`, `transformers`, `grids` and `pypsa`) and `status: "draft"`. **Inside `config.buildings`,
   each feature should carry its demand and technologies folded onto its `properties`** — that is the
   legacy shape, and the thing most worth checking.
3. Press **Save** → "Saved.", `POST /models` returns 201, then `PUT .../session` returns 200.

**Send me the preview JSON** — that alone tells me whether legacy parity is right.

## Checks worth more than the happy path

1. **The cascade is by influence, not position.** With the flow complete, go back to `model-start`
   and **change the region**. The nodes that actually depend on it go **orange**; one that does not
   should stay **green** even though it sits downstream. That asymmetry is the whole architecture.
2. **A move prunes nothing.** Step back to an earlier node with the bar and step forward again. No
   step should go stale from the *moving* — only from an actual change. (If stepping back turns
   things orange, that is a real bug and I want it.)
3. **The building configurator commits on close.** Open a building, change something, close. Then
   step back and open it again — your change should still be there.
4. **The verdict is derived, not cached.** Change the area after a save-looking state: the verdict
   should immediately report what is now missing.
5. **Step colours.** green = done, orange = stale, grey = pending, blue = current.
6. **Nothing invented in the payload.** If a value looks plausible but wrong, that is a parity bug and
   the most valuable thing you can find.

## What is *not* built yet (so you don't go looking)

- **`grid-editor`** (moving/deleting transformers) — deferred. The generated grid is what we validate
  against.
- **Loading an existing model** — the data layer is done (a saved `config` unfolds back into the
  store's ports, round-trip tested); the *UI* to browse saved models is not there yet.
- **Four legacy config keys** (`cookingCarrier`, `mode`, `electricity_prices`, `site`) have no port,
  so the save writes them **absent rather than invented**. You will see them missing from the preview
  and that is deliberate — it needs a settings module we have not decided on.
- **The workflow builder** (authoring flows in the UI) — a later feature.

## What to send back

- The **`model.json` preview** (copied out of the panel) — most useful.
- A **screenshot** of anything visually wrong (layer order, framing, the configurator opening).
- The **Network tab** entry for `POST /models` if the save fails, and the on-screen error.
- Anything that made you go "that should not be possible" — those are the cases I cannot test from
  here, and the only ones that will bite us later.
