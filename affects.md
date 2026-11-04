# EnerPlanET frontend — affected components (power-flow data + result-semantic changes)

**Status:** impact register, not a change plan · **Repo:** `enerplanet/frontend` · **Drivers:**
the backend send/parse migration in `update-plan-pypsa-powerflow.md` (repo root) and MEME `main`
(`a472b68`) now emitting real power-flow electrical data.

> **Headline:** the frontend is **already wired for power-flow electrical data** — capability-gated
> (`source: legacy | meme | full-grid-pf`). Sections appear once the backend declares the right
> capabilities and populates `results_pypsa_*`. Most changes below are **verification / field-name
> stability**, not rework.

---

## 1. The pipeline already targets the new data

`fetchPyPSAResults` (`features/model-results/api.ts:274`) → `PyPSAModelResults` (`api.ts:218`, types
already include `voltage` (v_mag_pu), `power` (p/q), `line_loading` (loading_percent), `transformer_loading`
(s_nom_kva), `curtailment`, `line_ratings`, `convergence`, `settings`, `source`, `capabilities`,
`locations`) → `GridPanel` / `NetworkTopology` / PyPSA charts.

`capabilitiesFrom` (`config/resultCapabilities.ts:38-44`) returns `LEAST_CAPABLE` when the block is
absent, so a stale backend **hides** sections rather than showing empty ones — the intended behaviour.

**Net effect:** once the backend emits the canonical payload, ingests the `power_flow/` layout (filling
`v_ang`, `q`, `loading%` that were previously empty) and declares `full-grid-pf`, the Grid sections turn
on with **no frontend change**. This is the single biggest "adjustment" and it is zero-code.

> **Reactive-power caveat (2026-11-04).** Under the first-migration `p_set`-only payload, ADR-0008 keeps
> loads at unity power factor and generators `PQ` with zero reactive set-point, so MEME emits `q` ≈ 0.
> The `q` column/`v_ang` get **populated** (not empty/absent) but the reactive values stay ~zero until the
> backend also sends the ADR-0009 reactive fields. Treat any "reactive power finally non-zero" expectation
> below as **contingent on that**, not guaranteed by this migration.

---

## 2. Components and what each needs

### Direct PF consumers — check, expect no structural change
| Component | File | Consumes | Watch for |
|---|---|---|---|
| `ModelResultsViewer` | `features/model-results/ModelResultsViewer.tsx` | `pypsaData.voltage/power/line_loading`, `converged` badge, `energy_cap` lineConnections | Defaults `avgVoltage=1.0`/`avgPower=0` (149-198) — if capability declared true but data empty it reads "normal". Confirm populated before declaring `voltage`/`power`. |
| `GridPanel` | `features/model-results/components/panels/GridPanel.tsx` | locations, voltage/power per bus, line_loading, line_ratings, transformer_loading, curtailment, convergence, settings.converged | `'0.0 kVA'`/`'0.0 kW'` placeholders (194-205) and `'-'` voltage cards. `q` gets populated but ≈0 under the first payload (see §1 caveat) — don't expect the reactive row to move yet. |
| `NetworkTopology` | `features/simulation-charts/pypsa/NetworkTopology.tsx` | location→avg `v_mag_pu`/`p`, lineConnections, connectionLoading (peak loading%) | `v_mag_pu` real values replacing the `1.000 pu` default (156-370); over-voltage/under-voltage coloring flips on. |
| PyPSA charts | `features/simulation-charts/pypsa/*.tsx` | `v_mag_pu`, `p`+`q`, peak loading%, `s_nom_kva` | `utilizationOnly` relabels — when real loading% arrives, `utilizationOnly=false`. `PyPSAPowerChart` (reactivePower=q) becomes meaningful **only once ADR-0009 reactive fields ship**. |

