# Model Builder — validation walkthrough

A click-by-click pass over the whole flow, with what to expect at each step. The goal is a **saved
model** — the first end-to-end run of every node, including the building configurator.

**What is built:** `model-start` → `area-draw` → `grid-generation` → `weather` →
`building-demand` (auto) → `building-configurator` → `technologies` → `model-save`.

## Before you start

- **Vite up** on `:3000`; the Go backend on `:8080`.
- **Feature flag on**, then open **`/app/modelbuilder`**.
- **DevTools open on the Network tab:** `POST /models` (Call A) and `PUT /models/{id}/session`
  (Call B) — those two *are* the save.

## How the bar moves

The prior control is a *jump*: it goes back to an earlier node and **discards nothing**. There is
**no forward control** — a step advances by *running itself*, and an `auto` node runs **on arrival**.

## The walk

1. **`model-start`** — pick the region, fill the name and the period, press **Apply**. Expect the map
   to frame the region and the step to turn **green**. Clearing the name and applying leaves the node
   **unfinished** rather than advancing.
2. **`area-draw`** — **Draw area**, click at least three points, **double-click** to close the ring,
   **Apply**. Expect the polygon on the map and the step **green**.
3. **`grid-generation`** — **Generate** (real pylovo backend, a few seconds). Expect buildings,
   transformers and cables, **transformers on top**; the bottom strip lists `buildings`,
   `transformers`, `lines`, `mvLines`, `grids`.
4. **`weather`** — choose a year or a scenario, then apply. Expect **green**. Changing the dates back
   in `model-start` should turn this step **orange** on its own.
5. **`building-demand`** — runs itself on arrival, calling pylovo per building. Expect to press
   nothing; if it stops here, the on-screen message is saying something is missing.
6. **`building-configurator`** — **click a building on the map** (there is no button until you do).
   Expect the **legacy 3D configurator full-screen** on that building; change something and close it
   to commit. Nothing is written while the view is open.
7. **`technologies`** — assign a technology (there is an assign-to-all) and optionally **Fill in heat
   automatically**; an autoplaced technology is flagged as an *estimate*. Expect **green** once every
   building with heat demand has a supply.
8. **`model-save`** — expect, in order: the verdict, the **`model.json` preview** (`title`,
   `from_date`, `to_date`, `resolution` (60), `coordinates`, `config` with `buildings`, `lines`,
   `mv_lines`, `transformers`, `grids` and `pypsa`, and `status: "draft"` — each feature in
   `config.buildings` carrying its demand and technologies folded onto its `properties`), then
   **Save** → `POST /models` returns 201 and `PUT .../session` returns 200.

## Checks worth more than the happy path

- Changing an upstream value stales only the nodes that actually **depend** on it, not everything
  downstream — a node that does not depend on it stays **green**.
- A move prunes nothing: stepping back and forward should not turn anything orange.
- The building configurator commits on close — reopen a building and the change is still there.
- The verdict is derived, not cached: change the area and it immediately reports what is missing.
- Step colours: green = done, orange = stale, grey = pending, blue = current.
- Nothing invented in the payload — a plausible-but-wrong value is the most valuable bug to find.

## What is *not* built yet (so you don't go looking)

- **`grid-editor`** (moving/deleting transformers) — deferred. The generated grid is what we validate
  against.
- **Loading an existing model** — the data layer is done (a saved `config` unfolds back into the
  store's ports, round-trip tested); the *UI* to browse saved models is not there yet.
- **The legacy `site` key** has no port, so the save writes it **absent rather than invented**. You
  will see it missing from the preview and that is deliberate — it needs a settings module we have not
  decided on. The other legacy settings keys (`cookingCarrier`, `mode`, `electricityPrices`) do have
  ports now.

## What to send back

The **`model.json` preview** (most useful), a **screenshot** of anything visually wrong, and the
**Network** entry for `POST /models` if the save fails.
