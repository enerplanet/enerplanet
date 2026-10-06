# Heat Patch — retrofitting the heat vector onto the MEME dispatch path

**Status:** PLAN — electricity-first is live (T1K on the CalculationPayload
shape); heat is intentionally deferred and retrofitted after electricity
works end-to-end.

**Why electricity-first:** the T1K `enerplanet-to-meme` mapping is
electricity-only today — it emits `model.carriers.electricity`, electric
`demand` techs, pv/battery/wind/grid-tariff — and **silently drops heat**
(its only heat line is `properties.demand_heat → 0`, a reverse-round-trip
keeper, not a heat system). Retrofitting heat is a real schema change
(per the repo's back-to-front rule), so we first prove the whole
dispatch→MEME→result path on electricity, then layer heat on.

---

## Current state (electricity live)

- **Translator:** `enerplanet/backend/internal/meme/t1k.go` →
  `TranslatePayload(input []byte) (TranslatedJob, error)`. Runs T1K's embedded
  `enerplanet-to-meme` mapping from `internal/meme/mapping.json` with the
  `allow_unmet_demand` rule **removed** (PyPSA rejects it; without the drop the
  job 422s on the pypsa leg of MEME's hard-fixed `pypsa,calliope` target).
- **Produced job:** electricity carrier, mode `plan`, demand+building techs,
  transformer `grid-<node>` imports. Validates clean against **both** pypsa and
  calliope (verified live against `localhost:8401/validate`, HTTP 200).
- **Heat is NOT emitted.** `demand_heat` in the payload is read in and dropped.

## Why the old hand-written translator already handles heat

`internal/meme/translate.go` `Translate()` operates on a **different shape** —
node-level BUEM `NodeSeries` (aggregated, kW→MW), not the CalculationPayload.
It emits both `electricity` + `heat` carriers, one demand tech per node per
carrier, and a **heat pump per node** (`heat_pump_<node>`, electricity→heat,
COP 3.0, sized to peak heat, non-expandable, `mode: operate`). This is the
heat-aware reference implementation, and energyVectors gating lives in the
Caller. It stays for now; the electricity path does not use it.

## The gap that has to close (order matters)

1. **Mapping carries heat.** Extend the T1K mapping (`mapping.json` +
   upstream `T1K/config/enerplanet-to-meme.json`) to emit:
   - a `model.carriers.heat` carrier
   - a heat `demand` tech per node with heat demand inline (pics
     `properties.demand_heat` / per-building heat series)
   - a heat pump per node (electricity → heat, COP, fixed capacity, operate)
   - decide mode: the pump only makes sense in `operate` (fixed capacities),
     so a heat model flips experiment.mode plan→operate — this is a **job-shape
     change**, not just adding a tech.
2. **Frontend schema change (back-to-front).** The config that feeds the
   payload is built in the frontend. Adding heat demand requires the frontend
   to emit the heat series / `energyVectors: ["electricity","heat"]` +
   per-building heat data — a schema change doc first, then frontend impl.
3. **Migration tool** for stored legacy configs so history models keep working.
4. **Step 8 PyPSA** is wholesome already (no heat), so PyPSA can ship before
   the heat patch lands.

## Where heat lives that electricity doesn't

| Concern | Electricity (live) | Heat (deferred) |
|---|---|---|
| carrier | `electricity` | `heat` (add to carriers map) |
| demand | `demand_<node>` inline | `demand_<node>` heat variant, series source = BUEM heat/hot-water aggregate |
| supply | grid import + pv/wind | heat pump (electricity→heat, COP) |
| mode | `plan` | `operate` (fixed pump capacity) |
| sizing | n/a | pump sized to peak heat / COP so operate stays feasible |
| payload source | CalculationPayload topology | same topology + heat series (BUEM) on nodes |

The BUEM node-series path (`Translate()`) already has the heat-carrying
implementation — reuse its aggregation/sizing logic when wiring heat into the
T1K seam, rather than re-deriving — but keep the dispatch on ONE path
electricity-first, do not dual-route.

## Acceptance for the heat patch

- A CalculationPayload with `energyVectors: ["electricity","heat"]` and heat
  series translates to a job that **passes `POST /validate?target=calliope`**
  (heat pump is calliope-only; `allow_unmet_demand` stays dropped for pypsa)
  and **simulates successfully**.
- Heat demand appears in results (Coati doc `dispatch.heat`,
  `capacities.heat_pump_<node>`) and surfaces in R2 tables.
- Stored legacy configs re-run through the migration tool without 422.
- Frontend emits the heat schema; nothing hand-authored breaks history models.