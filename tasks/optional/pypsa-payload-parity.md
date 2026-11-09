# PyPSA leg — payload parity with the Calliope leg

**Status:** optional / deferred (register) · **Owner:** EnerPlanET backend · **Raised:** 2026-11-09, during
PR #377 live validation · **Not blocking:** PR #377 ships without it.

> **One line:** `HandleDispatchMemePyPSA` rebuilds a *bare* calculation payload
> (`payload.BuildCalculationPayload`) while `HandleDispatchMeme` applies a full enrichment pass before it
> translates. The two jobs are therefore built from different models, and the power-flow leg only works
> because it has been taught to tolerate the differences.

---

## 1. What actually differs

`HandleDispatchMeme` (`internal/jobs/dispatch_meme.go`, ≈L167–217) enriches the payload before translating:

| Step | What it does | Needs |
|---|---|---|
| `resolver.Resolve(ctx, model.ID)` → `dropFurtherWayDemand`, `dropUnheatedHeat`, `checkDemandCoverage`, `checkHeatCoverage`, `setModelWarning` | resolves BuEM series coverage; **prunes heat techs of unheated buildings**; **writes `models.results.warning`** | **BuEM** (network), DB write |
| `attachModelDemandSeries(seriesReader, …)` | attaches per-building demand series | series store (DB) |
| `pvResolver.Attach(ctx, &model, calc)` | places PV arrays; `setPVArrays` **replaces `pv_supply` with one tech per array** (`pv_supply_2_0…4`) | **pysam-PV / PVGIS** (network) |
| `priceStore.Default` + `mergeGridPrices` + `applyGridPrices` | resolves and applies grid prices | DB |
| `sizeHeatTechs` / `checkOperateSizes` (operate mode) | sizes heat techs and validates them | — |

`HandleDispatchMemePyPSA` (`internal/jobs/dispatch_meme_pypsa.go`) does **none** of this:

```go
built, err := payload.BuildCalculationPayload(&model)   // bare
calcBytes, err := json.Marshal(built)
translated, err := meme.TranslatePayload(calcBytes)
```

### Evidence from live validation (models 8 and 9)

- **`pv_supply_2` — the smoking gun.** Model 8's Calliope bundle names the PV techs `pv_supply_2_0` …
  `pv_supply_2_4` (the arrays), and plain `pv_supply_2` appears **nowhere** in `results_flow_out.csv`.
  The bare payload never ran `pvResolver.Attach`, so the T1K job carried the *unnamed-base* `pv_supply_2`
  instead. MEME answered:
  `mode "power_flow" needs a fixed dispatch for tech "pv_supply_2" (only the slack balances)`.
- **`costs.monetary.purchase`** on `battery_storage_2` — `tech "battery_storage_2": costs.monetary.purchase is
  not supported by target "pypsa"`.

Both are now handled in the *mapper* (§3), so the leg runs. Neither is fixed at the source.

---

## 2. Why the current arrangement still produces a correct power flow

Worth stating plainly, because it lowers the urgency:

The isolated pass takes **every electrical injection from the Calliope flow CSVs** and overlays them onto the
translated job: buses/lines/transformers come from the topology, and each generator/load series comes from the
Calliope results. Anything the job carries that the results do not is dropped
(`dropNonElectricalSupply`, `dropUndispatchedSupply`); anything the results carry that the job lacks is created
(`ensureTech`).

So the residual drift is confined to **non-electrical** parts of the job — demand profiles, heat techs, grid
prices — and those are exactly the parts the pass overwrites (demand from the flow CSVs) or drops (non-electrical
supply). The electrical network that gets solved is derived from the Calliope results either way.

The risk is therefore not "wrong numbers today"; it is **recurrence**: every future enrichment step added to
`HandleDispatchMeme` silently widens the gap, and each new symptom surfaces as a 422 on a user's model.

---

## 3. What the mapper already tolerates (the status quo)

| Guard | Commit | Covers |
|---|---|---|
| `stripPerformanceFromAll` | `94c7691` | physics models on any tech (MEME validates **every** technology) |
| `dropUndispatchedSupply` | `d19f587` | a non-demand tech the flow CSVs don't carry (the `pv_supply_2` case) |
| `stripPurchaseCosts` | `d19f587` | `costs.<class>.purchase` (no PyPSA slot) |
| `dropNonElectricalSupply` | PR #377 | heat/gas supply techs the electrical pass can't dispatch |

This is a **whack-a-mole posture**: correct, and each guard is tested, but it only closes classes of drift that
have already been observed in the wild.

---

## 4. The options

### Option A — share the enrichment (extract it from `HandleDispatchMeme`)

**Mechanics (measured):**

| Touch point | Count |
|---|---|
| New shared helper (≈55 lines moved out of `dispatch_meme.go:167–217`) | 1 function |
| `HandleDispatchMemePyPSA` signature | +4 params |
| Registration — `internal/worker/asynq_worker.go:130` | 1 line (all four deps already built for the Calliope line at `:126`) |
| Tests to update | 6 call sites, all in `dispatch_meme_pypsa_test.go` |
| New fakes | **none** — the four interfaces already have fakes in `package jobs` |

