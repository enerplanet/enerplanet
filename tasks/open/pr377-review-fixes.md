# PR #377 review fixes — plan

**Status:** active · **Scope:** `feature/pypsa-update` (HEAD `fa0bea4`) · **Reviewer verdict:** CHANGES_REQUESTED (jravani, 2026-11-06)
**Context:** the isolated PyPSA power-flow leg runs end to end on a PV-less, gas-boiler model (converged on all 2160
snapshots, tested merged onto current `dev`). A model **with PV** is rejected by MEME and the Grid tab never gets
convergence/transformer-loading/line-ratings. Line refs below are against `fa0bea4`.

---

## Triage

| # | Severity | Finding | File · line | Fix step |
|---|---|---|---|---|
| B1 | blocking | PV keeps `performance.physics: pv`; MEME rejects a physics model that also carries a fixed dispatch | `internal/meme/power_flow.go` · 160–206 | **F1** |
| B2 | blocking | A battery charges + discharges, so the "in both flow files → it's a line" rule strips it | `internal/jobs/dispatch_meme_pypsa.go` · 301–319 | **F2** |
| B3 | blocking | `/results/pypsa` disk readers use `latestExtractedPath` → the **Calliope** bundle, not the PyPSA one | `internal/result/handler/result_helpers_pypsa_files.go` · 42; `result_handler.go` · 339 | **F3** |
| B4 | blocking | Errors before submit run only `failPypsaLeg` → no leg row, no error text, grey (not red) action | `internal/jobs/dispatch_meme_pypsa.go` · 396–400 | **F4** |
| B5 | blocking | Coati failure completes the leg with **empty** tables; reruns **append** rows | `internal/result/service/pypsa_ingest.go` · 226–275 | **F5** |
| B6 | blocking | Nothing clears the `pypsa` row when Calliope runs again → action stays hidden, stale power flow shown | `internal/model/handler/model_helpers_query.go` · 560 | **F6** |
| N1 | other | NaN cells shift later snapshots (row-skipping breaks index alignment) | `internal/result/service/pypsa_ingest_coati.go` · 222 | N1 |
| N2 | other | `q` sums generators only while `p` is the per-bus **net** → the two columns disagree in meaning | `internal/result/service/pypsa_ingest_coati.go` · 278 | N2 |
| N3 | other | The whole Coati document is buffered in memory (`cmd.Output()`) | `internal/result/service/coati.go` · 88 | N3 |
| N4 | other | Starting the leg flips a **published** model to `completed` | `internal/jobs/pypsa_gate.go`; `model_service_calculation.go` · 241 | N4 |
| N5 | other | `affects.md` + `update-plan-pypsa-powerflow.md` are working notes at the repo root | repo root | N5 |
| N6 | other | List-payload trim, polling stop, Makefile att/auth to be their own PRs | — | N6 |

---

## Resolution log

All blocking issues and every non-blocking item except the PR split are fixed on
`feature/pypsa-update`, one commit each, `gofmt` + `go build ./...` + `go vet ./...`
+ `go test ./internal/...` green (42 packages) before each commit.

| Step | Commit | Status |
|---|---|---|
| F1 | `d2d6b05` fix(pypsa): drop physics performance on fixed-dispatch techs | done |
| F2 | `1163946` fix(pypsa): classify line techs from transmission ids, net storage | done |
| F5 | `460021d` fix(pypsa): fail the leg on coati failure, replace rows in a tx | done |
| F6 | `e038333` fix(pypsa): clear the pypsa leg when calliope re-dispatches | done |
| F3 | `e88ecf1` fix(pypsa): read the pypsa results from the pypsa extract folder | done |
| F4 | `40ee47f` fix(pypsa): record a failed leg on pre-submit errors | done |
| N4 | `83115bf` fix(pypsa): keep the model status on the pypsa leg | done |
| N1+N2 | `36dee03` fix(pypsa): keep Coati table alignment and use the net reactive | done |
| N3 | `d77607e` fix(pypsa): stream the coati document instead of buffering it | done |
| N5 | working notes moved out of the repo root into `.local/docs/` (gitignored) | done |
| N6 | PR split (list payload / polling / Makefile as their own PRs) | **open — decision for Stefan** |

