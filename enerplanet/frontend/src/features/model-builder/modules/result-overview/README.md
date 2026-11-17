# `result-overview`

An **interactive view** that summarises what a model run produced and links to the full results page.

## What it does

- **Reads `modelId` and `memeRun` (both required) and writes nothing.** Both being required is what
  places this node *after* the run by construction; a viewer has nothing to commit, so `run()` seals
  only the zero-diff trace.
- **Gates on a completed run:** `validate()` reports an unfinished or failed run, so the session rests
  here until there are results to show.
- Shows the totals the structured endpoint carries — production, consumption, peak demand, timesteps
  — plus the result-location count and the carriers present. No figure is derived.
- **Links to `/app/model-results/<modelId>`** with a plain anchor (a module may not import
  `react-router`).

The summary arrives through an injected gateway (`source.ts`, installed with
`setResultOverviewGateway`, no default), reading `GET /models/:id/results/structured` — the endpoint
the results page itself uses. Installing is what asks for the load.

**Regions:** `sidebar` and `bottom`.
