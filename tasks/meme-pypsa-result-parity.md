# MEME PyPSA results vs EnerPlanET API contract — parity gap and options

**Audience:** MEME developer.
**Author:** EnerPlanET backend (THD).
**Date:** 2026-09-30.
**MEME revision examined:** `enerplanet/meme`, branch `main`, commit `eff4d62` (pinned PyPSA 1.2.4).
**Intent:** this is a fact-finding + options document, not a bug report. MEME's
scope choice is understood and reasonable; the question is whether the electrical
grid series can be reclaimed, and at what cost.

---

## 1. Context — how EnerPlanET consumes MEME

EnerPlanET is migrating its legacy webservice (a purpose-built PyPSA power-flow
service) onto MEME, dispatched through TentaCron:

```
backend → TentaCron (durable queue) → MEME /simulate?target=pypsa,calliope
       → zip bundle → Coati (result file → unified JSON) → backend store → REST API → React UI
```

- We never parse netCDF in Go — **Coati** (your tool) owns the result-file read.
- The backend's job is to map Coati's document into its existing result tables,
  which the UI already consumes.

---

## 2. What our API surfaces, and who consumes it

`GET /api/v1/models/:id/results/pypsa` (handler `internal/result/handler/result_handler.go:267`)
returns this shape (frontend type: `PyPSAModelResults`, `model-results/api.ts:217`):

| Response key | Field detail | UI consumer |
|---|---|---|
| `line_loading[]` | `timestep, line, bus0, bus1, p0, p1, q0, q1, loading_percent` | Grid panel — per-line peak apparent power, loss, peak loading % |
| `line_ratings` | `{line → rating}` | Grid panel |
| `voltage[]` | `timestep, v_mag_pu, v_ang, bus, location` | Bus-status dots, voltage-violation list |
| `power[]` | `timestep, p, q, bus, location` | Bus-status dots |
| `transformer_flows[]`, `transformer_loading[]` | `p0/p1/q0/q1`, `s_nom_kva` | Grid panel |
| `settings.converged`, `convergence` | convergence verdict + per-snapshot counts | "Power Flow Converged" badge |
| `curtailment[]` | available / actual / curtailed | Renewable curtailment panel |
| `locations[]` | bus list | Map cluster colours |

Where each field comes from **today** (legacy path):

- `results_pypsa_line_loading` ← `pypsa_output/csv_sim_*/csv_web/lines-p0..q1-t.csv`
  (streamed by `internal/result/service/result_streaming.go:886`).
- `line_ratings` ← `lines.csv` cable type + `v_nom`:
  `s_nom = √3 · v_nom[kV] · i_nom[kA] · num_parallel`
  (`internal/result/handler/result_helpers_pypsa_files.go:465`, cable `i_nom` table).
- `voltage` / `power` ← `buses-v_mag_pu-t.csv`, `buses-p-t.csv`.
- `convergence` / `settings.converged` ← `convergence_stats.csv`, `settings.csv`
  (`pf_attempt`, `converged_snapshots`).

> Note: the **map's** line colouring by `loading_percent` comes from the pylovo
> grid-simulation results, not from this endpoint. This endpoint feeds the Grid
> **panel** and the bus-status dots.

---

## 3. What MEME's PyPSA target actually produces

From a real solve of `examples/pypsa_full.json` (`?target=pypsa`, `succeeded`), the
bundle contains `files/run_0/{input,output}` with `output/network.nc`.

`coati inspect network.nc` reports:

```
dimensions: snapshots (24), buses_i (4), carriers_i (3),
            links_i (2), links_t_p0_i (2), links_t_p1_i (2),
            generators_i (7), buses_t_p_i (1), loads_i (3),
            storage_units_i (2), sub_networks_i (4)
```

Present: per-link active flow `links_t_p0` / `links_t_p1`, ratings
`links_p_nom_max` / `links_p_nom_opt`, and `links_r` / `links_x`.
**Absent:** `lines_i`, `transformers_i`, `buses_t_v_mag_pu`, any reactive power,
any convergence artefact.