**Still to do after review:** live validation (see the validation checklist handed
to Stefan) and the N6 split decision.

---

## Blocking fixes

### F1 — drop `performance` on every tech that gets a fixed dispatch
**Files:** `internal/meme/power_flow.go` (generator loop ~L160–176, slack block ~L199–206)

MEME's validator rejects a physics model without a precomputed profile **before** it looks at `dispatch`
(`dependencies/meme/internal/target/validate.go:364`):
`HTTP 422: tech pv_supply_1: physics model "pv" requires a precomputed profile for target "pypsa"`.

- Add a small helper (e.g. `stripPerformance(tech map[string]json.RawMessage)`) that deletes `performance` from the
  technology **and from every `node_overrides[<node>]`** entry.
- Call it on every technology **that receives a fixed `dispatch`**: each `pf.Generators` tech and the slack tech.
  Leave it on demand techs (they carry `demand_profile`, not dispatch) unless MEME rejects those too — confirm in the
  live run.
- Order matters: strip **after** `ensureTech` resolves the tech object and before it is written back to `techs`.

**Verify:** unit test asserting no technology carrying `dispatch`/series also carries `performance`; then a live model
with PV completes the leg (this is the failure currently blocking the battery path from ever being reached).

---

### F2 — classify line techs from the topology, and give storage its net dispatch
**Files:** `internal/jobs/dispatch_meme_pypsa.go` (link-tech strip, ~L301–319)

A storage tech appears in **both** `results_flow_out.csv` and `results_flow_in.csv` (charge + discharge), so the
"present in both files = it's a line" discriminator deletes it from both sides. Its dispatch never reaches the power
flow, and MEME then rejects the tech for having no dispatch (or it is missing from the network).

- Replace the two-file heuristic with an **explicit line-tech set derived from the model's transmission ids** (the
  arcs the saved job/payload actually carries). Strip only those from both prod and con.
- Every tech that survives **and appears in both files** is storage: set `dispatch = flow_out − flow_in` (net) rather
  than dropping it.
- **Open point to confirm while implementing:** the flow CSV link techs look like `lv_1_trafo_82` while the pass's
  line names are `<pipe>_<i>` (`resolver.go`). Pin down the exact id the transmission arc carries in the translated
  job before wiring the set — match on the transmission id, not on a reconstructed name.

**Verify:** unit test over a synthetic flow-CSV pair containing a battery + a line tech → battery survives with the
net series, line is stripped; live model with a battery.

---

### F3 — read the PyPSA bundle, not the Calliope one
**Files:** `internal/result/handler/result_helpers_pypsa_files.go` · 42; `internal/result/handler/result_handler.go` · 339;
`internal/result/service/pypsa_ingest.go`; `internal/models/model_meme_run.go`; `internal/store/memerun/store.go`; new migration

`latestExtractedPath` returns the newest `model_results.extracted_path` — the **Calliope** bundle. The PyPSA zip is
unpacked into its own `model_<id>_<ts>/` folder and **never gets a `model_results` row**, so
`convergence`, `transformer_loading` and `line_ratings` are always absent although the capabilities declare them
(live: `GET /results/pypsa` returns only voltage, power, line loading).

- Add an `extracted_path` column to `model_meme_runs` (new migration, e.g. `059_add_extracted_path_to_model_meme_runs.sql`).
- Persist the extract dir in `IngestPyPSAResult` onto the **pypsa leg** row (`extractDir` is already computed at
  `pypsa_ingest.go:213`).
- Add a pypsa-specific resolver (e.g. `LatestLegExtractedPath(modelID, MemeLegPyPSA)`) and use it in the
  `GetPyPSAResults` handler instead of `latestExtractedPath`; keep the Calliope-bundle fallback only for legacy
  bundles that have no pypsa path recorded.

