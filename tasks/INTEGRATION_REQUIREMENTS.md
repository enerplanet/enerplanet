# EnerPlanET ↔ MEME — Integration Requirements & Dependencies

Living record of what "full integration" means — the parser changes, database
adjustments, and routing constraints that must hold before EnerPlanET's
backend runs models through MEME and stores the results. This is the
requirements register for the work described in `spec.md` and
`ENERPLANET_TRANSLATOR.md`.

Status legend: `[REQ]` mandatory · `[OPT]` optional · `[BLOCKED]` unverified
against a live MEME server.

---

## Prerequisites — EnerPlanET linkage  `[REQ]`

Prerequisites that govern how the `go-meme-parser` module and the translator
are consumed by the EnerPlanET backend. (Parser-internal prerequisites live in
`spec.md` §2; this list is the *linkage* side.)

| # | Prerequisite | Status | Notes |
|---|--------------|--------|-------|
| P-A1 | **Module wiring** | required | The translator + `go-meme-parser` must be importable from `enerplanet/backend` (`spatialhub_backend`). Decide consumption: Go workspace (`go.work`), a `replace` in `go.mod`, or vendoring. First decider before any code lands in backend. |
| P-A2 | **Dependency direction** | required | `backend → translator → go-meme-parser`. The parser must not import backend packages. Acyclic, as in `spec.md` §3. |
| P-A3 | **Reuse `internal/meme` types** | required | The translator should adopt the proven types/aggregation from `internal/meme/translate.go` + `job.go` rather than re-derive the mapping. Decide whether the translator lives as a new module, or initially *inside* the backend `internal/` and later extracted. See `ENERPLANET_TRANSLATOR.md` §1. |
| P-A4 | **Version pinning between repos** | required | If `go-meme-parser` and the backend are separate modules, pin the parser version the backend builds against (tag/`replace`). A breaking `contract` change must not silently break the backend — CI should enforce. |
| P-A5 | **Result storage owner** | required | The backend owns DB + storage (`internal/store/result`) and consumes `contract.Parse` output. The parser stays DB-agnostic; R3 schema changes live in the backend, not the parser. |
| P-A6 | **`api_key` / MEME endpoint config** | required | Backend supplies `client.BaseURL` + `api_key` from env/secrets. Under R5 the BaseURL is a TentaCron-delegated endpoint, so the key travels with the request body to TentaCron's MEME target. |
| P-A7 | **Translator ↔ result naming agreement** | required, cross-check | The mapping in `ENERPLANET_TRANSLATOR.md` must round-trip with `contract.Parse` (names the translator emits are the keys the parser reads). `payload.Validate` on every `Translate()` output is the enforcement seam. |
| P-A8 | **Live MEME contract sample** | `[BLOCKED]` | A real Calliope (and later PyPSA) `result.json` from the deployed MEME/TentaCron target, to lock `contract` + wiring before full integration. Mirrors `spec.md` P5/P6. |

Core rule: **the backend owns EnerPlanET; the parser owns MEME.** Each side's
world is imported one-way into the other at the translator seam; nothing else
crosses.

---

## R1. Result parsing switches from ZIP to JSON  `[REQ]`

The result pipeline must parse the **frozen contract JSON** (via
`go-meme-parser/client.Result` → `contract.Parse`), not the MEME zip bundle.

**Why:** the current/new MEME zip contains `.nc` (NetCDF) files and other raw
engine artifacts — more complexity than the flat result JSON. Parsing nc files
in Go is heavy and brittle. The contract JSON is the tidy, canonical result
(capacities, dispatch, generation, costs, timeseries) and is what
`go-meme-parser` already understands end-to-end.

**Action:**
- Route result ingestion through `contract.Parse` on the JSON body, not the zip.
- Delete/replace the zip-based parsing in the EnerPlanET result pipeline
  (`internal/result/service/result_service_zip.go`, `result_parser.go` **unless**
  it feeds the tables described in R2 directly from JSON — then port, don't
  delete).

---

## R2. ZIP still required — for user download  `[REQ]`

Keep downloading and storing the **zip** (`client.Bundle`), but archive only.

**Why:** users download the bundle to inspect raw engine outputs / reproduce a
run. The zip is a deliverable, not a parse input.

**Action:** store the bundle (e.g. `result.file_path`) and expose it for
download, but make it a **side artifact** — separate from the JSON-derived
structured results. Never parse the zip for UI data.

