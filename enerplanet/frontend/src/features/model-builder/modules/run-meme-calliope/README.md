# `run-meme-calliope`

An **automatic node** that dispatches the model to a MEME/Calliope run and resumes on it.

There is no forward action anywhere on it (`auto: true`): the frame runs it on arrival, once `modelId` is
present, and advances by itself once the run lands.

## What it does

- **Submits nothing twice.** On arrival it reads `modelId`; if the store already holds a `memeRun`, it does not
  post another. The backend refuses a duplicate live run and the submit is idempotent, so an existing record
  means *read, never resubmit*. The one exception is a **terminal failed** record — the manual re-run's target,
  which the backend accepts as a fresh dispatch.
- **Commits the run's record** — `memeRun` in `core/ports.ts` (a core change): which run, where it stands, and
  the failure's message. It is the record, **not the results**; the results are read by the nodes that consume
  them, and that dependency (declaring `memeRun` required) is what orders those nodes after this one.
- **Runs for minutes, and says so.** A run goes to TentaCron, which polls MEME to completion (up to ~45m). The
  user can leave and come back: `validate()` reports an unfinished run, so the session rests on this node and
  reopening lands back here. The overlay then polls and commits the outcome, and the frontier advances.
- **The status is read from the model**, not a run-specific endpoint: `GET /models/:id`'s `status` and
  `results`, mapped onto the backend's own run vocabulary (`models.MemeRunStatus*`).

## The slot

The module's I/O arrives through an injected gateway (`source.ts`, installed with `setMemeRunGateway`) — the
shell supplies the implementation (`shell/memeRunGateway.ts`, installed at startup). There is **no default**: a
missing gateway is an error the run reports, naming the installer, because a fabricated run would be a lie about
the backend.

## Notes

- **No DOM in tests.** The overlay is covered by a static render (`react-dom/server`), as the templates are.
- **The overlay's state comes from the port**, not `auto.state`: the frame's `auto.state` reads `done` the
  moment the dispatch returns, minutes before the run finishes. `auto` supplies the test-mode guard and the one
  control (the manual re-run).
- **`seal` at the default** (`at-completion`) — one record, one writer, one transaction.