Emitted input files: `network.csv, buses.csv, carriers.csv, generators.csv,
loads.csv, links.csv, storage_units.csv, global_constraints.csv` + materialised
time-series CSVs. `buses.csv` header is `name,carrier,x,y,v_nom` — **no `control`
column**.

The generated driver (`files/run_0/run.py`, from `internal/scripts/pypsa_run.py`)
calls `optimize.solve_model(...)` and then `export_to_netcdf(output/network.nc)`.
It never calls `network.pf()`.

Both transmission arcs in the fixture are **Links** (`links.csv`):

| name | bus0 | bus1 | p_nom_opt | efficiency | r | x |
|---|---|---|---|---|---|---|
| chp | n1::gas | n1::electricity (+bus2 n1::heat) | 100 | 0.4 | — | — |
| line1 | n1::electricity | n2::electricity | 300 | 0.967575 | 0.01 | 0.1 |

So a wire (`line1`) is a transport arc with an active-power flow and a capacity —
no electrical loading, no voltage, no reactive, no pf.

---

## 4. The comparison, field by field

| API field needed | Available from MEME P? | What MEME offers instead |
|---|---|---|
| `line_loading[].p0 / p1` | ⚠️ equivalent | `links_t_p0` / `links_t_p1` (active flow on the arc) → Coati `transmission_flow` |
| `line_ratings` | ⚠️ equivalent | `links_p_nom_opt` (transport capacity, MW); Coati `capacities` |
| `line_loading[].loading_percent` | ❌ | **only** `\|flow\| / capacity` — "utilization" |
| `line_loading[].q0 / q1` | ❌ | no reactive power is computed |
| `voltage[]` (`v_mag_pu`, `v_ang`) | ❌ | no `network.pf()`, no bus voltage variable |
| `power[]` (`p`, `q`) | ❌ | `buses_t_p` exists but is the bus-balance residual (≈0 by construction) |
| `transformer_flows[]`, `transformer_loading[]` | ❌ | no `Transformer` components are emitted |
| `settings.converged`, `convergence` | ❌ | the LP grade (`succeeded`/infeasible) is not a convergence verdict |
| `curtailment[]` | ✅ | derivable from `generation` vs availability series |
| `locations[]` | ✅ | bus names / node ids |

Coati already normalises **Calliope and PyPSA identically** here
(`submodules/Coati/src/coati/results/calliope07.py:222-243` and `pypsa.py:543` both
call `net_flows(arrivals)`), and Coati already reads `lines`/`transformers` and uses
`s_nom` as branch capacity (`pypsa.py:241,481`) — so it would classify real Lines
correctly for free. But the Coati **document has no voltage/loading field**
(`schema_version` is pinned `const "1.0"`), so even if MEME emitted them, Coati
would not surface them without a schema extension.

---

## 5. Why the data is missing (as we understand it)

This is a deliberate schema decision in MEME, which its own source states:

> `power_flow (Lines/Transformers, KVL) is NOT claimed: no canonical field emits a
> lines.csv — all transmission becomes transport Links. Reclaim once the schema
> carries electrical parameters (r, x, s_nom).`
> — `dependencies/meme/internal/target/pypsa/pypsa.go:37-39`

and in `schemas/CAPABILITY.md` (§5 and §8.3): `power_flow` is deliberately not
claimed for PyPSA; electrical parameters (`x`, `r`, Lines/Transformers) are listed
as a **native-only**, not-yet-canonical use.

Consequences, in order:

1. The canonical `transmission` model
   (`internal/model/model.go:371-401`) expresses a transport arc only:
   `carrier / from / to / bidirectional / capacity / efficiency / distance /
   loss_per_distance / min_flow / emission_factor / energy_consumption / costs /
   native`. There is no `s_nom`, `r`, `x`, `v_nom`, `type` or `num_parallel`.
2. Because no canonical field emits a line, the emitter
   (`internal/target/pypsa/emitter.go:189-236`) writes **every** arc as a `links`
   row, unconditionally, and only `generators/loads/links/storage_units` CSVs are
   written (l.285-291).
