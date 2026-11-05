# EnerPlanET — Update plan: merge the isolated PyPSA power-flow onto MEME's canonical `power_flow` mode

**Status:** backend implemented (branch `feature/pypsa-update`) · **Verified against:** `enerplanet` branch `dev` · MEME submodule `a472b68` (main, 2026-10-25) · Coati submodule `71c213c` (main, v0.2.1-alpha) · TentaCron submodule `1e11298` (`feat/enerplanet-integration`)

> **Implementation status (2026-11-04).** The backend half is implemented and green (`go build ./...`,
> full `go test ./internal/...`, `go vet`, gofmt). Decisions taken: **§3B Route 2 (adopt Coati)**,
> **§3C re-point readers (option b, no migration)**, **§3D `curtailment=false`**. Coati submodule **bumped
> to `main` `71c213c` (committed `b44b0f6`)**. Remaining for end-to-end: the **TentaCron `config.yaml`
> two-line change (§3E)**, then a live e2e run.

> **Review revision (2026-11-04).** The first draft carried four unaddressed gaps and one wrong unit
> assumption, all now folded into the change list below and flagged **REVIEW**:
> 1. **Exit-code-3 is closed at TentaCron's poll config — a `config.yaml` change alone** (no Go code,
>    no backend change): a diverged run never even reaches `IngestPyPSAResult` today (§3E).
> 2. **The GET-time disk readers are a parallel legacy path** the ingest list never touched (§3C).
> 3. **`curtailment` cannot be derived from the new layout** but is still declared for `full-grid-pf` (§3D).
> 4. **Coati `main` now ships a native `power_flow` reader** — the simpler parse path, replacing the
>    hand-CSV streaming the original draft kept (§3B, Route 2).
> 5. **Unit correction:** MEME's `*_loading.csv` are ratios (`÷ s_nom`), not percents; `loading_percent` needs
>    **×100**, and `q` needs **×1000** (MVAr → kVar) like the existing `p` kW scaling (§2, §3B).

## TL;DR

The backend *already* runs an isolated PyPSA leg (gated behind a successful Calliope run), but it
sends MEME the **rejected fork payload** (a top-level `power_flow` block) and parses the **legacy
`csv_sim_*`/`convergence_stats.csv` layout**. The pinned MEME (`main` @ `a472b68`) **no longer accepts
the payload** (canonical mode is `experiment.mode="power_flow"` + electrical fields in the model)
and **no longer emits the legacy layout** — it emits `output/power_flow/` + `convergence.csv` + `summary.json`.

So the current isolated PyPSA run produces **nothing end-to-end** against the pinned MEME. The fix is a
payload migration on the send side and a layout migration on the parse side — **not new MEME work**
(MEME already ships the mode). The frontend needs **no structural change**; it is already capability-gated.
**Review addition:** closing the loop also needs (a) TentaCron/dispatch to deliver a diverged-but-tables-present
run to the ingest, (b) the GET-time disk readers migrated, and (c) the capability matrix corrected — see §3C/§3D/§3E.

---

## 1. Current state (verified)

### Send side — REJECTED payload
- Entry: `POST /api/models/:id/run-meme-pypsa` → `ModelHandler.StartMemePyPSACalculation`
  (`internal/model/handler/model.go:879`) → asynq `TypeDispatchMemePyPSA` →
  `jobs.HandleDispatchMemePyPSA` (`internal/jobs/dispatch_meme_pypsa.go:356`).
- Job body built by `meme.TranslatePayload` (T1K, `internal/meme/t1k.go:33`), then
  `injectPowerFlow` (`dispatch_meme_pypsa.go:331-342`) sets a **top-level**
  `jobMap["power_flow"]` = the `pypsapass.PowerFlow` (buses/transformers/lines/generators/loads,
  literal `r_ohm`/`x_ohm`/`s_nom_mva`). The comment justifies top-level because "the `meme-pypsa`
  target's run.py PF mode reads it from there."
- Submitted via TentaCron (`tentacron.Client.SubmitMeme`, target `meme-pypsa`, Idempotency-Key
  `key_<model>_<stamp>_pypsa`); TentaCron → MEME `/simulate?target=pypsa`.

