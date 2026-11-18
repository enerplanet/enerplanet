# `interactive/` — the interactive template

A **step with a forward action**: the user collects values in the UI and commits them by running the
module.

## What it demonstrates

- **All four regions, on purpose** — the demonstration of the frame: `sidebar` (the model form),
  `map` (draw a ring), `bottom` (every declared port and whether the store holds it), `overlay` (the
  review, opened through `OverlayControl`).
- **`seal: "per-commit"`** — one atomic transaction per `commit()`, right here because its ports are
  independent fields: it buys field-level undo.
- **The `hold` seam** — a module-scope `hold(nodeId, values)` the regions hand values through, keyed
  to the node they were collected for. `run()` reads each port before writing and commits only what
  differs. This is also how the test drives the module.
- **`validate()`** requiring a name.
- **The `map` region** — a floating card over the map naming its own layer (`createLayer` →
  `clearLayer` → `addFeatures`), committing the ring to the store.

## Change first when copying

the id, the `name` and the `modelBuilder.example-interactive.` i18n key prefix; the `params` and
`affect`; and the copied test — it still asserts the example's specifics.