3. Because there is no `Line`, the driver has nothing to power-flow, and the
   executor calls `solve_model()` only — no `network.pf()`.
4. Therefore the result bundle carries a dispatch solution for a transport graph,
   and the electrical series and convergence verdict were never produced.

We want to stress: this is coherent design, consistent with MEME's "one canonical
model, three frameworks, framework-specifics via `native`" rule. Our legacy
webservice was the opposite extreme — a purpose-built distribution-grid AC
power-flow tool. Its config carried real line hardware (one LV cable type, one MV
cable type, a transformer type; `v_nom_lv = 0.4`, `v_nom_mv = 20`) and it ran
`network.pf()`, producing `lines-p0/p1/q0/q1-t.csv`, `buses-v_mag_pu-t.csv` and
`convergence_stats.csv`. So the two results differ **by construction**, not by a
bug we can fix downstream — `loading_percent`, voltage and `converged` cannot be
reconstructed from a dispatch LP.

**Side note (not an ask):** `links_r` / `links_x` already pass through as native
link columns, so the impedance data is *one step* from usable — it is simply not
consumed by anything today.

---

## 5b. What the EnerPlanET user loses (UI level)

Concrete, so the trade-off is visible. All of this is the **Grid** view of
model-results (`GridPanel.tsx` + `NetworkTopology.tsx` + the map's bus markers),
which is the only place the PyPSA electrical results surface today. (The map's
*line colouring* by `loading_percent` comes from the separate pylovo grid
path, so it is unaffected either way — as is the model-builder, which has no
grid view yet.)

**Lost outright — no data source at all:**

| UI feature | Driven by | With MEME today |
|---|---|---|
| "PyPSA Run Status" card: Converged/Needs Review badge, Snapshots `n/N`, PF mode, LPF mismatch | `convergence`, `settings.converged` | badge defaults to **"Needs Review"**, tiles read `-` |
| Voltage Profile chart (per-bus `v_mag_pu` over time) | `voltage[]` | "No voltage data" |
| Power Flow chart (active + reactive per bus) | `power[]` | "No power data" |
| Voltage Violations chart + "Worst Buses" | `voltage[]` | **empty → reads "No voltage violations."** |
| EN 50160 voltage-status semantics (normal / warning / critical, 0.95–1.05 pu) | `voltage[]` | concept unusable |
| Bus Details: Avg Voltage, Avg Power, Voltage span | `voltage[]`, `power[]` | `-` |
| Transformer Loading chart + "Most loaded transformer"/"Top transformer" | `transformer_loading[]` | `n/a` |
| Transformer half of the Losses chart | `transformer_loading[]` | zero |
| Network Topology node colouring by voltage status + node voltage label | `voltage[]` | topology still draws, colouring flattens |
| Map bus markers (when the Grid view is open) | `voltage[]` | markers appear, **always green "1.00"** |

**Degraded — renders, but the number means something else:**

| UI feature | Issue |
|---|---|
| Line Loading chart / "Worst Lines" / "Busiest line" | shows **utilization** (`\|flow\|/capacity`), not electrical loading; caps at 100% |
| `peakApparentKva` (kVA) | no reactive → apparent power collapses to `\|P\|`; the unit label is wrong |
| Line losses | ✅ still valid (`\|p0−p1\|` from `links_t_p0/p1`) |

**Kept:** line list + per-line flow/rating/utilization, bus/node list and count,
Network Topology graph structure, Renewable Curtailment chart, line-losses
timeline.

**Binary gate worth knowing:** `GridPanel` returns `PanelEmptyState`
("No PyPSA grid data available") when `locations` is empty — so *nothing* in the
Grid view renders unless the backend populates `locations`. Populating
`locations` + `line_loading` + `line_ratings` is the difference between "a partial
Grid panel" and "no Grid panel at all".

**Three places the UI would read *falsely reassuring* rather than empty** unless
we explicitly gate them: the Converged badge (amber "Needs Review" when the flag
is simply absent), the empty "No voltage violations." list, and green "1.00 pu"
bus markers. Any decision to ship without the electrical data must include
suppressing these, not just omitting the arrays.

---

## 6. What we can supply from our side

So the answer isn't "you need data we can't provide":

- We have **levelised** line hardware data today: one LV cable type and one MV
  cable type per model (extracted from the grid GeoJSON `cable_type`), plus
  transformer types and `v_nom`. Rating is derivable exactly as we do now:
  `s_nom = √3 · v_nom · i_nom · num_parallel`.
- The grid topology (which building connects to which node/transformer, line
  lengths) comes from pylovo; per-line `r`/`x` would have to come from that
  geometry. **This is a producer-side question we would have to answer jointly** —
  if we only ever have per-voltage-level cable data, any PF would be a
  levelised approximation, and we should agree up front whether that is
  acceptable.
- We can supply an explicit **slack designation** from the model (our legacy
  config had `mv_slack`); MEME's canonical model has no slack/bus-control concept,
  so that is a decision to be made, not data to be found.

---

## 7. Options, simplest → most advanced

Ordered by cost, each stating what it buys. Options are not exclusive — S1 is a
prerequisite that de-risks S2/S3.

### S0 — Do nothing; we ship "utilization" on our side *(cost: zero MEME change)*

We compute `utilization = |flow| / capacity × 100` from `links_t_p0` +
`links_p_nom_opt`, expose it explicitly labelled as *utilization* (not
`loading_percent`), leave `voltage`/`power`/`convergence` empty, and document the
limitation in the UI. Handles "which wire runs hot" in the capacity sense and
cannot lie. **Does not** restore electrical loading, voltage or convergence.

### S1 — Make the wire/flow data explicit and machine-obvious *(small, low risk)*

Today a consumer must dig: the wire is a `Link` row, and the flow lives in
`links_t_p0`. Two cheap additions would make the result self-describing:

- Mark each link's canonical origin on the emitted `links.csv` (e.g. a
  `source: transmission | conversion` column), so consumers don't have to infer
  "wire vs CHP link" from carrier/bus heuristics.
