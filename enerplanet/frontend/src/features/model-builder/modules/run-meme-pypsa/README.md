# `run-meme-pypsa`

An **automatic node** (`auto: true`) that dispatches the model's isolated PyPSA **power-flow leg** and
resumes on it: the frame runs it on arrival, once its inputs are present, and advances by itself once
the leg lands.

## What it does

- **Waits for a completed Calliope run.** The leg is *derived* — the backend builds it from the
  parsed Calliope results — so `memeRun` is declared **required** beside `modelId`, and `run()`
  refuses to dispatch without it.
- **Reads `modelId`; submits nothing twice.** If the store already holds a `memePypsaLeg`, it does not
  post another — an existing record means *read, never resubmit*. The one exception is a **terminal
  failed** record: the manual re-run's target.
- **Commits `memePypsaLeg`** — which leg, and where it stands. It is the record, **not the results**.
- **Runs for minutes, and says so.** TentaCron polls MEME to completion (up to ~45m); `validate()`
  reports an unfinished leg, so the session rests here and reopening lands back, and the overlay polls
  and commits the outcome.
- Status is read directly from the leg: `GET /models/:id`'s `pypsa_leg_status`.

The I/O arrives through an injected gateway (`source.ts`, installed with `setMemePypsaLegGateway`, no
default).

**Regions:** `overlay` and `bottom`. `seal` at the default (`at-completion`).
