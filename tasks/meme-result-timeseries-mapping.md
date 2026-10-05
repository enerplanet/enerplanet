# MEME result time-series → R2 tables (the Coati/R2 mapping decision)

**Status:** DECIDED — implementation step. The results page reads the R2
time-series tables (`results_carrier_prod`/`_con`, `_capacity_factor`,
`_model_*`, `_cost_var`, …) which the MEME ingest currently leaves empty, so a
MEME model renders as zeros (plus a fabricated heat carrier). This doc fixes
the source and the exact row mapping.

## Decision — where the per-location series come from

The **Coati results document aggregates**: `dispatch` is one series per tech with
locations+carriers summed, `generation` is a per-`loc::tech::carrier` **scalar
total**, `demand_by_location`/`imports_by_location` are scalars. It carries no
per-location × per-tech × per-timestep matrix, so it cannot fill the R2 tables.

The MEME bundle DOES carry that matrix: the **Calliope leg's long-format CSVs** at
`files/<calliope>/run_i/output/csv/*`, already in the R2 shape. Use them for the
time-series tables; keep **Coati** as the source for the summary, capacities,
costs and wires (as today). Parsing these CSVs in Go is fine — they are CSV, not
netCDF (the "Go never reads netCDF" rule is about the binary formats).

A PyPSA-only bundle has no such CSVs → skip with a warning (documented gap).

## Mapping (Calliope CSV → R2 table)

| CSV (`files/calliope/run_i/output/csv/`) | R2 table | columns |
|---|---|---|
| `results_flow_out.csv` (`nodes,techs,carriers,timesteps,flow_out`) | `results_carrier_prod` | from_location=nodes, carrier=norm(carriers), techs=norm_tech, timestep, value=flow_out |
| `results_flow_in.csv` (`…,flow_in`) | `results_carrier_con` | same shape, value=flow_in |
| `results_capacity_factor.csv` (`nodes,techs,carriers,timesteps,capacity_factor`) | `results_capacity_factor` | from_location, carrier, techs, timestep, value |
| `results_systemwide_capacity_factor.csv` (`techs,carriers,systemwide_capacity_factor`) | `results_model_capacity_factor` | carrier, techs, value |
| `results_systemwide_levelised_cost.csv` (`techs,costs,carriers,…`) | `results_model_levelised_cost` | carrier, costs, techs, value |
| `results_total_levelised_cost.csv` (`costs,carriers,total_levelised_cost`) | `results_model_total_levelised_cost` | carrier, costs, value |
| `results_cost_operation_variable.csv` (`nodes,techs,costs,timesteps,…`) | `results_cost_var` | location, costs, techs, timestep, value |

Not mapped (no faithful per-location source): `results_system_balance`,
`results_resource_con`, `results_unmet_demand` (`results_unmet_sum.csv` is a
single scalar). Leave empty rather than fabricate.

## Normalisation (why consumers keep working unchanged)

The store + frontend derive the summary from these tables with name heuristics
(`GetCarrierSummary`, `GetCarrierConPeakDemand`, `isRenewableTech`,
`isDemandTech`). The MEME emitter's names differ from the legacy vocabulary, so
the ingest rewrites them ON WRITE — **no consumer change**:

- **carrier**: `electricity` → `power` (the store/frontend default is `power`).
- **transmission techs** (`tech_metadata[tech].parent == "transmission"`):
  `→ power_transmission:<tech>` (the store skips these in `sumProduction`).