- Optionally emit a tiny `wire_summary.json` (per transmission id: `from`, `to`,
  `capacity`, peak/sum flow) so a client can answer "which line runs hot" without
  reading the netCDF.

Buys: robustness for us and for any other consumer; zero modelling risk.

### S2 — Emit real `Line`s and run a power flow via `native` *(medium; no schema change)*

Reach the electrical result without touching the canonical schema:

1. Let `native.pypsa` carry `r`, `x`, `s_nom`, `v_nom`, `type` on a transmission
   entry (the fields are already merged verbatim, as `links_r`/`links_x` prove).
2. Teach the emitter: when electrical parameters are present, emit a `lines.csv`
   row (`bus0`, `bus1`, `s_nom`, `r`, `x`, `v_nom`, `num_parallel`, `type`)
   instead of / in addition to the link row.
3. In the driver, designate a slack bus and call `network.pf()` **after** the
   solve. Two details need care:
   - export the LP `network.nc` **before** `pf()` (it overwrites `generators_t.p`
     / `buses_t.p`), then export the pf series separately (legacy used a separate
     output folder) or into a second file;
   - `pf()` needs a slack (`buses_control`), and today no `control` column is
     emitted — the fixture only reads `Slack` because that is PyPSA's default.
     The slack choice must become explicit.
4. Handle non-convergence explicitly (`lpf()` first, tolerance, a convergence
   report), and treat "pf failed" as a reportable outcome, not a job failure.

Buys: voltage, reactive, per-line flow and a convergence verdict — i.e. full
parity with the legacy electrical diagnostics. Cost sits in the driver semantics
plus the Coati side (see §8).

### S3 — First-class canonical electrical parameters + a `power_flow` mode *(larger, the "reclaim")*

This is what MEME's own comment describes. Add to the canonical `transmission`
model: `s_nom` (rating), `r`, `x`, `v_nom`, `type`/`num_parallel`; claim the
`power_flow` capability; emit `Line`/`Transformer` components when the parameters
are present; run `network.pf()` behind an explicit switch (e.g.
`experiment.power_flow: true`), so the default stays the fast LP. Ship the
convergence report in the bundle.