**Problem:** that top-level block is the **rejected fork shape** (ADR-0008). MEME `main` has **no**
top-level `power_flow` key; the canonical contract is `experiment.mode = "power_flow"` +
`experiment.power_flow` + electrical fields in the canonical `model`. On the pinned submodule this
payload does not validate → the isolated run returns nothing.

### Parse side — LEGACY layout
- `jobs.HandleIngestMemePyPSAResult` → `ResultService.IngestPyPSAResult`
  (`internal/result/service/pypsa_ingest.go:190`). **Direct CSV streaming** (not Coati) into
  `results_pypsa_voltage`, `results_pypsa_power`, `results_pypsa_line_loading`, `results_line_flow`,
  `results_transformer_flow`; sets `models.result_source = "full-grid-pf"`.
- `locatePyPSAOutputDir` (`pypsa_ingest.go:62`) looks for a dir named `csv_sim_*`; `readPyPSAConvergence`
  reads `convergence_stats.csv` / `pf_result.csv` (`pypsa_ingest.go:80-138`).

**Problem:** MEME `main`'s `power_flow` branch writes `output/power_flow/` (below), not `csv_sim_*`.
`locatePyPSAOutputDir` returns `""` → **nothing is ingested**.

### GET-side disk readers — a SEPARATE legacy parse path (REVIEW)
The ingest above is the write side. But `GET /api/models/:id/results/pypsa`
(`result_handler.go:339-353`) **re-reads the extracted bundle on every GET** through
`result_helpers_pypsa_files.go`, and every one of those readers hard-codes the legacy tree:
- `readPyPSAConvergenceSummary` → `pypsa_output/convergence_stats.csv`
  (`result_helpers_pypsa_files.go:48-80`)
- `readPyPSACurtailment` → `csv_web/generators-p-t.csv` + `generators-p_set-t.csv` (`:82-100`)
- `readPyPSATransformerLoading` / `readPyPSALineRatings` → `csv_sim_*`/`csv_web`/`lines.csv` (`:170`, `:463`)

So the plan must migrate **both** paths. Doing the ingest alone lands the new data but the GET
still returns empty `convergence`/`curtailment`/`transformer_loading`/`line_ratings`.

### Revealed data (three existing gaps)
`GET /api/models/:id/results/pypsa` (`result_handler.go:282-355`) returns `{source, capabilities,
voltage, power, line_loading, transformer_flows, settings, locations, convergence, curtailment,
transformer_loading, line_ratings}`, capabilities derived from `source`. Current data gaps:
- `v_ang` exists in `results_pypsa_voltage` but is never populated.
- `q` (reactive per-bus power) exists in `results_pypsa_power` but is never populated.
- `loading_percent` is derived from `lines-p0/p1`; the rating isn't persisted (read on disk at GET
  via `readPyPSATransformerLoading`/`readPyPSALineRatings`, `result_handler.go:347-351`).

---

## 2. What MEME `main` (a472b68) actually accepts and emits (verified)

**Payload (canonical):**
- `experiment.mode = "power_flow"`; `experiment.power_flow = {method, slack, distribute_slack, tolerance}`.
  `slack` is **required** (balancing supply id or `id@node`).
- Electrical inputs stay in the **canonical model**:
  - `node.electrical.v_nom` (kV), optional `shunt {g,b}`.
  - `transmission.electrical` — `kind` `line` (`r`/`x` Ω over the arc, or `r_per_length`/`x_per_length`),
    or `transformer` (`r`/`x` per unit of `s_nom`, `tap_ratio`), `s_nom` MVA, `num_parallel`. A line joins
    equal `v_nom`, a transformer different ones.
  - `technology.dispatch` — fixed per-timestep output (MW) → PyPSA `p_set` for supply/conversion/storage;
    demand keeps `demand_profile`.
- In `power_flow` mode nothing may be a decision (expandable capacity/trade/constraints/emissions/scenarios).
- ADR-0009 adds optional reactive fields (`technology.electrical.reactive_dispatch`/`power_factor`,
  `voltage_setpoint`, `node.electrical.shunt`, `transmission.dispatch`). Shipping without them yields
  `q` ≈ 0 (see §3B, item 5).

