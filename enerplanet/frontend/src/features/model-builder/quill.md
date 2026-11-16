# quill.md — questions for Quill (Stefan)

Things I hit while building the remaining modules that need *your* answer rather than my best guess. My
recommendation is on each — disagree freely, that is what the file is for. I will keep appending here and we
go through the list once the legacy workflow is replicated.

Legend: 🚧 blocks a module · ❓ a real decision · 💭 smaller, worth confirming.

---

## 1. 🚧 The *analyse* step — no longer a question about *if*, but about *where*

Read the two Go handlers (`model_analyse.go`, `model_demand_profiles.go`) to settle this, and the backend
already decides most of it:

- **`POST /models/{id}/analyse`** enqueues an **asynq job** on the `buem` queue (30-min timeout, unique for
  30 min, 3 retries) and returns **202 queued/running**. It **needs a saved model** — the doc says so
  outright: *"Saving a model does not start it."*
- **`GET /models/{id}/demand-profiles`** is the progress: `idle | resolving | completed`, plus per-building
  `resolved | pending | failed | shared | not_heated`. A failed building carries its own `error_message`
  (no envelope match, BuEM rejected it) — a per-building outcome, not an endpoint error.
- **The two paths are mutually exclusive per model.** `/analyse` returns **409** when the model
  *"uses the estimated heat demand, so there is nothing to analyse"* (`ModelHeatSource`). So a model picks
  either the frontend estimate **or** a real heat source that gets analysed — never both.
- Profiles are also written by **a simulation run**, not only by `/analyse`.

**So the question for you is only this:** in the workflow you have in mind, is the *estimate* the path (and
the analysis simply never applies), or do you want the analysis exposed post-save as its own step with a
progress UI?

My recommendation: **build the estimate now** (it needs no saved model, so it belongs in the flow), and
expose the analysis **after** it — as a post-save surface, since it cannot be a flow node while the save is
the last node. It is a long job with per-building failures, so it wants its own progress UI rather than a
blocking call.

## 2. ❓ The building configurator's layer id (blocks its `map` region)

You described the flow: the node makes the **building layer** interactive and opens the configurator on the
clicked building. `MapService` addresses layers **by id**, and the buildings layer belongs to
`grid-generation` (`grid-generation-buildings`). So the configurator has nothing it can name.

- **(a)** A **shared id convention** — a module names the layer it creates for a port, so the buildings layer
  becomes predictable. Smallest change.
- **(b)** `setInteractiveLayer(port)` — address a port instead of an id. Cleaner conceptually, a bigger change.

**(a)** recommended.

## 3. ❓ The save merge (G2) — confirm the shape

The legacy keeps demand and technologies **inside** `config.buildings`, on each feature's properties, while
we keep them as separate ports. So `model-save` must fold them back when it builds `model.json`, or the
payload is not the legacy shape.

What I need from you: **the exact key names** the legacy writes on a feature (the recon says
`buildingParams` and `technologies` per building, but not the nesting verbatim). If you can point me at one
real legacy `config.buildings` entry, I will pin it in a parity test rather than guess.

## 4. ❓ `resolution` — the store's value, or the legacy's hard-coded 60?

The extracted legacy save hard-codes `resolution: 60`. We carry a `resolution` port. Currently: the store's
value wins, 60 is only the fallback. **Confirm that is right** — if the backend really expects 60 always, this
is a live bug.

## 5. ❓ `weatherSelection` is a string, the legacy writes three weather keys (G3)

Our port is a single string; the legacy sends `weather_years`/`weather_scenario`/`weather_archive` (or
similar). One string cannot carry three values.

- **(a)** Widen the port to an object (`{ scenario?, year?, archive? }`).
- **(b)** Keep the string, and let the weather module resolve it to the legacy keys at save time.

**(a)** recommended — (b) hides a mapping in the save path, which is exactly where parity bugs live.

## 6. ❓ `technologies` — the port shape and the catalogue source

I read the legacy as `Record<osmId, Technology[]>` (technologies per building). Confirm, and confirm the
catalogue comes from **OpenTech-DB** (I have the API from earlier work). Also: does the *simple* editor story
(one technology per building) matter to you, or is the npm package the only path worth building?

## 7. 💭 `buildingParams` vectors — confirm the two we start with

`buildingParams["electricity"]` and `["heat"]`, as an **open set** (T9): adding a vector is additive, no
schema change. Confirm those two are enough for the legacy workflow, and that `heat` matters now (Jay's BUEM
side) or can stay empty.

## 8. 💭 Does the legacy *edit* anything in a grid-editor, or was that my invention?

The audit says the legacy never edits lines (read-only grid display). If there is no editing UI, `grid-editor`
should be **dropped** rather than built as a guess.

## 9. 💭 The npm package: pin or track?

`@thd-spatial-ai/building-configurator` **v0.17.3** today. Pin it exactly (reproducible, upgrade deliberately),
or track a range?

**Pin** recommended.

## 10. 💭 The frame's `↶ ↷` — kept as a core affordance, or gone?

You decided movement is a **position move**, not undo. The bar will move with `jumpTo`; the core's undo/redo
still exists and still works. Do the `↶ ↷` controls stay as a secondary affordance, or do they disappear from
the frame entirely?

## 11. 💭 Your "no empty values" rule — confirm the line I drew

I refused `""`, `null` and `undefined` at the write boundary, and **allowed zero-member collections** (`[]`,
`{}`, an empty FeatureCollection). Reasoning: "no transformers in this area" is a fact, the legacy's own
payloads contain such collections, and only the module can judge whether an empty grid is a *finished* answer
— which is now what each module's `validate()` is for. Say the word if you want `[]`/`{}` refused outright too.

## 12. 💭 `validate`'s type: `ModuleCtx` in the modules, `ValidationCtx` in core

Harmless today (TypeScript accepts the wider parameter), but the narrower type is the intent. A tidy-up,
not a bug — flagging it so it is not mistaken for one.

---

## 13. 💭 Hiding `map-provider` — two loose ends it turned up

The palette no longer offers `map-provider` (it declares no region, so it is not a node). The rule is derived
from `layout`, not from its id, so the next host module needs no code change. One small thing:

- **`Plan.md:302` reads "A headless/`auto` node renders nothing",** while `spec/frame.md:183` is explicit:
  *"An `auto` node is not headless: it declares `overlay` and shows its own state there."* The implementation
  follows `frame.md` (`building-demand` declares `overlay`, `sidebar`, `bottom`), so I treated `frame.md` as
  authoritative and the rule stands. Mentioning it only so the Plan line does not mislead the next reader.

---

## Notes to self (not questions)

- The legacy is the **template**; ours is the **new structure and harness**. When they disagree, the legacy
  wins on *data shape* and ours wins on *how it is expressed*.
- Every module gets tested **in isolation** (its own suite) before it is wired into the flow.
