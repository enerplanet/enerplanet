# Heat Patch — retrofitting the heat vector onto the MEME dispatch path

**Status:** PLAN (revised 2026-10-20) — **the mapping half is no longer the gap.**
The pinned T1K mapping already carries heat, cooling and gas, the demand-series
attachment already sends `properties.demand_series.heat`, and run mode
(`plan`/`operate`) is a real, user-selectable model property. What is left is
EnerPlanET-side: the frontend never emits `energyVectors`, nothing forces a heat
model into `operate`, and the mapping marks every technology expandable — which
`operate` cannot use. See **Remaining gaps** for the current, ordered list.

**Why this doc was originally written** (kept for history): the mapping at the
time was electricity-only — it emitted `model.carriers.electricity`, electric
`demand` techs, pv/battery/wind/grid-tariff, and dropped heat (its only heat line
was `properties.demand_heat → 0`, a reverse-round-trip keeper). The plan was to
prove the dispatch→MEME→result path on electricity first, then layer heat on.
That decision holds; the mapping work has since landed upstream.

---

## Changelogs

### 2026-10-20 — carrier-aware results UI (issue #16)

- **Results UI is carrier-aware end to end** (`enerplanet/frontend/src/features/model-results`):
  a single table (`carrierUnits.ts`) owns each carrier's label, unit family
  (`kWh/kW` for electricity *and* heat, `m³/m³/h` reserved for gas/oil) and a
  `generation` flag. Charts, stat tiles, axis labels and tooltips read it instead
  of hardcoding "kWh"/"Power".
- **Fixed charts that dropped heat data**: `DailyLoadProfile` and
  `LoadDurationCurve` filtered `record.carrier !== 'power'`, so a heat carrier
  rendered empty. Both now filter through `sameCarrier(carrier)`.
- **Fixed an EnergyPanel stale-data bug**: the embedded-series shortcut reused
  the previous carrier's series on a carrier switch, relabelling electricity as
  heat. It now only reuses series that actually hold records for the active carrier.
- **Generation-only charts are gated** on `carrierUnits.isGenerationCarrier`:
  renewable mix, generation duration curve, renewable/grid-import/self-sufficiency
  tiles. Heat gets a demand duration curve instead of a generation one.
- **Deleted the `PREVIEW_HEAT` stub** (`useModelResultsData.ts` built heat as
  "3× electricity with a 15 % solar-thermal share"). It rendered invented numbers
  as real. Until a heat-carrying result exists the toggle simply does not appear —
  the honest state, per the "never fabricate a carrier" rule.
- **Comparison screen** (`features/simulation-charts/SimulationCharts.tsx`) got
  the same treatment: one carrier toggle drives both sides, refetches per carrier,
  and only offers carriers **both** models carry. Supply-vs-demand and the
  self-sufficiency/CO₂ cards are hidden for a non-generating carrier.
- **Backend:** `Store.GetDistinctCarriers` (`internal/store/result/store.go:674`)
  now unions `results_carrier_prod` **and** `results_carrier_con`. It only looked at
  production rows, so a carrier whose demand is met without an in-model producer
  (heat demand with no heat pump) was never advertised in `carrier_summaries` —
  and the UI derives the toggle from exactly that list.
- **Note for this patch:** the last two items are the parts that matter here. When
  heat finally lands in results, the UI can already display it; what it cannot yet
  do is *cause* it (see gaps 1–3).

### 2026-10-20 — plan re-baselined against the current code

- Verified against `github.com/enerplanet/T1K v0.1.1-0.20261018052736-95ecd293e210`
  (`enerplanet/backend/go.mod:7`): the `enerplanet-to-meme` mapping now defines
  `heat_carrier`, `cooling_carrier`, `gas_carrier`; maps
  `properties.demand_series.heat → /model.timeseries{demand_heat_$k}` (inline, MW);
  maps `air_source_heat_pump`, `ground_source_heat_pump`, `electric_boilers` via
  `electric_heating_tech` (electricity→heat) and `gas_boiler` (natural_gas→heat)
  plus a `gas_supply` trade; and carries `mode` through a `plan`/`operate` lookup
  (default `plan`, `strict`).
- Therefore **"mapping carries heat" is done**; the old step 1 is retitled and
  reduced to the expandable/operate defect (gap 2).
- `enplanet/backend/internal/jobs/demand_series.go` already attaches
  `properties.demand_series` per building (`heat` = heating + hot water, kW per
  model step, windowed to the run) and only where the building owns a heat
  technology — so no heat demand is emitted that nothing could supply.
- `internal/payload/payload.go` reads `energyVectors` from
  `config.energyVectors` (default `["electricity"]`) and `mode` from `config.mode`.
- `Mode` is now a first-class model setting (`RunMode = "plan" | "operate"` in
  `configurator/store/modelStore.ts`, commit `c530227`), threaded
  config → payload → `experiment.mode`.
- `internal/meme/t1k_test.go:57` asserts the translated job has no `heat` carrier —
  that fixture carries no `demand_series`, so the assertion documents
  "no series, no heat carrier", **not** "heat is unsupported". Keep it, and add a
  heat-bearing fixture when gap 1 lands.

---

## Current state (electricity live, heat mapped)