---

## R3. Database adjustment — result diffs  `[REQ]`

The structured result tables (the `GetStructuredResults` family in
`internal/store/result/store.go` — capacities, carrier prod/con, energy_cap,
cost, system balance, line flows, PyPSA) must be adapted to diff/compare.

**Why:** EnerPlanET needs to show **result diffs** (run-to-run / scenario
comparison). The current schema stores one model's results keyed by `model_id`;
diffing across two runs currently means pulling both and subtracting in
application code.

**Action (schema):**
- Store each run against a stable **run identifier** (not just `model_id`, which
  is reused across re-runs — see `uniqueModelID`/`sessionID` in
  `internal/payload/payload.go`).
- Capture the input hash + translator version per result so two runs are only
  diffed when the model actually changed, and to identify "the same model, new
  inputs".
- Ensure every result row carries enough identity for a diff join:
  `(run_id, carrier, tech, location, timestep)`.

**Open question to confirm with the team:** what granularity do diffs need —
whole-model summary only, or per-tech/per-timestep? The schema change depends on
this. Default assumption recorded here: per-tech + per-timestep (matches
existing `ResultsCarrierProd` / `ResultsCarrierCon` shape).

---

## R4. PyPSA must be routed through MEME  `[REQ]`

PyPSA runs must be submitted as MEME jobs, **not** run through the existing
local PyPSA engine path.

**Why:** MEME's unified canonical schema is target-agnostic; routing PyPSA
through MEME means one submit/result flow. The existing local PyPSA path should
be deprecated for new runs.

**Action:**
- The translator emits the shared canonical body; `client.Submit` uses
  `?target=pypsa` (`Target = "pypsa"`).
- Keep the PyPSA result tables (`ResultsPyPSAVoltage`, `ResultsPyPSAPower`, …)
  as consumers of the parsed JSON contract, so PyPSA + Calliope results land in
  the same structured store.

---

## R5. Every MEME call MUST go through TentaCron  `[REQ]` `[FLAG]`

> **IMPORTANT FLAG — non-negotiable architectural constraint.**

All outbound calls from the EnerPlanET backend to MEME must be dispatched via
**TentaCron** (`internal/tentacron` client). The backend must **never** call
MEME's HTTP endpoints directly.

**Why:** TentaCron is the orchestrator that owns transient retry, auth/route
config, and async request lifecycle (`POST /v1/requests` then long-poll
`GET /v1/requests/{id}?wait=…`). Direct MEME calls would bypass retry, routing,
and observability.

**Action:**
- `go-meme-parser/client` is reached **only** through a TentaCron target that
  fronts the MEME root (`/simulate`, `/jobs/…`).
- The `client.BaseURL` must be the TentaCron-delegated endpoint, or the client
  is wrapped behind a TentaCron `Do`/`DoTimeout` call — never a raw MEME URL.
- Verify the TentaCron target for MEME exists and is configured before any run.
  **This is currently the `[BLOCKED]` piece** — MEME passthrough
  (backend → TentaCron → MEME) is unverified end-to-end.

---

## Dependencies register

| # | Dependency | Status | Notes |
|---|------------|--------|-------|
| D1 | `go-meme-parser` parser + payload + client packages | buildable now | parsing/report pure; client wire protocol *assumed* |
| D2 | EnerPlanET translator (this work) | buildable now | reuse `internal/meme` translate types |
| D3 | TentaCron target fronting MEME | `[BLOCKED]` | must verify passthrough before live runs |
| D4 | MEME result JSON contract shape | `[BLOCKED]` | inferred from TEMPO `memeClient.js`; confirm against server |
| D5 | DB migration for run-id + diff fields (R3) | pending schema decision | see R3 open question |

---

## Suggested acceptance checklist (full integration)

- [ ] `contract.Parse` turns a real MEME result JSON into typed structs (live, not mocked).
- [ ] Zip stored + downloadable; JSON is the only parse path.
- [ ] Two runs of the same model diff correctly in the UI (per-tech + per-timestep).
- [ ] A PyPSA model submits via MEME/TentaCron and its results land in the structured store.
- [ ] No code path calls MEME directly — `[grep]` for the MEME base URL finds only the TentaCron route.
- [ ] `Translate()` output passes `payload.Validate` with zero Blocking issues.
