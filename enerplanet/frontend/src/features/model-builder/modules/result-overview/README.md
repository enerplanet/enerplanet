# `result-overview`

An **interactive view** that summarises what a model run produced and links to the full results page.

It is a step the user looks at and moves on from. There is no `auto`: nothing runs on arrival, and no run is
dispatched here — the run belongs to `run-meme-calliope`, and this node reads its outcome.

## What it does

- **Reads two required ports and writes nothing.** `modelId` (which model's page the summary is for) and
  `memeRun` (proof a run produced results) are both `required` — which is what places this node *after* the
  run by construction. A viewer has nothing to commit, so no port is invented to give it one; its `run()`
  seals only the zero-diff trace an interactive step needs to be left behind.
- **Gates on a completed run.** `validate()` reports an unfinished or failed run, so the session rests here
  until there are results to show — the same reading `run-meme-calliope` makes of the run record.
- **Shows a small, honest summary**: the totals the structured endpoint carries — production, consumption,
  peak demand, timesteps — plus the result-location count and the carriers present. No figure is derived that
  the backend does not provide.
- **Links to `/app/model-results/<modelId>`** with a plain anchor: a module may not import `react-router`, so
  it cannot use the `Link`/`useNavigate` the rest of the app navigates with. The link opens in this app and
  this tab.

## The slot

The summary arrives through an injected gateway (`source.ts`, installed with `setResultOverviewGateway`) — the
shell supplies the implementation (`shell/resultOverviewGateway.ts`, installed at startup). It reads
`GET /models/:id/results/structured`, the endpoint the results page itself uses, so the summary agrees with the
page the link opens. There is **no default**: a missing gateway is an error the view reports, naming the
installer.

The load lives outside React (an external store + `useSyncExternalStore`), and **installing is what asks for
it**: a module's regions mount before the shell's install effect runs, so a mount-time load would find no
gateway and never be retried (`../README.md`, "A source slot is installed *after* your effects run").

## Notes

- **No DOM in tests.** The view is covered by a static render (`react-dom/server`), as the templates are.
- **Regions:** `sidebar` (the summary) and `bottom` (a status strip). A handful of lines needs neither a map
  nor an overlay.
