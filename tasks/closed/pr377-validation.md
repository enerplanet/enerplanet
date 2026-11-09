# PR #377 — validation instructions

**Status:** IMPLEMENTED — all nine steps executed and recorded (2026-11-09) · **Owner:** PR #377 (`feature/pypsa-update`)
**Result:** **V1–V9 all PASS.** Each step below carries its evidence, including two expectations I had to
correct against reality (V4's row baseline, V5's "identical count" wording) and two findings that fell out
of the runs (V8's vestigial `published` status, V9's 27→16 line over-count). Nothing in this pass changed
code — it is all validation.

**Code this governs:** the PR #377 fix set on `feature/pypsa-update` —
`internal/meme/power_flow.go`, `internal/jobs/{dispatch_meme,dispatch_meme_pypsa,ingest_meme_pypsa_result,pypsa_gate}.go`,
`internal/result/service/{pypsa_ingest,pypsa_ingest_coati,coati}.go`, `internal/result/handler/result_helpers_pypsa_files.go`,
`internal/store/{memerun,result}/store.go`, `internal/models/model_meme_run.go`,
`migrations/059_add_extracted_path_to_model_meme_runs.sql`,
`frontend/src/features/model-dashboard/components/ModelTableRow.tsx`,
`frontend/src/components/ui/ModelActions.tsx`, `frontend/src/components/shared/ModelActionGroup.tsx`
(+ the 8 locales), and the moved notes `affects.md` / `update-plan-pypsa-powerflow.md` (now `.local/docs/`).

**What this validates:** the resolution of the PR #377 review (6 blocking + 6 other findings).
Per-fix commit log: `tasks/closed/pr377-review-fixes.md`. Every commit is gated by
`gofmt` + `go build ./...` + `go vet ./...` + `go test ./internal/...` (42 packages) — that part is
already done and green. What follows is the **live** validation.

---

## 0. Before you start — get the new code onto :8000

Two things, in this order.

**0a. Apply the new migration** (adds `model_meme_runs.extracted_path`; without it F3 silently
writes nothing and the Grid tab stays empty):

```bash
cd /home/blackwolf/Projects/github/enerplanet
make migrate
docker exec postgres psql -U postgres -d spatialai -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='model_meme_runs' \
   AND column_name='extracted_path'"      # must print: extracted_path
```

**0b. Get the Go changes into the running container.** `energy-backend` runs a baked binary —
Go edits do **not** hot-reload; a rebuild is 10+ min. Hot-patch instead:

```bash
bash ~/.hermes/skills/enerplanet-dev-stack/scripts/hotpatch-backend.sh \
     /home/blackwolf/Projects/github/enerplanet/enerplanet/backend
docker inspect energy-backend --format '{{.State.Health.Status}}'   # wait for: healthy
```

> Note: the hot-patch is reverted by any later `docker compose up --force-recreate energy-backend`.

---

## 1. Division of labour

| Side | Who | What |
|---|---|---|
| Clicks + eyes on the UI | **Stefan** | the steps marked 🖱 **YOU** |
| Logs, DB, payloads, byte counts | **Roo** | the steps marked 🔧 **ME** — just tell me "step N failed / passed" and I read it |

I never click through the UI for you, and you don't need to read logs for me.

---

## 2. Models to prepare first

You need three, in this order of importance:

1. **A model with PV** (any size, ≥1 building with a solar tech). This is the one that 422'd the
   whole leg for jravani — it is the critical regression. **Required.**