### Backend-triggered adjustments (the real work)
1. **Field-name stability — highest risk.** Consumers cast to the `PyPSAModelResults` type (`as PyPSAModelResults`),
   no runtime validation. The backend's JSON keys must match the frontend types exactly. If MEME/ingest
   ever differs from the frontend key (`s_nom vs s_nom_kva`, `q0/q1`, `v_ang`, `loading_percent`,
   `converged_snapshots`), `GridPanel` breaks at runtime with no compile error. Pin the contract in one
   place (backend shape + `PyPSAModelResults`), don't let either drift.
2. **Capability declaration correctness.** Sections flip on `full-grid-pf -> voltage/power/lineLoading/
   transformers/convergence`. Only declare what the ingest actually fills — otherwise empty/default states
   render as green "healthy". The backend already derives from `source`; just don't claim electrical data
   it doesn't persist.
3. **Location-id vocabulary.** Legacy c2p uses `ID_1`/`Trafo_x`; current uses `n1`/`ntrafo_82`. Ingest
   currently normalizes (e.g. `normalizeLocId`, `GridPanel` substring `trafo`/`transformer`/`grid`,
   GridPanel.tsx:275-278). Keep the normalization aligned so bus/transformer joins hold when real
   electrical rows arrive.
4. **Structured-results consumers stay on the legacy model.** Everything below reads
   `/results/structured` (`energy_cap`, `capacity_factor`, `cost`, `carrier_prod/con`, `line_flows`,
   `trafo_flows`), **not** the `/results/pypsa` electrical endpoint. They are unaffected by the PF
   payload/parse change **only as long as the structured endpoint keeps emitting the legacy shape** for
   these. If a migration ever stops producing `energy_cap`/`capacity_factor`/`cost`, these break without
   any relation to power flow.

### Structured results consumers (no change unless structured shape changes)
- `OverviewPanel` / Sankey / Capacity / Cost — `features/model-results/components/panels/OverviewPanel.tsx`,
  transforms in `features/configurator/utils/transformUtils.ts:190`.
- `SystemPanel` — `features/model-results/components/panels/SystemPanel.tsx` (system_balance,
  unmet_demand, resource_con, `line_flows`/`trafo_flows` p0/p1). Uses the **legacy**
  `LineFlowRecord`/`TransformerFlowRecord` {line/transformer, timestep, p0, p1} (`types.ts:180-197`), a
  different shape from PyPSA `line_loading`.
- `EnergyPanel`, `CostPanel`, `BuildingDetailPanel` — carrier/time-series + cost only.
- `SimulationCharts` + comparison — `features/simulation-charts/SimulationCharts.tsx`.

---

## 3. New possibilities — where new data creates new value (not yet wired)

- **Comparison page** (`SimulationCharts`) fetches **only** `/results/structured` per model — it never
  calls `/results/pypsa`. Once real voltage/loading exists it still **cannot** render it. Adding a
  power-flow comparison (voltage/loading) is a new fetch + panel, still not wired.
- **Reactive power / `q`** and **voltage angle `v_ang`** now arrive, which the types already model
  (`power.q`, `voltage.v_ang`). Their charts exist (`PyPSAPowerChart`) — they just start to hold data.
- **Direct `loading%`** (lines/transformers `-loading.csv`, >100 % = undersized cable) — the Grid's
  "most loaded" / "bottleneck" cards become genuinely meaningful instead of utilisation-only.
- **Per-snapshot convergence** (`convergence.csv`) — if persisted, enables a convergence-per-timestep
  view; today only the aggregate badge exists.

---

## 4. Decisions the frontend needs (parked for the backend plan)

- Confirm the exact JSON key set after the parse migration and pin it against `PyPSAModelResults` —
  one source of truth, no `as` casts to an unverified shape.
- Decide `utilizationOnly=false` when real loading lands, so the % axis on `PyPSALineLoadingChart` is
  labelled "loading" not "utilisation".
- Decide whether to add the `/results/pypsa` fetch to the comparison page (new opportunity, optional).

*Files cited are as of `enerplanet` branch `dev`; verify current line numbers before editing.*