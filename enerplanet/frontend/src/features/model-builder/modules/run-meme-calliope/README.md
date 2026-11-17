# `run-meme-calliope`

An **automatic node** (`auto: true`) that dispatches the model to a MEME/Calliope run and resumes on
it: the frame runs it on arrival, once `modelId` is present, and advances by itself once the run
lands.

## What it does

- **Reads `modelId`; submits nothing twice.** If the store already holds a `memeRun`, it does not
  post another — an existing record means *read, never resubmit*. The one exception is a **terminal
  failed** record: the manual re-run's target.
- **Commits `memeRun`** — which run, where it stands, the failure's message. It is the record, **not
  the results**; the nodes that declare `memeRun` required are ordered after this one.
- **Runs for minutes, and says so.** A run goes to TentaCron, which polls MEME to completion (up to
  ~45m). `validate()` reports an unfinished run, so the session rests here and reopening lands back;
  the overlay then polls and commits the outcome.
- Status is read from the model: `GET /models/:id`'s `status` and `results`.

The I/O arrives through an injected gateway (`source.ts`, installed with `setMemeRunGateway`, no
default).

**Regions:** `overlay` and `bottom`. `seal` at the default (`at-completion`).