**Output (inside the zip):** `output/power_flow/`
- `convergence.csv` (index=snapshot; cols `converged` bool, `iterations`) — one row per snapshot.
- `summary.json` `{method, slack, slack_bus, snapshots, converged_snapshots, min_v_mag_pu,
  max_v_mag_pu, max_line_loading, max_transformer_loading, failure}`. **The total is `snapshots`, NOT
  `total_snapshots`** (REVIEW — the legacy reader expects `total_snapshots`).
- `buses-v_mag_pu.csv`, `buses-v_ang.csv`, `buses-p.csv`, `buses-q.csv`
- `lines-p0/p1/q0/q1/loading.csv`, `transformers-p0/p1/q0/q1/loading.csv`
  **— `*_loading.csv` are unitless ratios (`s/s_nom`, e.g. `0.52`), not percents** (REVIEW).
- `generators-p/q.csv`, `loads-p/q.csv`, `storage_units-*.csv`, `links-*.csv`, `shunt_impedances-*.csv`
- `network.nc` is always exported.
- A non-converged snapshot → **exit code 3** (`status "failed"`), all tables still written for diagnosis.
  `summary.json.failure`/`converged_snapshots` distinguish "aborted before solve" from "some snapshots diverged".

---

## 3. The change list (what has to change, in build order)

### A. Send side — emit the canonical payload (obsoletes `injectPowerFlow`)
**IMPLEMENTED:** `injectPowerFlow` removed; new `meme.ApplyPowerFlow`
(`internal/meme/power_flow.go`) folds the pass into the canonical job (mode/slack, node v_nom, arc
electrical, dispatch/demand_profile), strips decisions; wired in `dispatch_meme_pypsa.go`; 5 new tests.
Keep `pypsapass`'s **resolution** step (config catalogue → literal `r`/`x`/`s_nom`, buses/`v_nom`,
generator/load `p_set` from the Calliope `results_flow_out/in.csv`). It already does the hard, correct
work (tech-dedupe of line techs, per-bus series — `dispatch_meme_pypsa.go:257-324`). Change only how the
result is embedded:
1. **Drop the top-level `jobMap["power_flow"]` injection** (`injectPowerFlow`) — the rejected shape.
2. Add a small post-translate Go pass (beside `withoutUnmetDemand`/`applyEnergyPrices` next to
   `t1k.go`) that maps the `pypsapass.PowerFlow` onto the canonical model:
   - `model.nodes[*].electrical.v_nom` from the pass buses;
   - `model.transmission[*].electrical {kind:"line", r, x, s_nom, num_parallel}` from pass lines, and
     `{kind:"transformer", r, x, s_nom}` from pass transformers;
   - `model.technologies[*].dispatch` from pass generators/loads `p_set` (per-timestep);
   - set `experiment.mode = "power_flow"`, `experiment.power_flow = {method:"newton_raphson",
     slack:<the pass's Slack bus generator tech>, distribute_slack:false, tolerance:1e-6}`.
   `slack` is required — `pypsapass` already labels the balancing generator `control:"Slack"`, so derive it.
3. **Strip decision / non-PF fields in `power_flow` mode (REVIEW).** The same translated job also carries
   `capacity.expandable`, trade, constraints, emissions, scenarios from the Calliope planning payload —
   MEME **rejects** all of those in `power_flow` mode (ADR-0008: "nothing may be a decision"). The pass
   must clear them (or assert they are absent) or the run 422s.
4. Keep the two-leg isolation exactly as-is (its own `run-meme-pypsa` route, gated on Calliope result,
   Idempotency-Key, `SaveLeg(MemeLegPyPSA)`, TentaCron `meme-pypsa`). That part is correct and already landed.

### B. Parse side — read the `power_flow/` layout (obsoletes `csv_sim_*`)
**DECIDED: Route 2 (adopt Coati) is implemented** (`pypsa_ingest.go` + new `pypsa_ingest_coati.go`; Coati
runs over `network.nc`, reads `details.power_flow`, fills `v_ang`/`loading%`; `p`/`q` from
`power_flow/buses-p.csv` + Coati reactive). Route 1 below is kept for reference / a possible fallback.

**Route 1 — keep direct CSV streaming (the original draft).** Adapt `IngestPyPSAResult`:
1. `locatePyPSAOutputDir`: also match a dir named `power_flow` (not only `csv_sim_*`). Non-convergence →
   empty PF dir is a **normal** outcome; keep completing the model with the sections gated.
