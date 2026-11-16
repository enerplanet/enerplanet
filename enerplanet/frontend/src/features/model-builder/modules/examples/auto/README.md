# `auto/` — the automatic template

A **step with no forward action**: the frame runs it on arrival, as soon as its inputs are present, and
advances by itself once the run lands.

## What it demonstrates

- **`auto: true`** — the module's own declaration that it runs itself (`Module.auto`), read by the frame in
  `shell/autoRun.ts`. There is no button and no Continue anywhere on it.
- **`layout: ["overlay", "bottom"]`** — `overlay` is where an auto node shows its run state, handed as
  `AutoRunState` (`running` / `done` / `error`); `bottom` is its status strip. The one control it offers is a
  manual re-run, and only after an `error`.
- **An injected source** (`source.ts`) — the module owns the *decision* to summarise and the host owns *how*.
  Unlike `building-demand`, this example ships a **working default**, so it runs with no host at all. A real
  module whose I/O leaves the process would have no default and would require one.
- **Writing into the shared `advancedParams` bag** under a namespaced key (`example-auto.areaSummary`) —
  because a module may only write ports the core declares. `run()` reads the bag first and **merges** into it,
  so it neither blind-overwrites the port (`clobber`) nor throws another module's key away.
- **`seal` at the default** (`at-completion`) — one derived value, one writer, one natural transaction.
- **`validate()`** reporting the missing input (a drawn area).

## Change first when copying

1. the id, the `name`, and the `modelBuilder.example-auto.` i18n key prefix;
2. the source — replace the local default with the real I/O, or drop the slot entirely if the job is pure;
3. the copied test — it still asserts the example's specifics.

## How it differs from `interactive/`

This one has **no forward action and no `sidebar`**: it runs on arrival and shows only its state, in `overlay`
and `bottom`. The `interactive/` template is the opposite — it collects values and commits them, declares all
four regions, and uses `seal: "per-commit"`.