Interfaces involved: `modelDemandResolver`, `demandSeriesReader`, `modelPVResolver`, `gridPriceStore`.

**Upsides**
- One payload builder, one source of truth: the drift class disappears permanently.
- The two jobs become byte-comparable, which makes "why did the power flow disagree with Calliope?" answerable.

**Downsides**
- **The derived leg gains runtime dependencies it was designed to avoid.** Today the pypsa leg needs only the
  stored Calliope bundle. After A it also needs BuEM, pysam-PV and the price store to be reachable — so a
  power flow could fail on a model whose Calliope results are already complete and correct. That contradicts the
  "PyPSA is a passthrough of the Calliope results" property the leg is gated on.
- **It writes to the model.** `setModelWarning` updates `models.results.warning`, and the coverage checks can
  fail the dispatch. The pypsa leg would start mutating and rejecting models on criteria the Calliope leg already
  validated — a second, redundant verdict on the same model.
- It re-does work (BuEM/PV resolution) that was already done minutes earlier for the same solve.
- It is a **behavioural** change on a leg whose whole contract is "derive, don't recompute" — it deserves its own
  PR and its own review, not a ride-along on a review-fix branch.

### Option B — persist what Calliope built

Store the enriched payload (or the translated job) at Calliope dispatch; the pypsa leg loads it instead of
rebuilding.

**Mechanics:** migration + column (or reuse the run row's storage dir), one write in `dispatch_meme.go`, one read
in `dispatch_meme_pypsa.go`, delete the bare `BuildCalculationPayload` call. ~5 files, same as A.

**Upsides**
- No new runtime dependencies — the leg stays a passthrough of already-stored state.
- No model writes, no duplicate coverage verdicts.
- Solves the drift class the same way A does, and is arguably the *more* honest reading of "derived leg".

**Downsides**
- **Storage.** The size check logs e.g. `MEME job: 50 combinations, 2160 timesteps, estimated 1443 MB`, so the
  translated job is not small; a per-run blob is a real cost. (The *pre-translation* payload is smaller but still
  a once-a-solve artefact.)
- An extra column/artefact to migrate, retain and clean up — and a stored payload can go stale relative to
  `models.config` in ways that are harder to reason about than a recompute.
- Ties the leg to the exact bytes of a past run, so a payload-schema fix cannot be applied retroactively to an
  existing solve.

### Option C — keep tolerating (status quo)

**Upsides**
- Zero new dependencies, zero storage, no model writes.
- Already covered by four tested guards, and the electrical result is correct (§2).

**Downsides**
- Reactive: each new enrichment step is discovered as a 422 on a live model.
- The mapper accumulates knowledge of the other leg's payload quirks, which is a coupling in its own right.

---

## 5. What the change would affect

| Area | Option A | Option B |
|---|---|---|
| `internal/jobs/dispatch_meme_pypsa.go` | new deps + enrichment call | load stored payload instead of building |
| `internal/jobs/dispatch_meme.go` | block extracted into a helper | persists the payload |
| `internal/worker/asynq_worker.go` | +4 args on one line | unchanged (or +1 store) |
| Schema | none | new column (+ migration, idempotent per house style) |
| Runtime dependencies of the leg | **+BuEM, +pysam-PV, +price store** | none |
| Model writes during the leg | **yes** (`models.results.warning`, coverage verdicts) | none |
| Tests | 6 call sites | ~2 call sites + a store test |
| Failure modes added | leg fails when BuEM/PV/prices are down | leg fails on a missing/stale stored payload |
| Observability | none specific | need a "payload recorded / missing" log line |

---

## 6. Recommendation and trigger

**Recommendation: Option C now, Option B when the follow-up is picked up.** B preserves the leg's
derived-passthrough contract and removes the drift class permanently; A buys payload identity at the cost of
runtime dependencies and duplicate model writes on a leg that is explicitly *not* supposed to recompute.

**Revisit when either is true:**

1. A model shows drift that is **electrical** — i.e. the pass's dropped/created techs change the solved network
   rather than just the job's non-electrical parts. That is the signal that tolerating is no longer enough.
2. A new enrichment step is added to `HandleDispatchMeme` (checklist item: does the pypsa leg need it?).

**Not a trigger:** a new 422 of the `pv_supply_2` / `purchase` kind — those are cheap mapper guards, and the
pattern for adding one is established (§3).

---

## See also

- `tasks/open/pr377-review-fixes.md` — the review resolution and the per-commit log, including the three fixes
  this document exists because of.
- `tasks/open/pypsa-isolated-run-plan.md` — the leg's design and the ADR-0008 decision it follows.
- `dependencies/meme` `internal/target/pypsa/powerflow.go` (`validatePowerFlow`) and `pypsa.go`
  (`purchaseCost`) — the validator whose messages drove §1.
