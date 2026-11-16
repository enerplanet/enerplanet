# `interactive/` — the interactive template

A **step with a forward action**: the user collects values in the UI and commits them by running the module.

## What it demonstrates

- **All four regions, on purpose** — it is the demonstration of the frame: `sidebar` (the model form),
  `map` (draw a ring), `bottom` (every declared port and whether the store holds it), `overlay` (the review,
  opened through `OverlayControl`).
- **`seal: "per-commit"`** — one atomic transaction per `commit()`, right here because its three ports are
  independent fields: a partial state is still one the module stands behind, and it buys field-level undo.
- **The `hold` seam** — a module-scope `hold(nodeId, values)` the regions hand values through, keyed to the
  node they were collected for. `run()` reads each port before writing it and commits only what differs (the
  name is trimmed, so a padded value produces a real diff). This is also how the test drives the module.
- **`validate()`** requiring a name — the gate that decides whether the node is `done`.
- **The `map` region** — a floating card over the map (`pointer-events-auto`), naming its own layer
  (`createLayer` → `clearLayer` → `addFeatures`), and committing the ring to the store. Drawing *from* the map
  (`requestPolygon`) belongs to a module with a real provider behind it.

## Change first when copying

1. the id, the `name`, and the `modelBuilder.example-interactive.` i18n key prefix;
2. the `params` to the ports you actually touch, and `affect` honestly;
3. the copied test — it still asserts the example's specifics.

## How it differs from `auto/`

This one **collects and commits**: it has a forward action and a `sidebar`, and its regions call `run()`
themselves. The `auto/` template has **no forward action** — the frame runs it on arrival — and declares
`overlay` and `bottom` only, to show its run state.