2. `readPyPSAConvergence`: read `power_flow/convergence.csv` (per-snapshot `converged`/`iterations`) and
   prefer `power_flow/summary.json` for the aggregate. **Map `snapshots` → total** (not `total_snapshots`).
   Keep the legacy `convergence_stats.csv` fallback for legacy bundles.
3. Streaming readers: point `StreamPyPSAVoltage/Power/LineLoading/StreamLineFlows/StreamTransformerFlows`
   at the `power_flow/` dir. Filenames already align (`buses-v_mag_pu`, `lines-p0/p1/q0/q1`,
   `transformers-p0/p1`) **except** the new `power_flow/` has no `csv_web/` subdir and no `-t` suffix —
   strip that path assumption.
4. **New readers + unit scaling (REVIEW — the original draft missed both):**
   - `v_ang` ← `buses-v_ang.csv` **radians, no scale** — needs a new column write; today
     `StreamPyPSAVoltage` only fills `v_mag_pu`.
   - `q` ← `buses-q.csv` / `q0/q1` **×1000** (MVAr → kVar, matching the `p` kW convention in
     `openPyPSAPowerFile`); `StreamPyPSAPower` only fills `p` today, so this is new code.
   - `loading_percent` ← `lines-loading.csv`/`transformers-loading.csv` **×100** — MEME writes a ratio, the
     column is a percent; this makes the value reliable and meaningful past 100 %.
5. **`q` ≈ 0 without ADR-0009 reactive fields (REVIEW).** Under a pure `p_set` payload, loads sit at
   unity power factor and generators are `PQ` with zero reactive set-point, so MEME emits `q` ≈ 0.
   Populating the column works but stays ~zero unless the ADR-0009 reactive block is sent. Decide whether
   `Power: true` should imply meaningful reactive (then send it) or just "column populated" (accept ~0).

**Route 2 — adopt Coati for the pypsa leg (REVIEW, RECOMMENDED).** Coati `main` (`71c213c`) now ships a
native power-flow reader (`submodules/Coati/src/coati/results/pypsa_power_flow.py`) that reads
`power_flow/convergence.csv` + the network and emits `details.power_flow` with `voltage_magnitude`,
`voltage_angle`, `reactive_power`, `branch_loading` (already `s/s_nom`), plus
`success`/`termination_condition` (`converged`/`not_converged`). This frees the backend from hand-parsing
CSVs and gives `v_ang`/`q`/loading for free — wire it through the existing Coati ingest (`IngestCoatiResult`)
instead of extending the direct-CSV readers. Choose this if the "adopt Coati, don't build a parser"
convention governs; the ×100 loading / ×1000 q unit handling (§B Route 1 item 4) then applies to Coati's output.

### C. GET-time disk readers — migrate alongside the ingest (REVIEW)
**IMPLEMENTED — option (b), re-point the readers** (`result_helpers_pypsa_files.go`): each reader now
tries `power_flow/` first (convergence from `summary.json`/`convergence.csv`, transformer loading +
line ratings from the flow/loading tables, s_nom derived by inverting `loading = max(|s0|,|s1|)/s_nom`),
then the legacy tree as before. No migration; results_pypsa_settings untouched. Legacy bundles unchanged.
Original options below (option (a), persist-into-DB, was considered and not taken):

`result_handler.go:339-353` reads the bundle on every GET via `result_helpers_pypsa_files.go`, all against
the legacy tree (`pypsa_output/`, `csv_web/`, `csv_sim_*`). Two options, pick one:
- **Persist into DB at ingest (recommended):** write convergence + ratings (`s_nom`) into
  `results_pypsa_settings`/dedicated columns during the pypsa ingest, and make the GET read those rows —
  then the endpoint stops touching the on-disk bundle (model self-contained after a run).
- **Or re-point the four readers** at `power_flow/` (and drop curtailment — §3D).
The original §C only *considered* persisting convergence+ratings; it did not mention the curtailment /
transformer_loading GET readers, which also fail against the new layout.

