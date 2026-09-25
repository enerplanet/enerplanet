# Concept — replace the webservice with meme, routed via TentaCron

Status: concept (not yet planned in detail)
Audience: developer

## Why

Today the calculation path does not touch meme at all:

- `StartCalculation` enqueues `run_buem` on asynq (`buem` queue).
- `run_buem` resolves envelope/weather, calls buem-gateway, then enqueues
  `dispatch_model_calculation` on asynq (`spatialAI_public` queue).
- The webservice has its **own proxy and its own queue**; the backend talks to
  it through `webservice.Client.Forward`. The webservice owns jobs and results.

The translator already exists (`internal/meme/translate.go` — emits a canonical
MEME `Job` from node-level series) but has **zero callers**: nothing dispatches a
built model to meme.

Goal: retire the webservice's private proxy+queue. **TentaCron becomes both the
queue and the proxy** for the calculation, exactly as it already is for ignis,
City2TABULA, weather and buem-gateway. All meme requests — submit, poll,
result — go through TentaCron; the backend holds no meme address of its own
(consistent with the ignis pattern in `docs/enerplanet/heat-demand-flow.md`).

## Target shape

```
backend ──(POST /requests, 202)──▶ TentaCron ──▶ meme (cmd/server)
backend ◀─(long-poll status)───────────────┘
```

- Backend builds the model (config → `meme.Translate` → MEME `Job`).
- Backend submits the job to meme **via TentaCron** (a `meme-*` target), gets a
  request id, and long-polls until `completed`, then reads the result from
  `target_response` — same async contract as the other targets.
- No asynq `buem` / `spatialAI_public` dispatch for the calculation, no
  `webservice.Client.Forward`. The webservice's queue/proxy is deactivated.

## What replaces what

| Today (webservice)         | Tomorrow (TentaCron + meme)        |
|----------------------------|-------------------------------------|
| webservice's own queue     | TentaCron request lifecycle (202+poll) |
| webservice proxy (`Forward`)| TentaCron target routing to meme     |
| `dispatch_model_calculation` asynq | `meme.Translate` → submit job over TentaCron |
| webservice result store     | TentaCron `target_response` + existing result handler |

## Decomposition (back-to-front)

1. **Concept/schema** (this doc) — the dispatch contract and TentaCron target
   shape for meme. First step; the rest follows it.
2. **TentaCron target** — decide/implement routing so meme is reachable by name
   (like c2t/weather in the heat override stack) and backend can submit/poll.
3. **Backend dispatch** — first real caller of `meme.Translate`: a handler that
   builds the model, translates it, submits the Job over TentaCron, long-polls,
   stores the result. Reuse the 202+long-poll helpers the ignis/c2t clients
   already use.
4. **Frontend trigger** — build/send the model config to backend, surface the
   meme run on a "Run" affordance in configurator/model-builder.
5. **Retire the webservice path** — deactivate the asynq dispatch and the
   `webservice.Client.Forward` path behind the new meme route; record the
   webservice in the deprecated register for later removal (never delete
   dependencies).
6. **Parity gate** — extend `heat_workflow_smoke.sh` with a final dispatch →
   meme accepted → result step, so the old path is removed only at parity.

## Open questions

- Does buem-gateway stay on the path (resolving per-building series first) and
  meme only takes over the final dispatch? Likely yes for now — meme's input is
  precisely the node-level series buem already produces. This makes the swap
  additive, not replacing BuEM.
- TentaCron target naming and payload contract (job JSON verbatim vs wrapped).