**Verify:** handler test with a pypsa leg row pointing at a pypsa fixture → convergence/transformer_loading/line_ratings
present; live Grid tab shows all three sections.

---

### F4 — record a failed leg on pre-submit errors
**Files:** `internal/jobs/dispatch_meme_pypsa.go` (defer ~L396); `internal/store/memerun/store.go`

Errors before submit (bundle not found, no slack, CSV parse) run only `failPypsaLeg`: the model returns to its prior
status, **no leg row is written and nothing is logged** — the error exists only in the archived Asynq task and the
dashboard shows a grey, not red, action.

- In the `retErr != nil` defer, **before** `failPypsaLeg`, upsert the pypsa leg row to `status=failed` with the error
  text. Reviewer's suggestion is `SaveLeg(..., failed, err)`; a dedicated `MarkLegFailed`/`RecordLegFailure` upsert
  that preserves an already-recorded `run_id` is cleaner (a `running` row must not be clobbered into an empty one).
- Keep `failPypsaLeg` (it owns the model-status restore — see N4).

**Verify:** unit test: handler erroring early (missing bundle) leaves a pypsa leg row with `status=failed` and the
error message; the dashboard renders red. Live: trigger a pre-submit failure and confirm the red action + tooltip.

---

### F5 — a Coati failure must fail the leg; reruns must not append
**Files:** `internal/result/service/pypsa_ingest.go` · 226–275; `internal/result/service/pypsa_ingest_coati.go`;
`internal/result/service/result_streaming.go`

When Coati fails, `pf` is nil and the block is skipped; a `power_flow/` bundle has no `csv_sim_*`, so the legacy path
ingests **nothing** and the leg still completes with empty tables. Stream errors are only warnings. And rows are never
deleted first, so a **second run doubles** them.

- When `network.nc` + `power_flow/` exist, the Coati route **must** succeed: if `pypsaCoatiDocument` returns a nil
  `pf` (convert, decode, or no power-flow record), **return the error** instead of falling through to the legacy CSV
  path (which can only ingest nothing for this layout).
- Make the `streamCoati*` errors **fatal**, not `log.Warnf`.
- **Delete then insert** the model's `results_pypsa_voltage` / `results_pypsa_power` / `results_pypsa_line_loading`
  rows in **one transaction** before streaming (extend `StreamingInserter` or add a tx helper).
- Only flip `model.result_source = full-grid-pf` **after** a successful ingest.

**Verify:** unit tests — Coati error → `IngestPyPSAResult` returns an error (leg fails, not "completed, empty"); a
second ingest leaves the row count unchanged. Live: rerun the leg, verify counts stable and `GET /results/pypsa`
non-empty.

---

### F6 — invalidate the pypsa row when Calliope re-runs
**Files:** Calliope dispatch entry (`internal/jobs/dispatch_meme.go` / `internal/model/service/model_service_calculation.go`
`StartMemeCalculation`); `internal/store/memerun/store.go`; `internal/model/handler/model_helpers_query.go` · 560

Nothing clears the `pypsa` row when Calliope runs again. After a rerun the action stays hidden and the **old** power
flow is shown against the **new** Calliope results.

- When a Calliope dispatch starts, delete (or mark stale) the model's `pypsa` leg row, so
  `populatePyPSALegStatus` returns `""` and the dashboard re-shows the action.
- Prefer delete for simplicity (the pypsa leg is a derived add-on with no independent value once its base moved);
  a `stale` status is the alternative if history must be kept. Decide and record the reason.

**Verify:** unit test on the Calliope dispatch start; live: rerun Calliope → the PyPSA action reappears and the Grid
tab no longer shows the previous power flow as current.

---

## Non-blocking follow-ups