### D. Capability matrix — `curtailment` cannot be derived from the new layout (REVIEW)
**IMPLEMENTED:** `SourceFullGridPF` is split from `SourceLegacy` in `capabilities.go`, returning
`curtailment:false` (all other electrical flags true); test updated.
`capabilities.For(SourceFullGridPF)` currently mirrors `SourceLegacy` including `Curtailment: true`
(`internal/result/capabilities/capabilities.go:64-73`). But the `power_flow/` output has no
available-vs-actual pair (only `generators-p.csv`; the dispatch is fixed input), so curtailment
**cannot** be derived. Fix: set `Curtailment: false` for `SourceFullGridPF` (as `SourceMeme` already does),
so the Grid hides it — the capability must claim only what the parse path fills. The checklist below was
amended to expect `curtailment` false.

### E. Exit code 3 is closed at TentaCron's poll config, NOT the ingest (REVIEW, load-bearing)
The original draft put exit-3 handling inside `IngestPyPSAResult` ("never a hard failure"). That code but
**can never run as written**:
- MEME exit 3 → job `state "failed"` (`internal/service/jobs.go:90-99`: any non-zero exit → `StateFailed`).
- TentaCron `internal/worker/process.go:487-491`: on `Failed` it calls `failJob` and **never fetches the
  result** (fetch only happens on `Done`). The bundle is never spooled.
- Backend `tentacron.Client.AwaitResultByID` → `awaitTerminal` (`internal/tentacron/client.go:229-230`)
  returns `*TargetError` on TentaCron `failed` → `HandleDispatchMemePyPSA` returns at step 6
  (`dispatch_meme_pypsa.go:470-472`) **before** `FetchResultByID`/store/enqueue.

So a diverged-but-tables-present run produces nothing today. **The minimal fix is a TentaCron **config.yaml**
change alone — no TentaCron Go code, no backend change.** The exit-3 bundle *is* fetchable from MEME
(`handleResult` serves it for any terminal state, and the tables are written before `sys.exit(3)`), so the
whole block is just TentaCron refusing to fetch on `failed`.

**Change:** in `dependencies/TentaCron/environment/config.yaml`, the `meme-pypsa` target's poll block
(lines 90-111). Today:
```yaml
    response:
      mode: poll
      poll:
        id_json_path: "id"
        url_template: "http://meme:8080/jobs/{id}/status"
        status_json_path: "state"
        done_values: [succeeded]
        failed_values: [failed]
```
Change it to treat `failed` as fetchable too (all terminal states deliver a fetchable bundle):
```yaml
    response:
      mode: poll
      poll:
        id_json_path: "id"
        url_template: "http://meme:8080/jobs/{id}/status"
        status_json_path: "state"
        done_values: [succeeded, failed]
        failed_values: []
```
Why both lines (REVIEW): `PollTarget` (`internal/upstream/target.go:243-244`) sets `Done`/`Failed`
independently from these two lists, and the worker's switch checks `Failed` **before** `Done`
(`process.go:487`). So putting `failed` in `done_values` **without removing it from `failed_values`** leaves
`Failed` true and still no-fetch (the config validator also rejects the overlap: `validate.go`
"done_values and failed_values overlap"). Emptying `failed_values` is the required second half.

**Scoping — only `meme-pypsa`, not `meme-calliope`:** keep the Calliope target's `failed_values: [failed]`
(as its block still is at lines 79-80). A failed Calliope run has no bundle worth ingesting — that leg must
stay a hard failure. Only the enrichment PF leg makes "failed but tables present" a normal outcome.

**What the backend does with the delivered bundle (no code change):** TentaCron now reports `completed`
for an exit-3 run → `AwaitResultByID` succeeds → `FetchResultByID` → store → enqueue ingest →
`IngestPyPSAResult` runs its normal "missing / partially-converged `power_flow/` is a normal outcome" logic
(§3B), persisting `summary.json.failure`/`converged_snapshots` and gating the electrical sections. A
genuinely aborted-before-solve run (no `power_flow/` dir at all) publishes the same path with the
convergence verdict from `summary.json.failure`, so it stays `full-grid-pf`/gated rather than hard-failed —
which is the intended "MF enrichment is best-effort" semantic.

**Deployment caveat:** the `api` container bind-mounts `environment/config.yaml` read-only
(`docker-compose.yml:73` → `/etc/tentacron/config.yaml`), and `make tentacron` starts that service — so
editing `environment/config.yaml` is sufficient; apply it with `docker compose restart api` (or re-run
`make tentacron`), then `curl -s localhost:8400/healthz` before testing e2e.
This is the piece that lets §1's "nothing end-to-end" actually become "everything on a converged run,
partial-failed on an exit-3 run". Both `affects.md` (trusts the capability gate) and the checklist
(assumes the bundle reaches the ingest) depend on it.