Buys: a first-class, validated, documented feature usable by all consumers, instead
of a `native` convention. Cost: schema + JSON Schema + validation + goldens +
capability matrix + capability-coverage scenario (MEME requires every claimed
feature to be backed by a runnable scenario).

### S4 — Grid-grade detail *(most advanced; only if the target models need it)*

The full distribution-network story the legacy service had: per-line and
per-transformer components from a grid description (LV/MV cable types, `v_nom`
levels, transformers), `network.pf()` with `lpf()` fallback, per-snapshot voltage /
reactive / loading percent, convergence statistics — fed by a producer-side model
that carries per-line electrical parameters. This is a joint project between MEME
and EnerPlanET, not a MEME-only change.

---

## 8. The Coati half of the question

Whatever MEME emits, we consume through Coati, so it is worth deciding the split
explicitly. Concretely:

- **Already fine:** Coati reads `lines`/`transformers` and `s_nom`
  (`pypsa.py:241,481`), so real Lines produce correct `capacities` with no Coati
  change.
- **Missing:** the Coati document has no voltage / reactive / loading /
  convergence fields, and `schema_version` is pinned `const "1.0"`. Surfacing the
  pf series means **extending the schema and bumping the version**, which ripples
  into our ingest validation.
- **We would rather not** have the Go side read netCDF variables that Coati does
  not model — that would create a second, unversioned parse path.

So an S2/S3 change is only useful to us if the corresponding Coati field exists
(or is planned). Asking to coordinate those two together.

---

## 9. Recommended minimal ask

If only one thing happens, we would ask for **S1** (mark transmission arcs and/or
a wire summary) — it costs little, is risk-free, and makes the existing data
correctly and stably consumable.

If the electrical result is worth reclaiming, our suggested order is **S2 → S3**,
starting with the three open questions that decide the outcome, because they are
modelling decisions rather than code:

1. **Slack designation** — who owns it, and how is it expressed in the canonical
   model?
2. **Electrical parameter source** — can the canonical model carry per-line `r`,
   `x`, `s_nom`, `v_nom`, or is a levelised per-voltage-level approximation the
   realistic target?
3. **pf outcome semantics** — how should a non-converged power flow be reported in
   the bundle, and does it fail the job or just annotate it?

---

## Appendix — evidence and reproduction

Fixture: solved `examples/pypsa_full.json` against MEME `?target=pypsa`.

```bash
# 1. Result bundle contents
unzip -l meme-pypsa-full-result.zip          # files/run_0/{input,output}/network.nc

# 2. What the solved network actually holds (no value reads)
coati inspect files/run_0/output/network.nc
#   -> no lines_i, no transformers_i, no buses_t_v_mag_pu

# 3. The transport arcs
head -3 files/run_0/input/links.csv
#   name,bus0,bus1,p_nom,p_nom_extendable,p_nom_max,efficiency,...,p_min_pu,r,x
#   line1,n1::electricity,n2::electricity,0,True,300,0.967575,...,-1,0.01,0.1

# 4. No power flow is run
grep -c "\.pf(" files/run_0/run.py     # -> 0

# 5. Legacy bundle, for contrast
ls legacy/*/pypsa_output/csv_*/csv_web/ | head
#   lines-p0-t.csv, lines-p1-t.csv, buses-v_mag_pu-t.csv, ...
cat legacy/*/pypsa_output/settings.csv
#   line_type_lv,NAYY 4x150 SE / line_type_mv,NA2XS2Y 1x185 RM/25 12/20 kV / v_nom_lv,0.4 / v_nom_mv,20
```

Relevant MEME sources: `internal/target/pypsa/pypsa.go:31-47`,
`internal/target/pypsa/emitter.go:189-236,285-291`,
`internal/model/model.go:371-401`, `internal/scripts/pypsa_run.py:132-138`,
`schemas/CAPABILITY.md` §5 / §8.3.