**N1 — NaN cells shift later snapshots.** `powerFlowBusTable` (`pypsa_ingest_coati.go` · 222) skips a cell it cannot
parse, shortening that component's series so every later snapshot shifts by one. Keep index alignment: append a
placeholder for the diverged snapshot (the convergence record already flags it) instead of skipping the index.

**N2 — `q` basis ≠ `p` basis.** `p` is the per-bus net injection (from `buses-p.csv`); `q` is the per-location sum of
**generator** reactive power (`pypsa_ingest_coati.go` · 278). They are not the same basis. Either read the per-bus net
reactive table if MEME writes one (`buses-q.csv`), or document/mark `q` explicitly as a generator-only sum so the chart
does not read as a net balance.

**N3 — Coati document fully buffered.** `coati.go` · 88 uses `cmd.Output()`, holding the whole document in memory.
Stream stdout through a `json.Decoder` (or a temp file) to avoid buffering the full document.

**N4 — a published model is demoted to `completed`.** `StartMemePyPSACalculation`
(`model_service_calculation.go` · 241) sets `status=queue` unconditionally and `failPypsaLeg` restores `completed`
unconditionally (`internal/jobs/pypsa_gate.go` — `pypsaFailureStatus`). Remember the model's status **before** the leg
and restore *that* (a `published` model stays `published`); `ModelStatusPublished` already exists in
`infrastructure/common/pkg/models/model.go`.

**N5 — working notes at the repo root.** `affects.md` and `update-plan-pypsa-powerflow.md` sit at the root and are
review noise. Fold the still-true decisions into `tasks/open/pypsa-isolated-run-plan.md`, move pure working notes to
`.local/` (gitignored), and remove both from the root.
**Done:** both moved to `.local/docs/` and `git rm`'d from the repo (`.local/` is gitignored, so they stay on disk
locally but are gone from the tree). Neither was referenced by any code or tracked doc.

**N6 — PR split.** Reviewer: the list-payload trim, the idle-polling stop and the Makefile dev-stack attaches "would
review faster as their own PRs". Consider splitting this branch into (a) PyPSA leg backend fixes, (b) dashboard
payload/polling, (c) Makefile dev-stack attaches — after the blocking fixes land.

---

## Suggested order (dependency-led, one commit each)

1. **F1** — unblocks every model with PV (nothing else is reachable without it). *Commit: `fix(pypsa): drop physics on fixed-dispatch techs`*
2. **F2** — storage survives the flow-CSV pass. *Commit: `fix(pypsa): classify lines from topology, give storage net dispatch`*
3. **F5** — the ingest stops lying (empty tables + doubled rows). *Commit: `fix(pypsa): fail leg when coati fails, replace rows in a tx`*
4. **F6** — the stale-row invalidation (store change lands with F5's migration). *Commit: `fix(pypsa): clear leg status on calliope rerun`*
5. **F3** — the pypsa extract-path column + readers. *Commit: `fix(pypsa): read results from the pypsa extract folder`*
6. **F4** — pre-submit failure still writes a failed leg row. *Commit: `fix(pypsa): record failed leg on early errors`*
7. **N4, N1, N2, N3, N5** — non-blocking cleanups, one commit each.
8. **N6** — decide the PR split once the blocking set is green.

## Verification checklist (before replying to the reviewer)

- [ ] `go build ./...`, `go vet`, `gofmt -l` clean
- [ ] `go test ./internal/meme/... ./internal/jobs/ ./internal/model/handler/ ./internal/result/...` green
- [ ] New tests: F1 physics-strip, F2 battery-vs-line, F4 early-failure leg row, F5 coati-failure + no-double, F6 rerun invalidation
- [ ] `tsc -b` clean (frontend untouched by F1–F6, but the leg-status contract is consumed by the dashboard)
- [ ] Live, model **with PV + battery + 3 grid regions**: leg completes; Grid tab shows convergence + transformer loading + line ratings
- [ ] Live: a forced Coati failure fails the leg (red action), not "completed, empty"
- [ ] Live: Calliope rerun re-shows the PyPSA action; a published model stays published
