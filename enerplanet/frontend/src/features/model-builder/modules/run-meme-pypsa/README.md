# `run-meme-pypsa`

An **automatic node** that dispatches the model's isolated PyPSA **power-flow leg** and resumes on it.

There is no forward action anywhere on it (`auto: true`): the frame runs it on arrival, once its inputs are
present, and advances by itself once the leg lands.

## What it does

- **Waits for a completed Calliope run.** The power flow is *derived*: the backend builds a MEME `meme-pypsa`
  job from the parsed Calliope results, so a model without a completed Calliope leg is refused
  (`CalliopeLegReady`, a 400 at request time). The node expresses this by declaring **`memeRun` required** beside
  `modelId` — and `validate()` reports it, and `run()` refuses to dispatch without it, so a doomed request is
  never sent.
- **Submits nothing twice.** On arrival it reads `modelId`; if the store already holds a `memePypsaLeg`, it does
  not post another. The backend refuses a duplicate live leg, so an existing record means *read, never resubmit*.
  The one exception is a **terminal failed** record — the manual re-run's target, which the backend accepts as a
  fresh dispatch.
- **Commits the leg's record** — `memePypsaLeg` in `core/ports.ts` (a core change): which leg, and where it
  stands. It is the record, **not the results**; the power-flow results are read by the nodes that consume them,
  and that dependency (declaring `memePypsaLeg` required) is what orders those nodes after this one.
- **Runs for minutes, and says so.** A leg goes to TentaCron, which polls MEME to completion (up to ~45m). The
  user can leave and come back: `validate()` reports an unfinished leg, so the session rests on this node and
  reopening lands back here. The overlay then polls and commits the outcome, and the frontier advances.
- **The status is read directly from the leg** — unlike the Calliope run, whose record the host must derive from
  the model's lifecycle. `GET /models/:id` carries the leg's own status as `pypsa_leg_status`, and this gateway
  reads it as-is (the backend's own vocabulary, `models.MemeRunStatus*`).

## The slot

The module's I/O arrives through an injected gateway (`source.ts`, installed with `setMemePypsaLegGateway`) — the
shell supplies the implementation (`shell/memePypsaLegGateway.ts`, installed at startup). There is **no default**:
a missing gateway is an error the run reports, naming the installer, because a fabricated leg would be a lie
about the backend.

## Notes

- **No DOM in tests.** The overlay is covered by a static render (`react-dom/server`), as the templates are.
- **The overlay's state comes from the port**, not `auto.state`: the frame's `auto.state` reads `done` the moment
  the dispatch returns, minutes before the leg finishes. `auto` supplies the test-mode guard and the one control
  (the manual re-run).
- **`affect` declares two edges** — `modelId → memePypsaLeg` and `memeRun → memePypsaLeg`: the leg is derived
  from the Calliope run, so a different run invalidates it as well as a different model.
- **`seal` at the default** (`at-completion`) — one record, one writer, one transaction.
- **The leg carries no `runId` or failure message**: both live on the leg's server-side row
  (`model_meme_runs.run_id` / `.error`) and only `pypsa_leg_status` reaches the frontend, so the gateway leaves
  them unset. The same honest limitation the Calliope run's gateway notes for `runId`.
