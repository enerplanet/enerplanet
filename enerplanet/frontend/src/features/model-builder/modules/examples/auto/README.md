# `auto/` — the automatic template

A **step with no forward action**: the frame runs it on arrival, as soon as its inputs are present,
and advances by itself once the run lands.

## What it demonstrates

- **`auto: true`** — the module's own declaration that it runs itself. There is no button and no
  Continue anywhere on it.
- **`layout: ["overlay", "bottom"]`** — `overlay` shows the run state (handed as `AutoRunState`:
  `running` / `done` / `error`); the one control it offers is a manual re-run, and only after an
  `error`.
- **An injected source** (`source.ts`) that ships a **working default**, so it runs with no host.
- **Writing into the shared `advancedParams` bag** under a namespaced key
  (`example-auto.areaSummary`): `run()` reads the bag first and **merges**, so it neither
  blind-overwrites the port (`clobber`) nor discards another module's key.
- **`seal` at the default** (`at-completion`); **`validate()`** reports the missing drawn area.

## Change first when copying

the id, the `name` and the `modelBuilder.example-auto.` i18n key prefix; the source; and the copied
test — it still asserts the example's specifics.
