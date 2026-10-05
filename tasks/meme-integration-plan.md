# Meme Integration — Cohesive Plan (next steps)

Purpose: sequence the whole EnerPlanET → MEME (via TentaCron) integration into a
single, decision-gated runbook. Single entry point for execution. It orchestrates
and orders the existing task docs — it does **not** re-specify their field-level
detail:

| Task doc | Role under this plan |
|---|---|
| `spec.md` | go-meme-parser package spec — **superseded: Coati (github.com/enerplanet/Coati) IS the parser**; use only for naming/key parity notes |
| `MEME_RESULT_PARSING.md` | TEMPO-derived source research — its "frozen contract" IS real but **Coati emits it** (from the frameworks' .nc/.h5), it's not served by MEME; use for interpretation parity, not a JSON endpoint |
| `ENERPLANET_TRANSLATOR.md` | superseded for *writing* a translator — T1K is the translator; this doc reduces to the T1K-adoption note (Step 4) |
| `INTEGRATION_REQUIREMENTS.md` | R1–R5 / D-register status; referenced per step |
| `meme-replace-webservice-concept.md` | sequencing rationale + retire path |
| `COATI.md` (`.local/dependencies/coati/`) | **blackbox doc for the adopted parser** — how to run `coati`, the results-document schema, EnerPlanET workflow, pitfalls (new) |
| `meme-pypsa-result-parity.md` (this dir) | **external artifact for the MEME developer** — API contract vs MEME's PyPSA output, why the electrical data is missing, options S0–S4 (utilization → real `Line` + `network.pf()` → canonical `s_nom`) |
| `meme-pypsa-result-parity-ask.md` (this dir) | **short, sendable version** of the above — the quick ask (link-origin marker → roadmap `power_flow` → Coati coordination + 3 open questions) |
| `grid-result-capabilities-plan.md` (this dir) | **plan for the conditional Grid UI** — 3-valued `source` (`legacy`/`meme`/`full-grid-pf`), capability lookup in Go, backfill migration, the PyPSA ingest that resumes Step 8.3, and the frontend gating/relabel; contains the component inventory with line refs |

Status legend: `[DONE]` verified this week · `[ACTIVE]` in work · `[BLOCKED]`
unverified/live-dependent · `[DECIDE]` open architecture question.

---

## 0. What is already done (do not re-do)

- `enerplanet/backend/internal/meme/translate.go` + `job.go` — translator logic
  exists (emits a MEME `Job` from node-level series). **Still has zero callers.**
- `internal/tentacron/client.go` — TentaCron 202 + long-poll client, proven in
  ignis, weather, buem, city2tabula, heatdemand. The pattern the whole plan
  leans on already works in this backend.
- **T1K** (`~/Projects/github/T1K`, standalone) — packaged `enerplanet-to-meme`
  JSON transformer: embedded mapping, CLI + Go lib, golden tests. This is the
  translator the old specs described as *to be written*.
- Backend `go build ./...` exits 0. Repo uses `go.work` (modules listed there).
- MEME deps present (no path calls meme directly yet).

---

## Steps (canonical, gated — do not skip the blockers)

### 1 — Verify MEME passthrough via TentaCron  `[DONE 2026-09-28]` · critical path
Confirmed backend → TentaCron → MEME round-trips (R5 / D3): submitted a real
job through TentaCron's `meme` target (`dev-frontend-key` / `localhost:8400`),
long-polled to `completed`, and pulled the result via `target_response`'s
`result.href` → a zip (`target_status: 200`, real Calliope solve, objective 49400).
Infra fixed along the way: TentaCron's Dockerfile lacked `git config --system
--add safe.directory /src` (mirrored meme's line 41), and `meme-env-api-1`
needed attaching to `tentacron-net`. Note: this proved the TentaCron→MEME wire;
the backend's *native* dispatch caller is Step 5 (still zero callers on
`meme.Translate`).
**Done when:** (was) a real job submits through a meme-* TentaCron target,
long-polls to `completed`, and `target_response` returns a result — ✅ verified.

### 2 — Capture one real result bundle  `[DONE 2026-09-28]`
**Finding (verified 2026-09-28): MEME serves NO JSON contract.** The router has
no `/jobs/{id}/result.json` (404), and `results.json` inside the zip is
run-grades only. The parseable result is the **per-target model output** in the
zip: Calliope `output/results.nc` + `output/csv/*`, PyPSA `output/network.nc`.
**Resolved by Coati (github.com/enerplanet/Coati, ~/Projects/github/Coati):**
Coati converts exactly those result files into the unified `loc::tech` results
document (`capacities`/`dispatch`/`generation`/`objective`/`tech_metadata`/
`termination_condition`/…) — the old "frozen contract" IS real, Coati emits it
from the frameworks' own files (MEME just never serves it as JSON). Verified
end-to-end: a real Calliope `results.nc` → full document (objective 58179.03,
matches the solver). Fixtures: `.local/dependencies/meme/results/` +
`real-calliope-bundle-example.zip` + `coati_out.json`.
**Unblocks** parser steps 3 & 6 — Coati IS the parser; no go-meme-parser to build.
**Done when:** (was) a real Calliope `results_*.csv` fixture pinned in
go-meme-parser — superseded: the real fixture + Coati output are pinned in `.local`.

### 3 — Adopt Coati as the result parser  `[COVERED by Coati]`
**Coati replaces the plan's "build go-meme-parser from scratch" entirely.** It is
a pip-installed Python package/CLI that reads Calliope 0.7 (dev7/0.7.0 tested),
PyPSA 1.2.4/1.3.0, and AdOpT-NET0 0.1.10 result files and writes the unified
results document. Only parse path needed: **extract the per-target file from
MEME's zip → shell `coati <file> <doc.json> <framework-id>` (or the Python API)
→ ingest the JSON**. AdOpT normalizer included (model-aware, gated) — no separate
effort. Cross-check emitted payload ↔ T1K naming (R P-A7) still applies to the
*input* side (Step 4).
**Done when:** verify Coati converts a real Calliope + PyPSA result file into a
document that satisfies the backend's R1/R2 needs (parity with old
`result_parser.go`); wire the call site in Step 6, not a new module.

### 4 — Adopt T1K as the translator `[DONE 2026-09-29]`
**Decision (D1/D4):** imported T1K as a **native Go module**
(`go get github.com/enerplanet/T1K@v0.0.0-20260927224744-348964757412`, added
to `backend/go.mod`) — not a workspace `use()` entry, per the user's call
(fetch via github like any package, don't bind to the local explorer clone).
Electricity-first: the dispatcher feeds the **CalculationPayload shape** into
T1K's embedded `enerplanet-to-meme` mapping from
`internal/meme/mapping.json` (the embedded mapping with the
`allow_unmet_demand` rule **removed**, because PyPSA rejects it and MEME's
TentaCron target is hard-fixed `pypsa,calliope`). **Heat is deferred** to
`tasks/heat-patch.md` — T1K's mapping currently drops heat entirely; the
existing `internal/meme/Translate()` (node-level BUEM series, heat pump) is
the heat-aware reference and stays for the later retrofit.
**Verified:** `internal/meme/t1k.go` `TranslatePayload` + unit tests +
`t1k_live_test.go` (`//go:build manualignis`) — the translated job passes
`POST /validate?target=pypsa,calliope` clean against live MEME (HTTP 200).

**FIX (2026-09-30) — Calliope-legal ids.** The first live E2E revealed the
translated job only *validated* because `/validate` was exercised against the
unit fixture; a real model failed the whole `pypsa,calliope` job at MEME's
Calliope schema check: keys must match `^[^_^\d][\w]*$` — no leading digit, and
no `-`. The mapping minted bare node ids (`1`), hyphenated tech/trade ids
(`demand-1`, `grid-trafo_82`) and referenced raw ids in `transmission.from/to`.
Fixed in the vendored `internal/meme/mapping.json` (T1K has no prefix/sanitize
hook, and `each.bind` vars must appear in that each's own `to`):
- node keys `model.nodes{$k}` → `model.nodes{n$k}` (+ the 5 `node` refs `n$k`)
- tech/trade keys `demand_$k`, `grid_$k`, `pv_supply_$k`, … (`_`, not `-`) and
  the 8 reverse-lookup paths `{grid_$k}`
- transmission key `${p}_$i` → `${p}_${from}_${to}` with `$from`/`$to` bound, so
  the endpoints can be prefixed (`n$from`) — T1K rejects a bind unused in `to`.
- `properties.id`'s `template: "$k"` is deliberately left alone (the reverse
  write-back must keep the raw id).
- New guard: `internal/meme/t1k_calliope_ids_test.go` asserts every emitted
  node/tech/trade/transmission key is Calliope-legal and that transmission
  endpoints + tech `node` refs resolve.
- **Upstream:** the same change belongs in T1K's embedded `enerplanet-to-meme`
  mapping; until then this vendored copy is a fork (already one for the dropped
  `allow_unmet_demand` rule) — flag it, don't block on it.
- **Consequence to resolve:** the `n` prefix leaks into result identity —
  `locations`/wire endpoints read `n1`, `ntrafo_82`, and the wire name (the
  transmission id IS the Calliope tech id) reads `lv_1_trafo_82`. The results
  map matches coordinates by raw id, so MEME nodes won't line up with the map.
  Candidate fix: strip the prefix in the Coati ingest mapping.

**Done when:** (was) backend imports T1K, every output passes `payload.Validate` — achieved.

### 5 — Backend dispatch (first real caller)  `[DONE 2026-09-29]`
Native dispatch handler built in `enerplanet/backend/internal/jobs/`
(`dispatch_meme.go`, task type `dispatch_meme`): loads the model by ID via
gorm, builds the payload with `payload.BuildCalculationPayload`, translates it
through the T1K seam (`meme.TranslatePayload`, electricity-only), and submits
the T1K job bytes as-is over TentaCron's `meme` target. Kills the "zero
callers" state; `StartCalculation`/`run_buem` untouched.

**Reworked 2026-09-29 — TentaCron-as-durable-queue shape (D5).** TentaCron is
itself the durable single-instance SQLite queue (ADR-0002) and polls MEME to
completion (`response.mode: poll`, ADR-0004, 30m budget). The backend must
**treat it as that**, not as a fire-and-forget endpoint. Two defects were fixed
grounded in TentaCron's actual source:
- **No resubmit-on-timeout.** `FetchResultBytes` carried the generic 60s
  `opTimeout`; a MEME solve takes minutes, the 60s deadline fired, asynq
  retried, and each retry re-submitted → duplicate MEME jobs. The handler now
  long-polls **by id on a `memePollBudget` of 30m** (matching TentaCron's own
  meme poll timeout), never the 60s default.
- **Idempotency + persist + resume + cancel.** The submit sends an
  **`Idempotency-Key: model_<id>`** header (TentaCron dedups natively: same
  key+payload replays return the stored job, different payload → 409). The
  returned TentaCron job id is **persisted per model** in a new
  **`model_meme_runs`** table (`046_create_model_meme_runs_table.sql`,
  `internal/models/model_meme_run.go`, `internal/store/memerun/`, registered by
  auto-discovery like 045). A later retry/re-run **resumes by that id** (GET
  status → GET `/v1/requests/{id}/result`) **never resubmitting**. Result is
  read via the canonical **`GET /v1/requests/{id}/result`** endpoint (raw
  binary zip), and an abandoned run can be cancelled (`DELETE
  /v1/requests/{id}`, `CancelMeme`).
New client methods (in `internal/tentacron/dispatch.go`, additive — `Do`/
`DoTimeout` + all weather/ignis/buem/heatdemand JSON callers unchanged):
`SubmitMeme(ctx,target,payload,key) (id,err)`, `AwaitResultByID(ctx,id,
budget)`, `FetchResultByID(ctx,id) ([]byte,err)`, `CancelMeme(ctx,id)`. The zip
is persisted via the **swap-pable `jobs.ResultZipStore` interface** (fs impl
`NewFilesystemResultZipStore(baseDir)`) writing under the existing
`storage/data` convention: `model_<id>_<unix>/sim_<id>.zip`, the layout the
result download handler already scans. The T1K job bytes are never unmarshaled
into `internal/meme/job.go`'s typed Job struct. Wired into
`internal/worker/asynq_worker.go` + `cmd/main.go`. Unit tests cover the client
(idempotency header + submit-id, resume-by-id no-resubmit, raw `/result` fetch,
cancel; `FetchResultBytes` raw/href + inline), the store (`sqlmock`, c2trun
style) + migration table name, and the handler end-to-end (sqlmock db + fake
TentaCron httptest: **submits once with the key, persists the job id, resumes
by id on a retry without resubmitting, stores the zip**). All green on default
`go test ./...` (live MEME/TentaCron check stays `//go:build manualignis`).
**Done when:** a model dispatches once and its result lands in the store —
**✅ verified (unit) via `go build ./...` exit 0 + `go test` on the touched
packages; live dispatch requires MEME/TentaCron running (`manualignis`).**

### 6 — R1 + R2 : result ingestion → per-target files as artifacts `[DONE 2026-09-29]`
**Decision (Option A, D5 – Coati as subprocess behind a thin interface):** the
Go backend never parses netCDF/HDF5 itself. A new `CoatiRunner` interface
(`internal/result/service/coati.go`) with a `SubprocessCoatiRunner` shells out
to the `coati` CLI (`coati convert <results.nc> - <framework-id>`, JSON on
stdout; binary resolved via `COATI_BIN` env, else `coati` on PATH). The
interface mirrors `jobs.ResultZipStore` so a sidecar HTTP impl can replace it
later with one new implementation.
**What was built:**
- `internal/result/service/coati.go` — `CoatiRunner` + `SubprocessCoatiRunner`
  (framework id Calliope 0.7; the id is a claim Coati validates).
- `internal/result/service/coati_doc.go` — the `CoatiResultsDocument` struct
  (capacity/storage `loc::tech`, costs, coordinates, objective…) + a compact
  `CoatiSummary`.
- `internal/result/service/coati_ingest.go` — `IngestCoatiResult(ctx, modelID,
  zipPath, runner)`: extracts the stored zip, locates the Calliope per-target
  `results.nc` (`files/<target>/run_i/output/results.nc` or single-target),
  runs Coati, maps the document → the existing R2 small/summary shape
  (`ParsedResults`), then `deleteExistingResults` + `storeSmallResultsTx` in one
  transaction (idempotent re-runs), and writes a compact summary to
  `model.results`. Large per-timestep series are **not** streamed yet — Coati's
  dispatch/demand series are tech/location-aggregated and don't carry the
  per-location/per-carrier/timestep dimensions those tables need; streaming is
  deferred (documented).
- `internal/jobs/ingest_meme_result.go` — asynq task `ingest_meme_result`;
  `HandleDispatchMeme` enqueues it after storing the zip (zip is already
  persisted; a retry is idempotent). Registered in worker + `cmd/main.go`.
- Tests: subprocess runner against a stub, document→R2 mapping with a small
  fixture, handler (zip + fake runner + sqlmock, incl. a genuine `INSERT …
  RETURNING id` Query surface and `SkipDefaultTransaction` for gorm), store
  wiring. `coati_live_test.go` is `//go:build manualignis` over the real Step-2
  fixture zip.
- **Provisioning / integration:** Coati is a **hard-dependency git submodule at
  `submodules/Coati`** (NOT a soft dep in `dependencies/`), pinned and updated on
  demand; `make coati` builds its venv. `COATI_BIN` (or `coati` on PATH) locates
  the binary — `.vscode/tasks.json` sets `COATI_BIN` to the submodule venv,
  docker sets it to its container venv. Pip-exchange to `enerplanet-coati==<pin>`
  later touches only `make coati` + `COATI_BIN`. See `D6`.
All green on default `go test ./...` (no MEME/TentaCron/Python required);
`go build ./...` exit 0.
**Done when:** the only parse path reads the per-target model output through
Coati into the R2 tables; the zip is stored + downloadable, not parsed as JSON —
**✅ Calliope-electricity small/summary R2 tables seeded (large timeseries
streaming + PyPSA deferred to Step 8).**

### 6.1 — Ingest parse-once, no autoheal (Step 6 rework, final design) `[DONE 2026-09-29]`
REWORKED from the earlier self-healing attempt (`incomplete` + backoff +
`reingest-meme` rerun) into the agreed simpler design: **parse once, no
autoheal, zero masking; the only rerun is a user-initiated re-solve.**
Scope decision (D7): provisioning ("start Coati if not up") is NOT a runtime
concern — the backend never pip-installs at request time; `make coati` / the
baked venv owns provisioning. There is NO backend autoheal.
**Final lifecycle (both terminal):**
- `meme ok -> parse ok -> completed` (Path 1)
- `meme fail -> failed` (Path 2, terminal)
- `meme ok -> parse fail -> failed` (Path 3, terminal)
**What was built:**
- **Parse once** — `HandleIngestMemeResult` (`internal/jobs/ingest_meme_result.go`)
  runs `IngestCoatiResult` exactly once: success → status `completed` (clears any
  prior error) → nil; failure → status `failed` with the captured Coati error and
  the error is returned. The task is enqueued with **`MaxRetry(0)`** so a failure
  is reported once, NOT retried-with-backoff (zero masking). The error is
  verbatim from Coati, which already distinguishes parse error vs CLI-missing
  (`coati binary not found: set COATI_BIN...`, `coati convert <file>: exit...:
  <stderr>`, `produced empty output`).
- **No `incomplete` state, no reingest rerun** — `MemeRunStatusIncomplete` and the
  `POST /internal/models/:id/reingest-meme` endpoint
  (`internal/model/handler/meme_reingest.go`, its test) are REMOVED, along with
  the parse-only `jobs.LocateStoredZip` + its test that the rerun used.
  `MemeRunFinished` (`internal/models/model_meme_run.go`) now treats ONLY
  `completed`/`failed` as terminal.
- **Re-solve = the only rerun = fresh submit** — `HandleDispatchMeme`
  (`internal/jobs/dispatch_meme.go`) inverts its terminal handling. A recorded run
  in a terminal `completed|failed` state can only be a USER-INITIATED re-solve
  via the EXISTING `StartCalculation` flow (`POST /api/v1/calculation/start/:id`),
  so it **FRESH-submits a new MEME solve, never resumes**; a still-running run
  resumes by id (internal dispatch retry). The idempotency key is now **run-scoped**:
  `model_<id>_<CalculationStartedAt.UnixMilli()>` (falling back to the bare
  `model_<id>` key when `CalculationStartedAt` is nil, first solve). Because
  TentaCron keys on key+payload and the payload is unchanged across a re-solve,
  the varying key guarantees a NEW TentaCron job per solve. Store overwrite +
  delete-then-store ingest keep re-parsing idempotent.
- Tests: dispatch `running` → resume-by-id (no resubmit), terminal `failed` →
  fresh-submit with run-scoped key + overwritten job id, missing-country error,
  end-to-end zip store; ingest success→`completed` / failure→`failed`+error.
  All green on default `go test ./...` (no MEME/TentaCron/Python required);
  `go build ./...` exit 0.

**FIX (2026-09-30) — the MEME path now owns `models.status`.** As first landed,
  dispatch/ingest only wrote `model_meme_runs`; **nothing** moved `models.status`
  out of `queue`, so every MEME run (success *and* failure) was stranded in
  `queue`, and the "already in progress" guard then blocked every re-run. Found
  in the first live E2E (model 18 dispatched, MEME 422'd, model stuck).
  - `internal/jobs/model_status.go` — `markModelRunning`/`Completed`/`Failed`
    over a `queue|running`-guarded UPDATE (+ `results={"error":…}` on failure,
    mirroring `store.MarkFailed`; completion does NOT clobber `results`).
  - dispatch: `queue → running` on a successful TentaCron submit, and a deferred
    `→ failed` on EVERY error return (submit/poll/fetch/store/enqueue).
  - ingest: `→ completed` on success, `→ failed` on a parse failure.
  - Tests: `internal/jobs/model_status_test.go` asserts the guarded UPDATE is
    issued, the reason is recorded on failure, and completion leaves `results`
    intact. `go build ./...` + `go test ./...` green.

### 7 — R3 : run-id diff schema `[DEFERRED 2026-09-29 → later task]`
**Deferred by decision (2026-09-29):** keep it simple for now, move this to a
later extra task, and use the **existing frontend compare flow** — the model
*results* comparison (`enerplanet/frontend/src/features/simulation-charts/
components/ComparisonCharts.tsx` + `ComparisonSummary.tsx`). That flow already
compares two models by their results side-by-side and handles both edge cases
the user clarified:
- **two completely different models still compare** — but only on their results;
- **a model with one extra building still compares** with one without it (the
  extra node simply shows its own values), it does not have to be a strict
  per-node identity match.
So a heavy backend run-id + input-hash + translator-version diff engine is NOT
needed now; the existing result comparison covers comparing models/runs.
If/when a proper run-diff engine is wanted later (two re-solves of the same
model diffing only on real change, translator-version gating, per-row
`(run_id, carrier, tech, location, timestep)` identity), spin it into its own
task — schema doc first, per the repo convention.

**Original intent (parked):** schema-change doc first; store each run against a
stable run-id + input hash + translator version so two runs diff only on real
model change.
**Done when (if ever re-opened):** two runs of the same model diff correctly per
the decided granularity (D3).

### 8 — R4 : route PyPSA through MEME  `[PARTIAL — wire ingest DONE 2026-09-30; live end-to-end unverified]`
Submit PyPSA as MEME jobs (`target=pypsa`), keep the PyPSA result tables as
consumers of the parsed per-target output (PyPSA `network.nc` / bus+gen CSVs),
so PyPSA + Calliope land in the same store.
**Done when:** a PyPSA model submits via TentaCron and results land in the store.

#### 8.1 — The result-format gap (folding in `PYPSA_ISSUE.md`)  `[FINDING 2026-09-30]`

MEME's PyPSA output is **not** the legacy power-flow bundle, so the two results
differ by construction (this is why the PyPSA leg "results differ"):

- **MEME = LP dispatch on a transport graph.** Each `transmission` emits as a
  **Link**, not a `Line`/`Transformer`; the generated `run.py` calls
  `optimize.solve_model` and **never `network.pf()`**. `power_flow`
  (Lines/Transformers, KVL) is deliberately unclaimed
  (`dependencies/meme/internal/target/pypsa/pypsa.go:37-39`; CAPABILITY.md §5/§8.3).
  Verified against a live `network.nc` (`coati inspect`): dims are `links_i`,
  `buses_i`, `generators_i`, `loads_i`, `storage_units_i` — **no `lines_i`, no
  `transformers_i`, no `buses_t_v_mag_pu`**; `r`/`x` ride through as native link
  columns (`links_r`, `links_x`) but are unused.
- **Legacy = real AC power flow.** `lines-p0/p1/q0/q1`, `buses-v_mag_pu`,
  `convergence_stats.csv`, `settings.converged` — the data behind the map's
  `loading_percent` coloring and the "Power Flow Converged" badge.

Consequence: **`loading_percent`, per-bus voltage and `converged` cannot be
sourced from MEME** — no Line, no rating, no reactive, no convergence stage.
Evidence bundle: `.local/tmp/pypsa-issue/` (`meme/` vs `legacy/`). The
developer-facing write-up of this gap (contract table, why, options S0–S4) is
`tasks/meme-pypsa-result-parity.md`.

#### 8.2 — What MEME *does* give, and the utilization substitute  `[DECIDED 2026-09-30]`

MEME/Coati **do** carry per-wire flow and the wire rating, so the accepted
substitute is **link utilization** (D8), not electrical loading:

| Wire metric | Source (MEME `network.nc` → Coati doc) |
|---|---|
| per-timestep active flow | `links_t_p0` / `links_t_p1` → `transmission_flow["n1::n2"].timeseries` |
| wire rating | `links_p_nom_opt` (`_p_nom_max`) → `capacities["n1::line1"]` |
| wire vs conversion discriminator | `tech_metadata[tech].parent == "transmission"` |
| **utilization** | `\|flow\| / rating × 100` (derived, per timestep) |

Two hard properties to state in the UI, not hide: (i) flow is a hard-bounded LP
variable, so utilization **can never exceed 100%** (best case = binding), unlike
legacy `loading_percent` which *can* overload; (ii) demand profiles attach to
**nodes/buses**, not wires — a wire carries flow, never "load". The wire is only
ever at-most 100% by construction.

#### 8.3 — Target API contract (fill what we can, no schema change)

The consumer is `GetPyPSAResults` (`backend/cmd/main.go:837`,
`internal/result/handler/result_handler.go:267`) → frontend `PyPSAModelResults`
(`frontend/src/features/model-results/api.ts:217`), rendered by `GridPanel.tsx`.
The Go tables already exist (`results_pypsa_line_loading`,
`results_pypsa_settings`, …) — **no migration needed**, only a new writer.

| API field | MEME-sourced? | Mapping |
|---|---|---|
| `line_loading[].line` | ✅ | transmission tech id (`line1`) |
| `line_loading[].bus0/bus1` | ✅ | `transmission_flow.from/to` (node ids) |
| `line_loading[].timestep` | ✅ | `timestamps[i]` |
| `line_loading[].p0` | ✅ | `timeseries[i]` (MW → kW, ×1000 as the legacy streamer does) |
| `line_loading[].p1` | ✅ | `p0 × efficiency` (transport: loss folded into efficiency) |
| `line_loading[].loading_percent` | ✅ *(utilization)* | `\|p0\| / rating × 100` — label it "utilization" |
| `line_loading[].q0/q1` | ❌ | nil (no reactive) |
| `line_ratings` | ✅ | `{line1: p_nom_opt × 1000}` |
| `locations` | ✅ | node ids (from `capacities`/`transmission_flow` keys) |
| `voltage` / `buses_t_*` | ❌ | absent → violation panel empty (GridPanel already tolerates `[]`) |
| `power` | ❌ | absent |
| `transformer_flows` / `transformer_loading` | ❌ | no transformers emitted |
| `convergence` / `settings.converged` | ❌ | **do NOT fake** — no pf stage exists |
| `curtailment` | ✅ (optionally) | from `generation` (`pv`) vs `source`/`p_max_pu` availability |
| `line_ratings` unit | ⚠️ | legacy uses kVA; MEME MW → kW numerically — keep the ×1000 scale consistent with `p0` |

**Crossfill — the same mapping serves Calliope (verified 2026-09-30).** Coati
normalises *both* frameworks to the identical wire contract, so there is exactly
one mapping to write, not two:
- `submodules/Coati/src/coati/results/calliope07.py:222-243` builds
  `transmission_flow` from transmission techs (`base_tech: transmission`,
  `link_from`/`link_to`) via `net_flows(arrivals)` — the **same `net_flows`
  call** pypsa.py:543 uses.
- Real Calliope fixture (`.local/tmp/direct/coati_out.json`, from
  `.local/dependencies/meme/real-calliope-bundle-example.zip`) confirms the
  shape matches the PyPSA one key-for-key:
  `transmission_flow["n1::n2"] = {from:"n1", to:"n2", timeseries:[90.0 ×8]}`,
  `capacities["n1::line1"|"n2::line1"] = 200.0`,
  `tech_metadata["line1"].parent = "transmission"`.
- **Convention:** `transmission_flow` is the **destination-side net arrival**,
  not the origin-side flow — `\|arrival\| = \|origin\| × efficiency`. Verified on the
  PyPSA fixture: raw `links_t_p0` line1 = `33.248` MW, Coati series = `32.170` MW,
  ratio `= 0.967575` = exactly the emitted `links_efficiency`. So map
  `p1 = series[i]` and either `p0 = p1 / efficiency` or accept ≤3% understatement;
  the utilisation numerator should stay on one side consistently.
- **Same caveats, symmetrically:** Calliope transmission is a transport tech too
  (its own `flow_out_eff` / `*_eff_per_distance` losses), so again utilisation
  capped at 100% and no voltage/reactive/convergence. Calliope adds nothing the
  PyPSA leg lacks — it is the *same* wire story from a second solver.
- **Consequence for Step 6/8:** `IngestCoatiResult` should take the per-target
  file (Calliope `results.nc` **or** PyPSA `network.nc`), run `coati`, and feed
  one shared wire-mapping — the PyPSA "branch" is just a second source path into
  the same writer, and a Calliope-only model gets wire utilisation too.

**Leg selection (do NOT merge legs).** `target=pypsa,calliope` runs both frameworks
over the same graph, so their `transmission_flow` series are two *different*
solves of the same wires — concatenating them would double every line row and
make `loading_percent` ambiguous. Serve **one** leg per model: prefer the PyPSA
output (the endpoint is `/results/pypsa` and PyPSA is the electricity-transport
model), fall back to Calliope when the model ran Calliope-only. Merging legs buys
**no new data** — the contracts are symmetric, so the union is the same key set;
it only extends *coverage*, not fidelity.

**Where:** extend the Coati ingest path (`internal/result/service/coati_ingest.go`)
— today it maps the doc → R2 small/summary and explicitly skips large series. Add
a PyPSA branch: locate `files/<target>/run_i/output/network.nc`, run `coati`,
then stream `transmission_flow` + `capacities` into `results_pypsa_line_loading`
(+ `line_ratings` + `locations`). Idempotent (delete-then-store, as Step 6).
Reuse `StreamingInserter`'s batch/flush so the write path stays one shape.

**Not available without an upstream MEME change** (do not attempt downstream):
real `loading_percent`, voltage, reactive, `converged`. Tracked as an upstream
feature request: canonical transmission `s_nom` + emit real `Line` +
`network.pf()` after solve + emit the pf output (see `PYPSA_ISSUE.md` §6).

#### 8.4 — Option C: bypass MEME for the electrical result  `[OPTION 2026-09-30]`

**MEME offers no passthrough** (verified): the route table is fixed
(`internal/api/server.go:85-98` — healthz/capabilities/validate/convert/simulate/
jobs, nothing else), the run command is hardcoded per target (`PyPSA.Plan` →
`Command: ["python","run.py"]`, `pypsa.go:239-250`), `native` is a **column** merge
onto an already-emitted component (`native.go`), not a code seam, and the
whole-model `_native.pypsa.json` sidecar is **written but never read**
(`emitter.go:404` is the only reference — the README's "for the runner to apply"
is not implemented). So MEME is not a proxy to the simulators; nothing outside the
canonical model can enter.

But **TentaCron is** the seam: its targets are arbitrary HTTP endpoints
(`url` + `method` + `response.mode: direct|poll` + optional `proxy: true` — see
`dependencies/TentaCron/environment/config.yaml`). A dedicated target can point at
a PyPSA/grid service we run (the legacy webservice already is one), dispatched
through the same durable queue: idempotency key, poll-to-completion, resume-by-id,
cancel — identical to the meme target, just a config addition plus a target name.

Trade-offs to weigh before choosing it:
- It **re-opens "which service is authoritative"**, and Step 10's "retire at
  parity" narrows to *retire only what MEME covers* (dispatch / capacity
  expansion); the grid-engineering path stays alive.
- A second long-running service to keep healthy (though it exists today).
- Two result shapes land in the store, so ingest/UI must know which produced a run
  — the `model_meme_runs` row records the target, usable as the discriminator.
- It inverts §8.3's "do NOT fake" rule into "do not *need* to fake" — the full
  electrical series arrives legitimately.

Choose between: **A** upstream MEME feature (§8.3 — cleanest long-term, not ours to
schedule) · **B** ship utilization only (D8 — decided, zero cost) · **C** this
bypass (fastest route to full parity, keeps two services).


**Done when:** a PyPSA model submits via TentaCron, results land in the store,
and `/results/pypsa` returns `line_loading` + `line_ratings` + `locations` from
MEME data — with `loading_percent` documented as **utilization**, and
voltage/power/convergence left empty rather than fabricated.

### 9 — Frontend "Run" trigger  `[DONE 2026-09-30 — backend seam + dev affordance]`
Build/send the model config to backend, surface the meme run on a Run affordance
in configurator / model-builder, display returned result.
**Done when:** a user triggers a run from the UI and sees the result.

**DONE (2026-09-30)** — the run seam exists and is reachable from the UI:

- **Backend (`POST /api/v1/models/:id/run-meme`)** — `StartMemeCalculation`
  (`internal/model/service/model_service_calculation.go`) mirrors
  `StartCalculation` (same model fetch, access guard, "already in progress"
  conflict, country resolution, `queue` status + `calculation_started_at`) but
  enqueues `jobs.TypeDispatchMeme` with the run's `model_id`/`user_id` instead of
  the legacy `run_buem`. The shared prep was extracted into `prepareModelRun`.
  Handler `ModelHandler.StartMemeCalculation` (`internal/model/handler/model.go`),
  route registered in `cmd/main.go`.
  - Deliberate dispatch semantics: `MaxRetry(0)` — a retry would land on the
    terminal `failed` run, which the dispatch handler treats as a user re-solve
    and would re-submit (autoheal, forbidden by 6.1); Timeout 60m (above the 30m
    `memePollBudget`).
- **Frontend** — `modelService.runMeme` + `useRunMemeMutation` +
  `handleRunMeme`, threaded to a **dev-only** `Run with MEME` action in
  `ModelActions` (`showRunMeme` → `import.meta.env.DEV`, wired in `ModelTableRow`).
  Same optimistic `queue` transition as the legacy Run. Shown for
  `draft | modified | failed`; i18n `common.modelActions.runWithMeme` in 8 locales.
  The legacy `StartCalculation` path is untouched — this is the new path beside
  it (thesis pattern), not a dual dispatch.
- **Not done here (follow-ups):** the *user-facing* engine choice (the plan's
  memo prefers a runtime experimental toggle over a dev-only flag — a UX change,
  no backend impact); retirement of the legacy dispatch (Step 10); display is
  Step 8.5 + the existing results viewer.
- Verified: `go build ./...` exit 0 · `go test ./...` all ok · `tsc` (only the
  pre-existing `building-configurator` errors) · eslint 0 errors.

### 10 — Retire the webservice path, at parity `[REQ]`
Deactivate the asynq `buem` / `spatialAI_public` dispatch and
`webservice.Client.Forward` behind the new meme route. **Never delete**
dependencies/ or platform-core/webservice — record webservice in the deprecated
register for later removal. Extend `heat_workflow_smoke.sh` with the final
dispatch → meme accepted → result step so the old path is removed only at parity.
**Done when:** the parity gate passes and no code path calls MEME directly
(`[grep]` for the MEME base URL finds only the TentaCron route).

---

## Remaining work (as of 2026-09-30)

Steps 0–6 and 8's ingest are done. Step 7 is deferred by decision. What is left,
grouped by whether it blocks the end state. Detail for the frontend half lives in
`grid-result-capabilities-plan.md`; the heat vector in `heat-patch.md`.

### Blocks the end state

1. **Step 9 — frontend "Run" trigger.** **[DONE 2026-09-30]** Backend seam
   `POST /models/:id/run-meme` → `dispatch_meme` (see §9); a dev-only
   `Run with MEME` action in the model dashboard triggers it. The user-facing
   engine choice (runtime experimental toggle) + Step 10 retirement remain.
2. **Step 8.5 — frontend conditional Grid view** (`grid-result-capabilities-plan.md`
   Phase 4). **[DONE 2026-09-30]** GatedSection (`prod` hides / local shows an
   in-place placeholder), utilization relabel, capability read from the response
   (absent ⇒ least capable), i18n in 8 locales; map bus markers + NetworkTopology
   voltage styling suppressed when voltage is absent. `tsc` green (only the
   pre-existing `building-configurator` errors), vitest 3/3, eslint 0 errors.
   Remaining: observed in the live dev/prod run (below).
3. **Live end-to-end verification of Step 8.** **[OBSERVED 2026-09-30 — first
   full run]** A default model (id 22) went dispatch → TentaCron → MEME
   (`pypsa,calliope`) → zip stored → Coati ingest → `models.status=completed`,
   `result_source=meme`; 9 `results_pypsa_line_loading` rows and `model.results`
   carry the Calliope summary (objective 382.99). `GET /results/pypsa` returns
   `source=meme` + the expected capability block. The earlier two failures along
   the way were (a) `models.status` never leaving `queue` (fixed — see §6.1) and
   (b) Calliope-illegal ids (fixed — see §4). Still open from this run: the `n`
   prefix leaking into result identity, a zero `timestep` on wire rows, and the
   PyPSA-only target. Needs MEME + TentaCron up.
4. **Step 10 — retire the webservice, at parity.** Narrowed by D8/D9: the
   electrical result is out of scope upstream, so "parity" now means *retire only
   what MEME covers* (dispatch / capacity expansion); the legacy PyPSA/grid path
   stays until Option C or an upstream `power_flow` lands. Still needs the
   `heat_workflow_smoke.sh` extension and the deprecated-register entry.

### Loose ends from the work just landed

5. **`infrastructure` submodule commit + pointer bump.** `ResultSource` exists
   only in that submodule's worktree; parent commit `6798239` references a field
   no other checkout has yet.
6. **Migration `047` + `046` — APPLIED 2026-09-30** to the local `spatialai` DB
   during the E2E (`make migrate`): `models.result_source` exists (8 result-bearing
   models backfilled `legacy`, 6 result-less left `NULL`) and `model_meme_runs`
   exists. (Before this the backend could not query models at all.)
7. **Leg consistency (new, undecided).** The result summary + capacities come from
   the **Calliope** document while the wire rows come from the **PyPSA** leg
   (deliberate for wires). Decide whether one leg should serve both, or document
   the split — today it is implicit.

### Deliberately deferred (already decided, do not re-litigate)

8. **Large time-series streaming for MEME results** (Step 6 note, still open). The
   R2 small/summary tables are seeded, but dispatch / generation / demand /
   per-carrier series are **not** streamed — Coati's series are tech- and
   location-aggregated and lack the per-location/per-carrier/timestep dimensions
   those tables need. This is the biggest *functional* gap behind Step 9.
9. **Heat vector** (`heat-patch.md`, D4) — the T1K mapping is electricity-only and
   silently drops heat; retrofitting is a schema change.
10. **Step 7 — run-id diff** (D3) — deferred; the existing frontend result
    comparison covers comparing models/runs.
11. **Coati pip exchange** (D6/D7) — once `enerplanet-coati` is on PyPI, touches
    only `make coati` + `COATI_BIN`.
12. **Upstream MEME request** (`meme-pypsa-result-parity-ask.md`) — with the dev;
    out of scope for now. When it (or Option C) lands, re-enabling the electrical
    UI is a capability flip, not a UI change.

---

## Useful skills

Skills that make executing this plan faster — load the relevant one for the
step, rather than re-deriving approach. (Load via the Hermes skill system; each
carries its own workflow, pitfalls and verification.)

| Skill | What it does | Helps with |
|---|---|---|
| `t1k` | Use the T1K JSON transformer: CLI, Go lib, project integration, mapping authoring | **Step 4** (adopt T1K), adapting/editing the `enerplanet-to-meme` mapping, round-trip verification |
| `meme-result-parsing` | Decode MEME run results into typed data — **now delegated to Coati** (the unified results doc); this skill documents the contract & framing | **Steps 2–3, 6** — naming/key rules, what the Coati document holds |
| `coati` | Use Coati to convert energy-model result files to JSON (CLI + Python API) | **Step 6** — running `coati convert`, the results-document schema, `COATI_BIN`/PATH resolution |
| `code-editing-hygiene` | Edit code via patches, verify, hand off cleanly | **All backend steps (5–8, 10)** — the go-module and schema edits |
| `building-configurator` | Work with the Building Configurator React UI | **Step 9** — frontend Run affordance |
| `enerplanet-ui-conventions` | EnerPlanET React app UI conventions | **Step 9** — keep the trigger consistent with configurator/model-builder |
| `enerplanet-dev-stack` | Wire an EnerPlanET dev-stack service (containers, `make`, local reset) | **Steps 1, 5, 10** — standing up TentaCron/meme targets and the smoke test |
| `debugging-hung-services` | Diagnose a service that hangs, times out, or logs go silent | **Step 1, 5** — the long-poll / async request lifecycle is exactly where these failures hide |

---

## Decision log (decide these before the steps that need them)

| # | Question | Options | Recommended | Needed by |
|---|---|---|---|---|
| D1 | How is T1K consumed? | `go.work` `use()` entry · `go.mod require` (native module fetch) · `replace` · vendoring | **`go.mod require` + native import (DONE 2026-09-29)** — fetch `github.com/enerplanet/T1K@v0.0.0-2026…` like any dependency; don't bind to the local explorer clone | Step 4 `[DONE]` |
| D2 | ~~go-meme-parser standalone vs internal?~~ **Superseded — adopt Coati instead** | build go-meme-parser from scratch · **adopt Coati** (existing Python package, github.com/enerplanet/Coati) | **adopt Coati** (verified it converts real MEME result files; no parser to write) | Step 3 |
| D3 | R3 diff granularity | per-tech + per-timestep · summary only · **none — use existing result-compare flow** | **none for now (2026-09-29):** defer run-id diff to a later task; use the existing frontend result comparison (ComparisonCharts/ComparisonSummary), which already compares two models by results and tolerates a differing building set. per-tech+per-timestep parked for a future engine | Step 7 `[DEFERRED]` |
| D4 | Does buem stay on the path? | yes: meme takes node-level BUEM series · no: meme swallows resolve too | **yes, but phased (2026-09-29):** electricity-first feeds T1K on the CalculationPayload shape; BUEM node-series + heat pump is the heat retrofit in `tasks/heat-patch.md` (buem stays on the path, just deferred as a second vector) | Step 5 + heat-patch |
| D5 | How does the backend dispatch to MEME given TentaCron's own durability? | fire-and-forget submit + rely on backend retry · **treat TentaCron as the durable queue: submit once with Idempotency-Key, persist the job id, resume by id, never resubmit** · synchronous HTTP passthrough | **treat TentaCron as the durable queue (2026-09-29):** TentaCron is the SQLite queue (ADR-0002) and already polls MEME to completion (ADR-0004); a 60s backend deadline caused duplicate submits. Backend submits once with `Idempotency-Key: model_<id>`, persists the returned job id in `model_meme_runs`, long-polls by id on a 30m budget matched to TentaCron's meme poll timeout, reads the raw zip via `/result`, cancels abandoned runs | Step 5 `[DONE]` |
| D6 | How does the Go backend run Coati (Python) to parse a result, and how is Coati integrated? | · subprocess behind a thin interface (Option A) · pure-Go parser · HTTP sidecar service · (integration) plain clone / **git submodule** / pip | **Option A transport + Coati as a hard-dependency git submodule (2026-09-29):** `CoatiRunner` interface + `SubprocessCoatiRunner` shells `coati convert <results.nc> - <framework>` (JSON on stdout; binary via `COATI_BIN` else `coati` on PATH); Go never parses netCDF. Coati lives at **`submodules/Coati`** (version-pinned, updated on demand; `.venv` via `make coati`; pip-exchange to `enerplanet-coati==<pin>` later touches only the target + `COATI_BIN`). Distinct from soft deps in `dependencies/`. | Step 6 `[DONE]` + submodule wiring |
| D7 | Production deployment of Coati (how the container gets a runnable Coati)? | **Option B — bake the venv into the image** (venv-in-container, set `COATI_BIN`) · Option A′ — compile Coati to a self-contained executable and `go:embed` it into the Go binary · Option C″ — pure-Go reimplementation (rejected) | **Option B, venv-in-container (2026-09-29):** the Docker image runs a Python stage that provisions Coati's venv into the image and sets `ENV COATI_BIN=/app/<venv>/bin/coati`; the Go binary stays a thin caller. A "single Go binary with Coati embedded" (A') was evaluated and deferred — it's realistic only as a compiled Coati artifact behind the same `CoatiRunner` interface (a future swap, not now). Once `enerplanet-coati` is on PyPI the image does `pip install enerplanet-coati==<pin>` instead of provisioning the submodule. | Step 6 prod routing (Dockerfile) |
| D8 | What replaces the legacy electrical-grid diagnostics (`loading_percent` / voltage / `converged`) for MEME-delivered PyPSA? | upstream MEME change (canonical `s_nom` + emit real `Line` + `network.pf()`) · **ship link utilization** (`\|flow\|/rating`) as the wire metric, no voltage/convergence · ship nothing (keep PyPSA diagnostics legacy-only) | **ship link utilization (2026-09-30):** flow is a hard-bounded LP variable so utilization tops out at 100% and is NOT electrical loading — expose it as explicitly-labelled "transmission utilization", leave `voltage`/`power`/`convergence` empty rather than fabricated, and file the upstream `s_nom`+`pf()` request separately. Calliope-only parity is too thin a wire story to ship nothing. | Step 8 `[DECIDED]` |
| D9 | If the **full** electrical result is required, where does it run? | **A** upstream MEME feature (§8.3) · **B** stay with utilization only (D8) · **C** a dedicated **TentaCron target** to our own PyPSA/grid service (bypass MEME) | **open — parked as Option C (2026-09-30):** MEME has no passthrough (fixed routes, hardcoded `python run.py`, `native` is a column merge, the `_native.pypsa.json` sidecar is written but never read), so the only bypass seam is TentaCron — its targets are arbitrary HTTP endpoints with the same durable queue semantics. Cost: two live services, "retire at parity" narrows to "retire only what MEME covers", and the store holds two result shapes (discriminate on the recorded target). | Step 8.4 / Step 10 |

---

## Critical-path rule

Steps 1 → 2 → 3 were a hard sequence, and all three are **done** (Coati adopted
and verified, so no parser was built). The backend half of the migration is
complete: **dispatch (5), result ingestion (6, 6.1), and the PyPSA wire route (8)**
are implemented and verified by tests. Step 7 (run-id diff) is **deferred** — the
existing frontend result comparison covers comparing models/runs.

What remains is the **frontend half (9 + 8.5)**, the **live end-to-end run**
(nothing has exercised dispatch → MEME → Coati → store → `/results/pypsa` in the
dev stack yet), and **Step 10's retirement**, whose scope is narrowed by D8/D9.
See [Remaining work](#remaining-work-as-of-2026-09-30) above for the full list,
including the loose ends (submodule pointer bump, migration not yet applied) and
the deliberately deferred items (large time-series streaming, heat, Coati pip
exchange). Step 5's dispatch must still not rely on unverified wire behavior past
what Step 1 proved.

---

## End state / parity gate

A model runs: **dispatch → meme accepted (via TentaCron) → result parsed →
stored → visible**. The webservice's queue/proxy is deactivated (recorded, not
deleted), PyPSA + Calliope land in the same structured store, and the UI can
compare results across runs/models (existing ComparisonCharts flow; a dedicated
run-id diff engine is a deferred later task). No code path calls MEME directly.