- **grid import** (`grid_<node>_import`, parent supply): `→ transformer_supply`
  (matches the store's `gridImport` rule; `from_location` keeps the node).
- **demand techs** (parent `demand`, e.g. `demand_1`): `→ <node>_demand`
  (e.g. `n1_demand`) — satisfies the `_demand` suffix used in BOTH the Go store
  check and the `GetCarrierConPeakDemand` SQL `LIKE '%\_demand'`.
- **grid export** (`grid_<node>_export`): **omitted** from `carrier_prod` — it is
  an offtake, not generation; the legacy vocabulary had no export tech (revisit
  if the UI needs it).
- everything else (e.g. `pv_supply_<n>`, `wind_onshore_<n>`): verbatim —
  `isRenewableTech` uses `Contains`, so the suffixes still match.

**Unit:** the Calliope CSVs are MW. The Coati energy-cap path already stores
unscaled MW for a MEME model, so store these unscaled too — self-consistent
within a MEME result (legacy stored kW; the two sources are not compared
directly).

## Where it goes

New file `enerplanet/backend/internal/result/service/meme_timeseries.go`:
`streamMemeTimeSeries(tx, modelID, csvDir, techParents)` writing the tables above.
Called from `IngestCoatiResult` inside the existing transaction (after
`deleteExistingResults`, before `storeSmallResultsTx`) so delete-then-store stays
atomic and idempotent. Locate `csvDir` from the already-located Calliope
`results.nc` (its sibling `output/csv`).

## Acceptance

- `go build ./...` exit 0; `go test ./internal/result/service/... ./internal/jobs/...` green.
- Re-ingesting a real MEME model (model 28's stored zip) gives:
  `results_carrier_prod > 0`, `results_carrier_con > 0`,
  `results_capacity_factor > 0`, `results_model_capacity_factor > 0`,
  `results_model_levelised_cost > 0`, `results_model_total_levelised_cost > 0`,
  `results_cost_var > 0`.
- `GetCarrierSummary(modelID, "power")` returns `sum_production > 0`,
  `sum_consumption > 0`, `grid_import > 0`, `peak_demand > 0`,
  `timestep_count == 73` for model 28.
- Nothing fabricated: tables with no source stay empty.

---

## Round 2 — result identity (`energy_cap` + `loc_techs`) and the wire leg

The Energy tab is correct now (it reads `carrier_prod`/`carrier_con`, which Round 1
normalises). **Overview and Grid are still wrong**, for two reasons:

### 2a. `results_energy_cap` / `results_loc_techs` use the raw MEME vocabulary

`mapCoatiDocument` writes `EnergyCap`/`LocTechs` from `doc.Capacities` verbatim, so
for model 28 they read `demand_1…9`, `grid_trafo_82_export/import`,
`lv_1..9_trafo_82`. The consumers expect the legacy vocabulary:

- `transformToCapacityData` (Overview capacity chart) excludes only
  `power_transmission`/`transformer_supply` from the capacity chart and classifies
  demand by `getTechType` (a `demand` substring). Raw `lv_*` wires are therefore
  charted as **supply capacity**, and `demand_1` isn't an `_demand` name.
- `transformToEnergyFlow` (Overview Sankey) counts non-`power_transmission`
  `energy_cap` rows as sources → wires + grid import become "sources", and its
  `isDemandTech` (`endsWith "_demand"`) finds no demands at all.
- `ModelResultsViewer.lineConnections` (Grid topology overlay) requires
  `tech === "power_transmission"` with a `to_loc` → empty.
- Legacy reference (model 13): `results_energy_cap` techs are
  `mfh_demand`, `power_transmission` (from_location=ID_x, **to_location=Trafo_y**),
  `pv_supply`, `transformer_supply`; `results_loc_techs` values are
  `<tech>` and `power_transmission:<other>`.

**Decision:** apply the SAME `normMemeTech` rules (from `meme_timeseries.go`) when
building `EnergyCap` + `LocTechs` in `mapCoatiDocument` — one shared normalisation,
no per-consumer change:

- demand (`demand_<n>`, parent `demand`) → `<loc>_demand`
- grid import (`grid_*_import`) → `transformer_supply`
- grid export (`grid_*_export`) → **omitted** from `energy_cap`/`loc_techs`
- transmission (parent `transmission`, e.g. `lv_<i>_trafo_<k>`) → **one** row:
  `tech = power_transmission`, `from_location` = one endpoint, `to_location` = the
  other (the Coati capacities carry the tech once per endpoint; pair them). In
  `loc_techs` list it at BOTH endpoints as `power_transmission:<other>`.
- other supply techs (`pv_supply_<n>`, …) → verbatim.

### 2b. Defects 1 & 2 — the wire leg

`wireDocument` prefers the **PyPSA** leg, but MEME's PyPSA `network.nc` here has
**one snapshot** with a `"now"` index → every wire row gets `timestep =
0001-01-01` (defect 1) and the "rating" is that same leg's optimized capacity, so
`|flow|/rating = 100%` trivially (defect 2). The Calliope leg carries the real data
(73 timesteps, a 73-step series per wire).

**Decision:** pick the wire leg by data quality, not by framework — prefer the
document whose `Timestamps` parse AND whose `transmission_flow` series has more
than one step; fall back to the other. This fixes the timestep and turns
`loading_percent` into a real per-timestep utilisation series (still ≤100% by
construction — the documented "utilisation, not loading" contract).

## Acceptance (Round 2)

- Re-ingesting model 28: `results_energy_cap` techs contain `power_transmission`
  (with a non-null `to_location`), `transformer_supply`, `<loc>_demand`, and
  **no** `grid_*_export` / raw `lv_*` names; `results_loc_techs` values use the
  same names.
- `results_pypsa_line_loading` rows for model 28 carry a **real** timestep
  (not 0001-01-01) and a varying, ≤100 utilisation.
- `transformToCapacityData` output has no `lv_*`/wire entries; the Sankey finds
  demand entries.
- `go build ./...` + the touched packages' `go test` green; consumers unchanged.

---

## Round 3 — real cable rating, real utilisation, red-marked connections

Round 2 gave the wires real timesteps, but `loading_percent` is still `100` on every
step: the only "rating" Coati reports is the LP-optimised `flow_cap`, i.e. the wire
sized to its own peak flow — so `|flow| / rating ≡ 1`. There is no nameplate in the
result. **Decision: compute a real rating from the model config on the ingest side.**

### Where the rating comes from

- The payload's LV arcs are a **star** (`buildTopologyFromPylovoData` connects each
  building straight to its grid's transformer and never reads the `lines` features),
  so a wire has **no** attributable per-cable type. Attribution is therefore
  **per grid, conservative**: for each `grid_result_id`, take the **smallest**
  `max_i_a` among that grid's `lines` features.
- Rating table: `dependencies/enerplanet-pylovo/raw_data/equipment_data.csv`
  (`typ=Kabel` → `max_i_a`; provenance comment in the Go source). Same precedent as
  the legacy `standardLineTypeINom`, but keyed by the **pylovo** names (`NYY_4_16`,
  `NYY_4_70`, `NAYY_4_120`, …) — the legacy table uses a different naming scheme and
  does not match.
- `s_nom = √3 · v_nom · i_max · num_parallel`, with `num_parallel = 1` (not in the
  config) and `v_nom` by pipe: `lv → 0.4 kV`, `mv → 20 kV`.
- Model 28, grid 82: weakest cable `NYY_4_16` = 103 A → **71 kVA**. Arc peaks are
  0.59–2.52 kW → **0.8–3.5 %**, so nothing flags — the value is honest, not a bug.
- MV arcs: no MV cable in `equipment_data.csv` → **no rating, omit the %**
  (documented, not fabricated).

### Behaviour

- Wire `loading_percent = |flow(t)| / rating × 100` from the **real** rating (may
  exceed 100 → that is the flag). No rating resolvable → **omit** `loading_percent`
  (NULL), never fall back to the artifact.
- Row shape is unchanged (`line`, `bus0`, `bus1`, `timestep`, `loading_percent`),
  so **no consumer contract change** and no new capability gate.
- The rating is resolved once per ingest from the model's stored config
  (`SELECT config FROM models WHERE id = ?`), keyed by the arc name
  (`lv_<i>_trafo_<grid>` → grid = trailing number). Caveat: if the model is edited
  between dispatch and ingest the config may differ from the solved one — noted,
  accepted.

### Frontend: mark the failing connection

- A red mark is **per connection**, not "the network failed": each wire has exact
  endpoints (`bus0`/`bus1`), and `results_coordinates` gives a coordinate per node,
  so the edge is drawn between the two nodes (a straight segment — detached from the
  original cable route is fine).
- `NetworkTopology` already consumes `lineConnections` (`{bus0,bus1}`), and
  `ModelResultsViewer` already derives them from `power_transmission` `energy_cap`
  rows with `to_loc` (Round 2). So this is **colouring**, not new plumbing.
- Colour the edge (and the line in the "Worst Lines" list / loading chart) **red when
  peak utilisation > 100 %**; label it preliminary ("rated against the weakest cable
  in the grid").
- ID convention: our ids are `n1` / `ntrafo_82` (legacy was `ID_1` / `Trafo_…`), so
  `isTrafo()` and the `^ID_` strip must accept the `n`/`trafo_` forms.
- **Deferred:** auto-upgrade (rewrite `cable_type` + re-run) — red marking is enough
  for this branch.

### Known limitation (tracked, not fixed here)

Per-**cable** blame needs the real LV line network modelled (arcs built from the
`lines` features with endpoints, so each arc carries the cable's `r`/`x` and `s_nom`).
That changes the model and the flows, so it is out of scope for this branch; the
ingest design keeps the attribution source swappable (grid-level map today, per-arc
later) with **no frontend change** when it lands.

## Acceptance (Round 3)

- Re-ingesting model 28: `loading_percent` is a **real** value (0.8–3.5 %), not 100.
- A wire whose flow exceeds its grid's weakest-cable rating yields `> 100 %`.
- No rating resolvable → `loading_percent` is NULL (never a fabricated 100).
- `go build ./...` + touched packages' tests green; frontend `tsc`/`eslint` clean.
- Frontend marks a `> 100 %` connection red; `≤ 100 %` stays neutral.

---

## Round 4 — units (MW→kW), honest capabilities, and the map

### 4a. Unit mismatch — the result of the ingest is MW, the contract is kW

Everything power-related the MEME ingest writes is **1000× too small**:

| column | legacy (model 13) | ours (model 28/30) |
|---|---|---|
| `results_energy_cap.value` | `630` (`Tr_630`) | `0.25` |
| `results_carrier_prod.value` | `11.57` (kW) | `0.0175` |
| `results_pypsa_line_loading.p0` | `±3.5` (kW) | `±0.0025` |

Symptom: the Grid's utilisation chart plots `computeApparentPower(p0,q0)` — named
`pKw`, no scaling — so `0.0025` renders as **"0.0 kVA"**. Cross-check that kW is the
right unit: our demand `0.002521` ×1000 = **2.52 kW** against the building's own
`peak_load_in_kw: 3.54`, and the transformer `0.25` ×1000 = **250 kVA** = `Tr_250`
(the config's `trafo_mv_lv_type`).

**Decision:** scale power columns **MW → kW (×1000)** at write time, once, in the
mapping boundary:

- `results_energy_cap.value` (power techs)
- `results_carrier_prod.value`, `results_carrier_con.value`
- `results_pypsa_line_loading.p0` / `p1` / `q0` / `q1`

**Unchanged** (not power): `results_capacity_factor` and
`results_model_capacity_factor` (ratios), `results_model_levelised_cost` /
`results_model_total_levelised_cost` (€/kWh), `results_cost` / `results_cost_var`
(currency). One shared `mwToKw` helper; no consumer/frontend change (they already
assume kW).

### 4b. Capabilities — stop claiming losses and curtailment

`SourceMeme` declares `Losses: true, Curtailment: true` but nothing populates
either on the MEME path: `readPyPSACurtailment` needs a PyPSA file that a Coati
bundle does not carry, and the transport arcs have no impedance, so no loss data
exists. The Grid therefore shows a meaningless **"0.00 kW"** per line
(`computeLoss` returns 0 whenever `p1` is absent).

**Decision:** `SourceMeme` → `Losses: false`, `Curtailment: false`. The frontend
must then **gate the inline loss label** in the "Worst Lines" / line list on
`capabilities.losses` (it is currently printed unconditionally), so a MEME result
shows utilisation and flow without a fake loss figure.

### 4c. The map does not indicate the overload

The results map renders the model config's `lines` as a **static** GeoJSON layer, so
it cannot reflect utilisation. Those features carry only `grid_result_id`, `line_id`,
`line_name`, `length_km`, `cable_type` — **no endpoints** — so a config line cannot
be joined to a wire at all. The schematic `NetworkTopology` colours correctly because
it consumes `lineConnections`.

**Decision:** add a **data-driven connection layer** drawn from the *reconstructed*
edges — a segment between each connection's two node coordinates (from
`results_coordinates` / the map's location data), i.e. the wire's `bus0`→`bus1`
straight line. Colour it **red when the connection's peak utilisation > 100 %**,
neutral otherwise, using the same connection key as the topology
(`connectionKey(bus0,bus1)`). The edge is a straight node-to-node segment — detached
from the real cable route, which is accepted ("even if detached originally"). No new
API field: the map already has the node coordinates and the `line_loading` rows.

## Acceptance (Round 4)

- Re-ingesting 28/30: `energy_cap` transformer = 250, demand ≈ 2.5, wire flow ≈ 2.5
  (kW); the utilisation chart shows ≈ 2.5 kVA, not 0.0.
- A MEME result shows **no** loss and **no** curtailment UI (capability-driven).
- Model 30 (with the two test-overridden wires) shows the two connections red **on
  the map** as well as in the topology/list/chart.
- `go build ./...` + touched tests green; frontend `tsc`/`eslint` clean; consumers
  unchanged (kW was always their contract).
