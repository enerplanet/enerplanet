# PR #377 — validation instructions

**What this validates:** the resolution of the PR #377 review (6 blocking + 6 other findings).
Per-fix commit log: `tasks/open/pr377-review-fixes.md`. Every commit is gated by
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

---

### V2 — F2: a battery survives the flow-CSV pass

🖱 **YOU:** on the **battery model**, hit **Run power flow**.

**Expected:** same as V1 — completes, action hides.

🔧 **ME:** I check that the battery appears in the dispatched job as a **net** fixed injection
(`flow_out − flow_in`) and **not** as a load, and that no line techs leaked in as generators. If the
model has no battery I'll validate this from the unit test + a real flow CSV.

**Anyone can spot the failure here:** MEME answers `needs a fixed dispatch` (the tech vanished) or
the model's dispatch is flat 1.0 p.u. with zero flow.

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

---

### V5 — F5b: no row doubling on a clean rerun

🖱 **YOU:** on the same throwaway model (with Coati restored), hit **Run power flow** a second time.

🔧 **ME:** I count rows in `results_pypsa_voltage` / `results_pypsa_power` /
`results_pypsa_line_loading` before and after — the count must be **identical**, not doubled.

---

### V6 — F6: a Calliope rerun re-offers the power-flow action

🖱 **YOU:** on a model whose power flow already completed, re-run the **Calliope** leg (Run model).

**Expected after Calliope finishes:** the **Run power flow** action is **visible again** (the stale
record is gone), and the Grid tab no longer shows the old power flow as if it were current.

🔧 **ME:** confirm the `pypsa` row in `model_meme_runs` is deleted at Calliope dispatch start.

---

### V7 — F4: a pre-submit failure shows as red, not grey

🖱 **YOU:** run the power flow on a model where the leg cannot even start. The easy trigger: a model
that has a completed Calliope leg but whose stored Calliope bundle has been moved/removed — **I'll
set that up** and tell you when to click.

**Expected:** the action is **red** with the retry tooltip (jravani saw a **grey**, silent action).

🔧 **ME:** confirm a `pypsa` leg row exists with `status=failed` and the error text in the `error`
column (before the fix: no row at all, nothing logged).

---

### V8 — N4: a published model stays published

🖱 **YOU:** take a model with a **published** status (or publish one), then run the power flow on it.

**Expected:** the model's status chip stays **published** — it must not flip to `completed`, and it
must not sit pulsing in `running`.

> ⚠️ **This is the one design decision in the batch.** The PyPSA leg no longer mutates the model's
> lifecycle status at all — its state lives only in the leg row / the action button. So while a
> power flow is running you will **not** see the model chip pulse. If you'd rather keep the pulse,
> say so and I'll rework it to remember-and-restore the prior status instead.

---

### V9 — no regression on the model jravani converged

🖱 **YOU:** on the **14-building gas-boiler model**, run the power flow once end to end.

**Expected:** converges on all snapshots, Grid tab fully populated, nothing red.

---

## 4. Non-blocking items — how to see them

| Item | How to observe |
|---|---|
| **N1** NaN alignment | Visual: no "shifted" series — a diverged snapshot shows as 0, and the *later* snapshots keep their own values. Mostly covered by the unit test; check only if a snapshot diverged. |
| **N2** `q` basis | On the Grid tab's power chart, `p` and `q` now describe the **same per-bus net quantity** (from `buses-q.csv`) instead of `q` being a generator-only sum. If the bundle was old and had no `buses-q.csv`, `q` falls back and I'll flag it. |
| **N3** streaming Coati | Not visible in the UI. Evidence: memory/peak RSS of `energy-backend` during a large power-flow ingest (I measure it). |
| **N5** root notes | Nothing to see — `affects.md` + `update-plan-pypsa-powerflow.md` are out of the repo root (now `.local/docs/`). |
| **N6** PR split | **Open decision, yours:** split dashboard list-payload/polling + Makefile changes into their own PRs, or ship as one? |

---

## 5. Sign-off checklist (tick as we go)

- [ ] V1 PV model completes the power-flow leg — **the blocking regression**
- [ ] V2 battery survives as a net injection
- [ ] V3 Grid tab shows convergence + transformer loading + line ratings
- [ ] V4 Coati failure → red action, model stays completed
- [ ] V5 rerun does not double the `results_pypsa_*` rows
- [ ] V6 Calliope rerun re-offers the power-flow action
- [ ] V7 pre-submit failure → red action with error recorded
- [ ] V8 a published model stays published (design change — confirm or send back)
- [ ] V9 no regression on the gas-boiler model
- [ ] N6 decision taken (split the PR or not)

**Then:** reply to jravani on the PR with the per-fix commit list + the validation result, and I
close `tasks/open/pr377-review-fixes.md`.
