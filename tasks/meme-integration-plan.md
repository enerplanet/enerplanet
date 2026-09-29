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

### 7 — R3 : run-id diff schema `[DECIDE D3]` · schema doc first
Write the schema-change doc (your convention) before any code. Store each run
against a stable run-id + input hash + translator version so two runs diff only
on real model change. Identity for the join per row: `(run_id, carrier, tech,
location, timestep)`.
**Done when:** two runs of the same model diff correctly per the decided granularity.

### 8 — R4 : route PyPSA through MEME
Submit PyPSA as MEME jobs (`target=pypsa`), keep the PyPSA result tables as
consumers of the parsed per-target output (PyPSA `network.nc` / bus+gen CSVs),
so PyPSA + Calliope land in the same store.
**Done when:** a PyPSA model submits via TentaCron and results land in the store.

### 9 — Frontend "Run" trigger
Build/send the model config to backend, surface the meme run on a Run affordance
in configurator / model-builder, display returned result.
**Done when:** a user triggers a run from the UI and sees the result.

### 10 — Retire the webservice path, at parity `[REQ]`
Deactivate the asynq `buem` / `spatialAI_public` dispatch and
`webservice.Client.Forward` behind the new meme route. **Never delete**
dependencies/ or platform-core/webservice — record webservice in the deprecated
register for later removal. Extend `heat_workflow_smoke.sh` with the final
dispatch → meme accepted → result step so the old path is removed only at parity.
**Done when:** the parity gate passes and no code path calls MEME directly
(`[grep]` for the MEME base URL finds only the TentaCron route).

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
| D3 | R3 diff granularity | per-tech + per-timestep · summary only | per-tech + per-timestep (matches `ResultsCarrierProd`/`ResultsCarrierCon`) | Step 7 |
| D4 | Does buem stay on the path? | yes: meme takes node-level BUEM series · no: meme swallows resolve too | **yes, but phased (2026-09-29):** electricity-first feeds T1K on the CalculationPayload shape; BUEM node-series + heat pump is the heat retrofit in `tasks/heat-patch.md` (buem stays on the path, just deferred as a second vector) | Step 5 + heat-patch |
| D5 | How does the backend dispatch to MEME given TentaCron's own durability? | fire-and-forget submit + rely on backend retry · **treat TentaCron as the durable queue: submit once with Idempotency-Key, persist the job id, resume by id, never resubmit** · synchronous HTTP passthrough | **treat TentaCron as the durable queue (2026-09-29):** TentaCron is the SQLite queue (ADR-0002) and already polls MEME to completion (ADR-0004); a 60s backend deadline caused duplicate submits. Backend submits once with `Idempotency-Key: model_<id>`, persists the returned job id in `model_meme_runs`, long-polls by id on a 30m budget matched to TentaCron's meme poll timeout, reads the raw zip via `/result`, cancels abandoned runs | Step 5 `[DONE]` |
| D6 | How does the Go backend run Coati (Python) to parse a result, and how is Coati integrated? | · subprocess behind a thin interface (Option A) · pure-Go parser · HTTP sidecar service · (integration) plain clone / **git submodule** / pip | **Option A transport + Coati as a hard-dependency git submodule (2026-09-29):** `CoatiRunner` interface + `SubprocessCoatiRunner` shells `coati convert <results.nc> - <framework>` (JSON on stdout; binary via `COATI_BIN` else `coati` on PATH); Go never parses netCDF. Coati lives at **`submodules/Coati`** (version-pinned, updated on demand; `.venv` via `make coati`; pip-exchange to `enerplanet-coati==<pin>` later touches only the target + `COATI_BIN`). Distinct from soft deps in `dependencies/`. | Step 6 `[DONE]` + submodule wiring |
| D7 | Production deployment of Coati (how the container gets a runnable Coati)? | **Option B — bake the venv into the image** (venv-in-container, set `COATI_BIN`) · Option A′ — compile Coati to a self-contained executable and `go:embed` it into the Go binary · Option C″ — pure-Go reimplementation (rejected) | **Option B, venv-in-container (2026-09-29):** the Docker image runs a Python stage that provisions Coati's venv into the image and sets `ENV COATI_BIN=/app/<venv>/bin/coati`; the Go binary stays a thin caller. A "single Go binary with Coati embedded" (A') was evaluated and deferred — it's realistic only as a compiled Coati artifact behind the same `CoatiRunner` interface (a future swap, not now). Once `enerplanet-coati` is on PyPI the image does `pip install enerplanet-coati==<pin>` instead of provisioning the submodule. | Step 6 prod routing (Dockerfile) |

---

## Critical-path rule

Steps 1 → 2 → 3 were a hard sequence. Step 1 (TentaCron→MEME passthrough) is
**done**; Step 2's fixture is **done**; Step 3 no longer requires building a
parser — **Coati is adopted** and verified. The parser/parse-path is therefore
no longer `[BLOCKED]` by a live server or by TEMPO inference. Remaining steps
are the **backend dispatch (5), result ingestion (6), diff schema (7), PyPSA
route (8), frontend (9), and webservice retirement (10)**, which may be prepped
in parallel; Step 5's dispatch must still not rely on unverified wire behavior
past what Step 1 proved.

---

## End state / parity gate

A model runs: **dispatch → meme accepted (via TentaCron) → result parsed →
stored → visible**. The webservice's queue/proxy is deactivated (recorded, not
deleted), PyPSA + Calliope land in the same structured store, and the UI can
diff two runs. No code path calls MEME directly.