### F. Obsoleted "planned" MEME work — do NOT do it
The old `tasks/open/pypsa-isolated-run-plan.md` §1C ("make MEME `run.py` PF mode / emit `lines.csv`")
and its B1 blocker are **superseded**: MEME `main` natively ships the mode and the electrical emit.
Keep the plan doc's §1A (Calliope-only default / drop the combined run) and §1B isolation — those are
the parts that are already right — and fold §1C into this canonical-mode migration. No MEME-side change.

---

## 4. Verification checklist

- [x] `go build ./...`, `go vet ./internal/...`, gofmt, and full `go test ./internal/...` green.
- [x] `capabilities.For(SourceFullGridPF)` returns `voltage/power/lineLoading/transformers/convergence/losses`
      true, **`curtailment` false** (§3D).
- [x] `dispatch_meme_pypsa` no longer writes a top-level `power_flow` key; it writes
      `experiment.mode="power_flow"` + `experiment.power_flow.slack` + electrical model fields (5 new
      mapper tests), and no decision/expandable fields leak into `power_flow` mode (§3A.3).
- [x] `IngestPyPSAResult` (Route 2, Coati) ingests a `power_flow` bundle — `v_ang` (radians), `q`
      (**×1000 → kVar**), loading (**×100 → percent**) — sets `result_source = "full-grid-pf"`;
      12 new ingest tests (§3B).
- [x] GET-side readers return convergence/transformer_loading/line_ratings from the `power_flow/` layout
      with legacy fallback; 10 new reader tests + e2e handler test (§3C).
- [ ] Live: a real model → Calliope run → `run-meme-pypsa` → MEME `power_flow` → ingest repopulates
      `results_pypsa_voltage`/`power`/`line_loading` rows (previously empty) **and the GET returns them**.
- [ ] Non-convergence: a diverged run yields a stored bundle that **reaches the ingest** (§3E) and produces
      a complete model with only the converged electrical sections gated, not a hard `failed`.
- [x] Legacy models unchanged (legacy fallback tests green); combined `pypsa,calliope` run stays gone from dispatch.

---

## 5. Relationship to submodules, docs & open decisions

- **MEME** (`dependencies/meme`, `main` @ `a472b68`) — already ships canonical `power_flow`; **no change**.
  Oracle: `docs/decisions/0008-power-flow-as-a-pypsa-run-mode.md`, `0009-reactive-…`, `0010-…`.
- **Coati** (`submodules/Coati`, `main` @ `71c213c`, **bump committed `b44b0f6`**) — ships a
  native `power_flow` reader, adopted as **§3B Route 2**. *The old memo "Coati has no
  electrical-detail key" is **stale*** — Coati `main` emits `details.power_flow`. Note: its power-flow
  report has no per-bus active-power series, so the ingest sources `p` from `power_flow/buses-p.csv`
  and `q` from Coati's aggregated reactive.
- **TentaCron** (`dependencies/TentaCron`, `feat/enerplanet-integration` @ `1e11298`) — **config-only,
  no Go change**: edit `environment/config.yaml` `meme-pypsa` poll to `done_values: [succeeded, failed]`
  + `failed_values: []` so exit-3 bundles reach the ingest (§3E). Keep `meme-calliope` unchanged and
  re-run `make tentacron` after the edit.
- `tasks/open/pypsa-isolated-run-plan.md` — the isolation plan. This doc supersedes its §1B-block shape
  and §1C; §1A/§5-§7 remain valid. When the migration lands, fold the superseded parts and close it.
- `tasks/closed/meme-integration-plan.md`, `tasks/closed/meme-pypsa-result-parity.md`,
  `tasks/closed/grid-result-capabilities-plan.md` — the capability/provenance contract this builds on.
- Frontend impact: see `affects.md` (repo root). **Review change:** affects.md's "the reactive-power path
  should finally be non-zero" (§2 GridPanel) is **not guaranteed** — under the `p_set`-only payload `q` ≈ 0
  (§3B item 5). Update that expectation.
- Open decision (parked, backend): send the ADR-0009 reactive block in the first migration or defer it;
  same question as §3B item 5.