- **Translator:** `enerplanet/backend/internal/meme/t1k.go` →
  `TranslatePayload(input []byte) (TranslatedJob, error)`. Runs T1K's embedded
  `enerplanet-to-meme` mapping with the `allow_unmet_demand` rule **removed**
  (PyPSA rejects it). There is no `internal/meme/mapping.json` any more — the
  mapping ships inside the T1K module.
- **Payload:** `internal/payload` builds `CalculationPayload`; `topology` buildings
  carry `demand_series` (added by `internal/jobs/demand_series.go` at dispatch
  time), heat/cooling/gas technologies and their parameters.
- **Run mode:** `config.mode` → `payload.mode` → `experiment.mode`. Default `plan`.
- **Results:** carrier-aware UI is in place (2026-10-20 entry above); result rows
  are written per carrier by `internal/result/service/meme_timeseries.go`.

## Why the old hand-written translator already handles heat

`internal/meme/translate.go` `Translate()` operates on a **different shape** —
node-level BUEM `NodeSeries` (aggregated, kW→MW), not the CalculationPayload.
It emits both `electricity` + `heat` carriers, one demand tech per node per
carrier, and a **heat pump per node** (`heat_pump_<node>`, electricity→heat,
COP 3.0, sized to peak heat, non-expandable, `mode: operate`). This is the
heat-aware reference implementation, and energyVectors gating lives in the
Caller. It stays for now; the electricity path does not use it.

## Remaining gaps (order matters)

1. **Frontend emits the heat schema (back-to-front).** There is **no**
   `energyVectors` string anywhere under `enerplanet/frontend/src` — the payload
   always falls back to `["electricity"]`. The heat patch needs the configurator
   to emit `energyVectors: ["electricity","heat"]` and the selected heat
   technologies (heat pump / electric boiler / gas boiler, with their COP in
   `cont_energy_eff` and a capacity bound in `cont_energy_cap_max`) plus the heat
   demand path that feeds BuEM series. Schema doc first, then frontend, then the
   legacy-config migration.
2. **Expandable × operate conflict (the one real job-shape defect left).** The
   mapping's `tech_capacity` sets `capacity.expandable: true` for **every**
   technology, unconditionally. PyPSA's `operate` requires fixed capacities
   (`internal/meme/job.go:88-90`, and the old `translate.go` sets
   `Expandable: false` for exactly this reason), so a heat model — which must run
   in `operate` — would emit an expandable heat pump. Fix in Go, NOT by editing
   the published mapping: a post-translate pass alongside the existing
   `withoutUnmetDemand` / `applyEnergyPrices` precedent that, when
   `experiment.mode == "operate"`, rewrites `model.technologies[*].capacity` to
   `{existing: capacity.max, expandable: false}`.
3. **Nothing forces a heat model into `operate`.** Mode is user-selectable now,
   which is progress: the mechanism exists. But a heat model run in `plan` sizes
   the heat pump like any expandable tech, which is not what a retrofit means.
   Decide and enforce: either the configurator pins/locks `operate` when a heat
   vector is present, or the translator promotes heat models to `operate` and
   records that it did. Prefer the frontend lock — the run mode is visible there,
   and a silent promotion surprises the user.
4. **Migration tool** for stored legacy configs so history models keep working.
5. **Step 8 PyPSA** is wholesome already (no heat), so PyPSA can ship before the
   heat patch lands.

## Where heat lives that electricity doesn't

| Concern | Electricity (live) | Heat (remaining work) |
|---|---|---|
| carrier | `electricity` | `heat` — **mapped** (`heat_carrier`) |
| demand | `demand_<node>` inline | `demand_heat_<k>` from `demand_series.heat` — **mapped + attached**; frontend must supply the series |
| supply | grid import + pv/wind | `air_source_heat_pump` / `ground_source_heat_pump` / `electric_boilers` (electricity→heat), `gas_boiler` (gas→heat) — **mapped**; frontend must select them |
| mode | `plan` | `operate` — selectable today, **must be enforced** for heat (gap 3) |
| sizing | n/a | `capacity.expandable` must become `false` in operate (gap 2) |
| payload source | CalculationPayload topology | same topology + `demand_series.heat` (BuEM) on nodes |

The BUEM node-series path (`Translate()`) already has the heat-carrying
implementation — reuse its sizing logic (pump sized to peak heat / COP so
`operate` stays feasible) when wiring heat into the T1K seam, rather than
re-deriving — but keep the dispatch on ONE path, do not dual-route.

## Acceptance for the heat patch

- A CalculationPayload with `energyVectors: ["electricity","heat"]` and
  `demand_series.heat` translates to a job that **passes
  `POST /validate?target=calliope`** (heat pump is calliope-only;
  `allow_unmet_demand` stays dropped for pypsa) and **simulates successfully**.
- Every technology in that job has `capacity.expandable: false` with
  `existing` set (mode `operate`).
- Heat demand appears in results (Coati doc `dispatch.heat`,
  `capacities.<heat_pump>_<node>`) and surfaces in the R2 tables as carrier
  `heat` — the carrier-aware results UI then renders it with kWh labels, the
  demand duration curve and no generation charts, and the carrier toggle appears
  because `GetDistinctCarriers` now reads production *and* consumption rows.
- Stored legacy configs re-run through the migration tool without 422.
- Frontend emits the heat schema; nothing hand-authored breaks history models.