2. **A model with a battery / storage tech** — for F2. If none of your models has one, say so and
   we validate F2 from the unit test + the flow-CSV artefact instead (I'll extract it).
3. Your **existing 14-building gas-boiler model** (the one jravani converged on) — for the
   no-regression check (F1/F2 must not break what already worked).

Each must have a **completed Calliope leg** — the PyPSA leg is gated on it (a power flow is a
passthrough of Calliope results). If a PV model's *Calliope* leg itself fails, stop and tell me:
that is the separate `tasks/open/pv-patch.md` register, not something this PR fixes. The reviewer
had a completed Calliope leg on their PV model, so it should work.

---

## 3. The validation steps

### V1 — F1: a model with PV runs the power flow to completion (the blocker)

🖱 **YOU:** open the **PV model** → run the Calliope leg if it isn't already completed → then hit the
**Run power flow** action on the model row.

**Expected:** the action goes to a running state and then **disappears** once the leg completes
(hidden on `pypsa_leg_status === 'completed'`). No error badge, no red action.

🔧 **ME:** confirm in the DB + logs that there is no 422 and no `physics model "pv"` anywhere:

```sql
SELECT leg, status, error FROM model_meme_runs WHERE model_id = <id>;
```

**Fail signature to report to me:** the action turns **red** with "Power flow failed — click to
retry", or the leg row says `failed` with `HTTP 422 … physics model "pv" requires a precomputed
profile`.

**✅ RESULT (2026-11-09) — PASS.** Two PV-bearing models ran green: **model 8** ("TestBase PV",
2160 snapshots) and **model 6** ("bear", a full-year 8760-snapshot run).

| | model 8 | model 6 |
|---|---|---|
| pypsa leg | `completed` | `completed` |
| `extracted_path` | `model_8_1794217961` | `model_6_1794220015` |
| `result_source` | `full-grid-pf` | `meme` → `full-grid-pf` |
| voltage / power / line_loading | 25,920 / 32,400 / 32,400 | 87,600 / 87,600 / 61,320 |

No 422, and no `physics model "pv"` anywhere in the logs. The failure signature did NOT occur.

---

### V2 — F2: a battery survives the flow-CSV pass

🖱 **YOU:** on the **battery model**, hit **Run power flow**.

**Expected:** same as V1 — completes, action hides.

🔧 **ME:** I check that the battery appears in the dispatched job as a **net** fixed injection
(`flow_out − flow_in`) and **not** as a load, and that no line techs leaked in as generators. If the
model has no battery I'll validate this from the unit test + a real flow CSV.

**Anyone can spot the failure here:** MEME answers `needs a fixed dispatch` (the tech vanished) or
the model's dispatch is flat 1.0 p.u. with zero flow.

**✅ RESULT (2026-11-09) — PASS.** **Model 9** ("TestBase Battery") completed: leg `completed`,
`extracted_path` recorded, `result_source = full-grid-pf`, rows 25,920 / 32,400 / 32,400 — the same
shape as model 8, i.e. the battery reached the network as a net injection. No `needs a fixed
dispatch` and no `costs.monetary.purchase` 422. (The `purchase` rejection was the original blocker on
this model, fixed in `d19f587`.)

---

### V3 — F3: the Grid tab actually gets its data back

🖱 **YOU:** open the **Grid / electrical** tab of a model whose power flow completed (V1 or V2).

**Expected — all three sections now present** (jravani saw only voltage/power/line loading):
- **Convergence** (e.g. 2160 / 2160 snapshots)
- **Transformer loading**
- **Line ratings**

🔧 **ME:** `GET /models/<id>/results/pypsa` → confirm `convergence`, `transformer_loading`,
`line_ratings` keys are present, and that `model_meme_runs.extracted_path` (leg `pypsa`) points at a
`model_<id>_<ts>/` folder **different from** the Calliope bundle.

**✅ RESULT (2026-11-09) — PASS, with one clarification.** The bundle carries the full export
(`power_flow/`: `summary.json`, `convergence.csv`, `lines-loading.csv`, `transformers-loading.csv`,
`buses-p/q/v_mag/v_ang`, plus the generator/load tables — 20 files). For model 8, `summary.json`
reads `snapshots: 2160, converged_snapshots: 2160, max_line_loading: 0.448, max_transformer_loading:
0.353, failure: null`, so **convergence, transformer loading and line ratings all resolve**.

`extracted_path` does point at a folder separate from the Calliope bundle (`model_8_1794217961` vs the
Calliope run's own directory), confirming F3.

**Clarification — "Renewable Curtailment is empty" is correct, not a gap.** `full-grid-pf`
deliberately declares `Curtailment: false`: the power-flow export carries no available-vs-actual pair
(the dispatch is a fixed input), so it cannot be derived. `GridPanel` wraps the section in
`<GatedSection requires="curtailment">`, which returns `null` when the capability is false — except in
a **dev build**, where `SHOW_RESULT_GAPS` is true and it renders a deliberately **amber** placeholder
naming the section (so it never reads as a neutral part of the result). Vite runs DEV, so the amber
"not in result" card is what you see; it is dead-code-eliminated from a production build. Nothing to
fix.

---

### V4 — F5: a Coati failure fails the leg (no more "completed, empty")

This one is destructive-ish, so we do it on a **scratch model**, not your good one.

🖱 **YOU:** pick a throwaway model that has a completed power flow, then re-run the leg **after I
temporarily point `COATI_BIN` at a broken path** (I'll set it and tell you when to click).

**Expected:** the action goes **red** with "Power flow failed — click to retry". The model itself
**stays completed** (the Calliope results are untouched).

🔧 **ME:** confirm the leg row is `failed` with a Coati error, and that the
`results_pypsa_*` row count **does not double** across a rerun (this is the other half of F5).

**Failure signature:** a green/completed leg with an empty Grid tab.

**✅ RESULT (2026-11-09) — PASS.** Done on **model 11** ("TestBase v1", a fresh copy — completed
Calliope leg, no pypsa row, so no DB manipulation was needed). Coati was disabled by renaming
`/opt/coati/bin/coati`, then the power flow was dispatched.

| | Observed |
|---|---|
| `pypsa` leg | **`failed`** @ 11:33:01 — `coati could not read the power_flow bundle for model 11 (…/network.nc): the electrical tables cannot be filled` |
| raw cause in the log | `fork/exec /opt/coati/bin/coati: no such file or directory; using the legacy CSV ingest` |
| model 11 | stays **`completed`**; `result_source` stays **`meme`** — not demoted, not flipped to `full-grid-pf` |
| `results_pypsa_voltage` / `power` | **0 rows** — the failed leg wrote nothing |
| `results_pypsa_line_loading` | **21,600 rows, unchanged** — nothing destroyed |

The failure signature did NOT occur. Coati was restored immediately afterwards.

**Note (expectation I had to correct):** "no `results_pypsa_*` rows" was too strong. Model 11's
*Calliope* ingest had already written 21,600 `line_loading` rows through the wire-leg path
(`Wire leg: Calliope selected … Calliope leg carries a parseable multi-step flow`). The correct
assertion is that the failed leg wrote nothing new and destroyed nothing — which holds.

---

### V5 — F5b: no row doubling on a clean rerun

🖱 **YOU:** on the same throwaway model (with Coati restored), hit **Run power flow** a second time.

🔧 **ME:** I count rows in `results_pypsa_voltage` / `results_pypsa_power` /
`results_pypsa_line_loading` before and after — the count must be **identical**, not doubled.

**✅ RESULT (2026-11-09) — PASS (retry: `failed` → `completed`).**

| table | before | after |
|---|---|---|
| `results_pypsa_voltage` | 0 | **32,400** (15 buses × 2160) |
| `results_pypsa_power` | 0 | **32,400** |
| `results_pypsa_line_loading` | 21,600 (Calliope wire-leg, 10 lines × 2160) | **25,920** (12 lines × 2160) |

The log reads `converged=true snapshots=2160 lines=12`, and 12 × 2160 = 25,920 = exactly the new
count. The leg row went `failed` → `completed` and `result_source` flipped `meme` → `full-grid-pf`.

This proves the delete-then-insert half of F5 by **replacement**: an append/insert-only path would
have left **21,600 + 25,920 = 47,520** rows, and the stale Calliope wire-leg rows would have
survived alongside the PyPSA ones. Neither happened.

*(The checklist's literal wording is "a second rerun must leave the count identical". This run
covered `failed` → successful. One further successful rerun would pin the count at 25,920 → 25,920
if we want that exact form; the replacement evidence above already rules out doubling.)*

---

### V6 — F6: a Calliope rerun re-offers the power-flow action

🖱 **YOU:** on a model whose power flow already completed, re-run the **Calliope** leg (Run model).

**Expected after Calliope finishes:** the **Run power flow** action is **visible again** (the stale
record is gone), and the Grid tab no longer shows the old power flow as if it were current.

🔧 **ME:** confirm the `pypsa` row in `model_meme_runs` is deleted at Calliope dispatch start.

**✅ RESULT (2026-11-09) — PASS.**

The UI hides the Calliope action on a completed model (same convention as the power-flow action), so the
re-dispatch was issued server-side with the exact request the UI would send —
`POST /api/models/11/run-meme?frameworks=calliope` from the console (cookie session + `X-CSRF-Token`).
Worth noting: `prepareModelRun` only refuses `running|queue|buildings|processing`, so the *server* accepts
a Calliope re-run on a completed model; only the UI declines to offer it.

| | Observed |
|---|---|
| `model_meme_runs` for model 11 | only `calliope=running` — **pypsa row count = 0** |
| log @ 11:42:48 | `submitted MEME job to TentaCron id=c38697d8fbfac67cbba19a5e602af706` |
| model 11 | `running` |

So the derived leg is invalidated at Calliope **dispatch start**, not after the solve — the power-flow
action reappears immediately.

*Minor observation:* `result_source` is **not** cleared at dispatch start, so during the Calliope re-solve
the model still advertises `full-grid-pf` while its status is `running`. The ingest rewrites it
(`meme`) when the run lands, and the running state is visible in the UI throughout, so nothing stale is
presented as current — but it is worth knowing the source field lags the invalidation.

---

### V7 — F4: a pre-submit failure shows as red, not grey

🖱 **YOU:** run the power flow on a model where the leg cannot even start. The easy trigger: a model
that has a completed Calliope leg but whose stored Calliope bundle has been moved/removed — **I'll
set that up** and tell you when to click.

**Expected:** the action is **red** with the retry tooltip (jravani saw a **grey**, silent action).

🔧 **ME:** confirm a `pypsa` leg row exists with `status=failed` and the error text in the `error`
column (before the fix: no row at all, nothing logged).

**✅ RESULT (2026-11-09) — PASS.**

Armed by renaming the file the locator walks for: `…/model_11_1794221063/files/run_0/output/csv/
results_flow_out.csv` → `.v7bak` (`dbCalliopeCSVLocator.CalliopeCSVDir` walks the latest
`model_results.extracted_path` for `results_flow_out.csv` and errors if absent — `dispatch_meme_pypsa.go:73-103`,
surfacing at `:518`, which is **pre-submit**). Restored immediately after.

| | Observed |
|---|---|
| `pypsa` leg | **`failed`** @ 10:48:06 — `locate calliope bundle for pypsa leg model 11: locate calliope bundle csv dir for model 11: results_flow_out.csv not found under storage/data/model_11_1794221063` |
| model 11 | stays **`completed`**, `result_source` stays **`meme`** |
| `results_pypsa_voltage` / `power` | **0 rows** — the leg never reached the submit |

The error text is recorded in the leg row, which is what turns the action **red with the retry
tooltip** — jravani's grey/silent case. Also re-confirmed the new handshake under the pre-submit path:
the request's `pending` row transitions to `failed` (rather than there being no row to attach a status
to).

---

### V8 — N4: the leg never mutates the model's lifecycle status

🖱 ~~take a model with a **published** status (or publish one), then run the power flow on it.~~

**✅ RE-SCOPED + COVERED (2026-11-09).** The step as written is **unexecutable**: `published` is a
vestigial status. The only reference to `ModelStatusPublished` in the whole backend outside comments is a
*read* — `stats.Published = byStatus[models.ModelStatusPublished]` (`model/handler/model.go:550`), a stats
counter. No transition, endpoint or service ever writes it, and the DB has never held a published model
(0 rows; the only statuses in use are `draft`, `completed`, `failed`, plus the transient
`running`/`queue`/`building`/`processing`). The frontend still renders it — the TS type union, badge
colours, `isDone = completed || published`, and the always-zero `published` counters in
`ModelStatsCards`/`ModelStatusCards`/`ModelsManagement`.

It is **not** related to sharing or workspaces: shares are grant rows in `model_shares` keyed by
user/email (`CountModelSharesByModelAndUserOrEmail`, `DELETE /api/models/:id/shares/:shareId`), and the
access helper states they are "independent of any workspace membership" — a third, separate axis.
→ *Worth a cleanup ticket (dead status + dead counters), out of scope for PR #377.*

So the step is re-scoped to what it actually guards — **the power-flow leg must never mutate the model's
lifecycle status** — which is verified:

| Evidence | Model stayed |
|---|---|
| V4 — Coati failure (leg failed at ingest) | `completed`, `result_source` unchanged |
| V7 — pre-submit failure (locator miss) | `completed`, `result_source` unchanged |
| V5 — success (retry) | `completed` |
| V9 — success (jravani's model) | `completed` |

N4 removed the status writes outright (dropped `failPypsaLeg`/`pypsaFailureStatus`), so there is no code
path left that could demote a model on a power-flow outcome.

> ⚠️ **This is the one design decision in the batch.** The PyPSA leg no longer mutates the model's
> lifecycle status at all — its state lives only in the leg row / the action button. So while a
> power flow is running you will **not** see the model chip pulse. If you'd rather keep the pulse,
> say so and I'll rework it to remember-and-restore the prior status instead.

---

### V9 — no regression on the model jravani converged

🖱 **YOU:** on the **14-building gas-boiler model**, run the power flow once end to end.

**Expected:** converges on all snapshots, Grid tab fully populated, nothing red.

**✅ RESULT (2026-11-09) — PASS, and stronger than the step asked for.** Run on **model 5** ("test") —
the model carrying jravani's converged run. Its pypsa row was cleared first (its leg was `completed`
since Nov 5, so the action was hidden), then the power flow was dispatched: `completed`, leg
`extracted_path = storage/data/model_5_1794221808`.

`summary.json` for the new run is **byte-identical** to the Nov-5 bundle's:

```
snapshots 8760   converged_snapshots 8760   failure null
min_v_mag_pu 0.9782006216986275   max_v_mag_pu 1.0
max_line_loading 0.6323139227843351   max_transformer_loading 0.5444226926399118
```

Identical convergence and identical loading maxima across the whole 8760-snapshot year — the physics is
untouched. Grid tab: convergence 8760/8760, transformer loading (3 transformers) and line ratings (16
lines) all resolve, nothing red.

**Two findings that came out of it:**

1. **F2 removed a pre-existing over-count.** `line_loading` went 236,520 → **140,160**. The old figure was
   27 lines × 8760 written from a bundle whose `lines-loading.csv` has only **16** line columns
   (1 label + `lv_0…lv_13`, `mv_14`, `mv_15`). So the old ingest invented 11 phantom line series per
   snapshot; the new one writes exactly the bundle's 16. (`voltage`/`power` were already correct at
   175,200 = 20 buses × 8760, and stayed.) The old number was the wrong one.
2. **The legacy path gap is real, and this run closed it for model 5.** Its pre-059 leg row had **no
   `extracted_path`**, so `pypsaExtractedPath` fell back to the newest `model_results` bundle (the
   *Calliope* one, which has no `power_flow/`), and its actual power_flow bundle sat unreferenced in a
   sibling dir (`model_5_1793891858`). Consequence: for a legacy run the file-derived sections
   (convergence, transformer loading, line ratings) are **absent** — exactly the pre-F3 behaviour F3's
   commit message describes. F3 cannot retroactively fix a run recorded before migration 059; a re-run
   records its own path and the sections appear. **Not a regression** (the resolution chain was the same
   before F3), but worth knowing if anyone inspects an old model's Grid tab.

*(Optional follow-up if we ever care about legacy rows: have `pypsaExtractedPath` search sibling
`model_<id>_*` dirs for a `power_flow` marker before giving up. Small, but new scope — not part of
PR #377.)*

---

## 4. Non-blocking items — how to see them

| Item | How to observe |
|---|---|
| **N1** NaN alignment | Visual: no "shifted" series — a diverged snapshot shows as 0, and the *later* snapshots keep their own values. Mostly covered by the unit test; check only if a snapshot diverged. |
| **N2** `q` basis | On the Grid tab's power chart, `p` and `q` now describe the **same per-bus net quantity** (from `buses-q.csv`) instead of `q` being a generator-only sum. If the bundle was old and had no `buses-q.csv`, `q` falls back and I'll flag it. |
| **N3** streaming Coati | Not visible in the UI. Evidence: memory/peak RSS of `energy-backend` during a large power-flow ingest (I measure it). |
| **N5** root notes | Nothing to see — `affects.md` + `update-plan-pypsa-powerflow.md` are out of the repo root (now `.local/docs/`). |
| **N6** PR split | **Decided: ship as one PR** (no split). The reviewer's note is acknowledged in the reply. |

---

## 5. Sign-off checklist (tick as we go)

- [x] V1 PV model completes the power-flow leg — **the blocking regression** (models 8 + 6)
- [x] V2 battery survives as a net injection (model 9)
- [x] V3 Grid tab shows convergence + transformer loading + line ratings (curtailment empty = by design)
- [x] V4 Coati failure → red action, model stays completed (model 11)
- [x] V5 rerun does not double the `results_pypsa_*` rows (21,600 → 25,920 by replacement, not 47,520)
- [x] V6 Calliope rerun re-offers the power-flow action (pypsa row dropped at dispatch start)
- [x] V7 pre-submit failure → red action with error recorded (locator miss → failed row with the error text)
- [x] V8 the leg never mutates the model's lifecycle (re-scoped: `published` is vestigial; covered by V4/V7/V5/V9)
- [x] V9 no regression on the gas-boiler model — identical solve (8760/8760), F2 removed a 27→16 line over-count
- [x] N6 decision taken — **ship as one PR**

**Then:** reply to jravani on the PR with the per-fix commit list + the validation result. Still
outstanding — tracked in `tasks/index.md` under "What stays open after a task closes", together with the
push. `closed/pr377-review-fixes.md` is closed alongside this doc.
