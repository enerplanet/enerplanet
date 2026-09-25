# Go-Meme-Parser — MEME Result Parsing Capabilities

Source of truth for extracting MEME run results into a usable form, so it can be
re-implemented (or wrapped) as a dedicated Go package that parses results and
returns them.

Primarily derived from the **TEMPO** repo (`~/Projects/github/TEMPO`), which
already does all of this in frontend JS. The TEMPO Go backend
(`backend-go/internal/api/jobs.go`) only **stores the raw result JSON** — all
parsing/interpretation happens in the browser. This doc maps that JS to where
each capability lives, the result contract shape, and the porting notes.

---

## 1. Where the capabilities live in TEMPO

| File | Role | Parsing it owns |
|------|------|-----------------|
| `src/services/memeClient.js` | Remote MEME run driver | Fetch/retrieve the result contract, AdOpT-NET0 contract **normalization** |
| `src/services/memeFormat.js` | Internal model → MEME canonical payload | **Builds the request** (not parse); the inverse mapping lives here conceptually |
| `src/utils/resultFormat.js` | Pure result helpers | Location/tech key parsing, classification, naming transforms |
| `src/utils/resultCharts.js` | ECharts chart options from contract | Aggregation for visuals |
| `src/utils/resultExports.js` | CSV/JSON/PNG export from contract | Aggregation, KPIs (LCOE, renewable share), file building |
| `src/services/__tests__/memeClient.test.js` | Unit tests | Canonical contract shape + poll protocol examples |

**Key insight:** parsing is a two-stage concern —

1. **Transport/retrieval** (`fetchContract`) — get the contract off the MEME job.
2. **Interpretation** (`aggregateResult`, `normalizeAdoptContract`,
   `resultFormat` helpers) — turn the raw contract into typed, queryable data.

The Go package should own stage 2 (pure, testable) and optionally stage 1
(driver for the MEME HTTP API).

---

## 2. Retrieving the result contract (stage 1)

MEME's async job protocol (from `memeClient.js` header + tests):

```
POST /simulate?target=<pypsa|calliope|adopt-net0>   → 202 { id, state, warnings }
GET  /jobs/{id}/status                              → { state, log, error, ... }
GET  /jobs/{id}/result.json  (MEME extension)       → frozen contract JSON
GET  /jobs/{id}                                    → full zip bundle (optional)
```

Contract resolution order in `fetchContract()` (`memeClient.js:307`):

1. `status.runs[].contract` — first run that has one (MEME job-view shape).
2. `status.contract` — top-level inline contract.
3. `GET /jobs/{id}/result.json` — fallback fetch.
4. If the contract is keyed by target (multi-target extension) and has no
   `capacities` field, unwrap `status.target` → the sub-object.

The driver polls `/status` every ~1.5 s (`DEFAULT_POLL_MS`) until `state` is
`succeeded` / `failed`; it streams `log` deltas and reports `elapsed` seconds as
stats (MEME has no CPU/RAM). `cancel()` only detaches the UI — there is no per-job
cancel endpoint, so this is irrelevant for a library.

**Auth note:** `api_key` is a **top-level JSON body field**, never a header
(`memeClient.js:362`).

---

## 3. The frozen result contract (parsing target)

A single baseline run returns one flat object. Field inventory from every
consumer in `src/` (result, `resultExports.js`, `Results.jsx`, tabs):

| Field | Type / shape | Means |
|-------|-------------|-------|
| `objective` | number | Minimized objective (total system cost) |
| `termination_condition` | string | `"optimal"` / `"infeasible"` / … |
| `capacities` | `map "loc::tech" → number` | Installed capacity MW |
| `generation` | `map "loc::tech" → number` | Total generation MWh (also `"total::tech"` for summed) |
| `costs_by_tech` | `map tech → number` | Cost per tech |
| `costs_by_location` | `map loc → {tech: cost}` | Cost per location |
| `demand_by_location` | `map loc → number` | Demand MWh per location |
| `unmet_demand_by_location` | `map loc → number` | Unmet demand MWh per location |
| `unmet_demand_total` / `total_unmet_demand_mwh` | number | Total unmet demand |
| `imports_by_location` | `map loc → number` | Import MWh per location |
| `demand_timeseries` | `number[]` | Demand timeseries |
| `dispatch` | `map tech → number[]` | Dispatch timeseries, aligned to `timestamps` |
| `timestamps` | `ISO8601 string[]` | Time axis for `dispatch` |
| `transmission_flow` | `map "A::B" → {from, to, timeseries[]}` | Line flows |
| `shadow_prices` | object | Duals (optional tab) |
| `spores_data` | array | SPORES ecosystem results (optional) |
| `tech_metadata` | `map tech → {parent, carrier_out, display_name}` | Tech classification (authoritative) |
| `tech_parents` | `map tech → parent` | Legacy/flat fallback for classification |

**Note the key format** — nested `loc::tech` or `loc::tech:dest` (transmission).
Everything downstream starts by splitting on `::`:

```js
// resultFormat.js:196 — parseLTC
"Berlin::solar_pv::electricity" → { loc: "Berlin", tech: "solar_pv", carrier: "electricity" }
"loc::tech:dest" (a link)      → tech contains ":" → treat as transmission
```

---

## 4. Interpretation (stage 2)

### 4a. `aggregateResult` — `resultExports.js:31`
Pure and self-contained; the primary "parse and return" entry point for summary
data. Returns:

```js
{
  capByTech:     {},   // tech → summed capacity (skips 0/neg, skips ":" link atoms)
  genByTech:     {},   // tech → summed generation
  costByTech:    {},   // raw costs_by_tech
  totalCap, totalGen, totalCost,
  renewableShare,      // renGen / totalGen
  lcoe,                // totalCost / totalGen
}
```
Renewable keyword list (`RENEWABLE_KW`) is a simple substring match on tech name
(solar, wind, hydro, biomass, biogas, geo, geothermal, pv, csp, tidal, wave).

### 4b. `normalizeAdoptContract` — `memeClient.js:182`
AdOpT-NET0's HDF5 extractor returns DB-native tech names (`Storage_Battery`,
`Photovoltaic`), integer timestamps, and empty generation/costs. Trade imports
are never in HDF5. The normalizer rebuilds a canonical contract:

1. **Remap capacities** — `"Arica::Storage_Battery"` → `"Arica::battery"` via a
   reverse map built from `modelData.technologies` by matching `performance.model`
   (`pv`, `wind`, `heat_pump`) or `essentials.parent === 'storage'`.
2. **Remap dispatch** — DB tech name → TEMPO tech id.
3. **Generate ISO timestamps** from `modelConfig.startDate` + `resolution`
   (parsed as HHh, e.g. `3H` → 3). `n` = max dispatch/timestamp length.
4. **Build `tech_metadata`** from the model definition (parent, carrier_out, name).
5. **Resolve demand timeseries** — inline array, scalar, or `file=name.csv:col`
   reference (handles both `ts.data` row-objects and raw `csvContent` fallback).
6. **Infer generation** when HDF5 gave none — sum positive dispatch for
   supply/conversion parent types, or synthesize **trade imports = demand** when
   a `supply_plus` tech has unlimited (`inf`/`≥1e13`) resource, including
   estimated import cost from `om_prod`.

This is a model-aware normalizer (needs the original model definition), the only
parsing step that is not pure contract-in → contract-out.

### 4c. `resultFormat.js` classification helpers
- `isTransTech(tech)` — contains `:` or "transmission".
- `makeIsGenTech(result)` — builds a predicate from `tech_metadata.parent`
  (authoritative), falling back to `tech_parents`, then name heuristics.
  GEN_PARENTS = supply, supply_plus, storage, conversion, conversion_plus.
- `classifyTech(t)` / `TECH_GROUPS` — fallback heuristic classifier (gen / stor /
  conv / tx / demand / h2 / infra) when no metadata is present.
- `calliopeLocName()` — replicates Python `_safe_id().lower()` for name matching.
- `parseLTC()` — `loc::tech:carrier` splitter (see §3).
- Unit-aware formatters (`fmtPower`, `fmtEnergy`, `fmtCost`, `autoScale`) for
  downstream reporting.

### 4d. `buildResultDataFiles` — `resultExports.js:74`
Straight contract→tabular conversion (already "parse and return" shaped) —
produces named CSVs + full `result.json`. Helpful as a reference for the Go
package's CSV output:

- `summary_kpis.csv` — objective, termination_condition, totals, renewable %,
  LCOE, unmet demand.
- `capacities.csv` / `generation.csv` — `location, technology, value`.
- `costs_by_tech.csv`, `costs_by_location.csv`.
- `demand_unmet_by_commune.csv`.
- `dispatch.csv` — timestamp × tech matrix.
- `result.json` — the raw contract.

---

## 5. Porting to Go — mapping & notes

**Transport (stage 1)** is a thin HTTP client (~`memeClient.js`): poll `/status`,
then fetch contract from `runs[].contract` / `status.contract` / `result.json`.
Roughly 100 lines + timeout/concurrency handling. Straightforward in Go.

**Interpretation (stage 2)** is the real value and is **fully portable + pure**
except `normalizeAdoptContract`, which needs the model definition alongside the
contract:

| Go package suggestion | Source | Notes |
|-----------------------|--------|-------|
| `contract` | struct model of §3 fields | Nested maps `loc::tech`, custom UnmarshalJSON optional |
| `aggregate` | `aggregateResult` + `buildResultDataFiles` | Pure math; easy to TDD |
| `normalize` (adopt) | `normalizeAdoptContract` | Needs model def; keep separate from pure path |
| `classify` | `resultFormat.js` helpers | Name heuristics + parent-based predicate |
| `client` (optional) | `fetchContract` loop | Poll + API-key-in-body |

**Pitfalls & rules:**
- Split keys on `"::"`; a second `":"` inside the tech segment = transmission.
- Skip `≤0` values when aggregating capacities/generation.
- AdOpT timestamps may be integers; synthesize ISO from start+resolution when
  missing. TEMPO names dispatch keys per-tech (not per-loc).
- Renewable share + LCOE come from *aggregated* numbers, not per-key.
- `api_key` travels in the **body**, not headers.
- The Go package should be **pure and side-effect free** for parsing; keep the
  HTTP driver separate so parsing is unit-testable without a live MEME server.

---

## 6. Concrete test contract (from `memeClient.test.js`)

Minimal contract your parser must handle:

```json
{
  "objective": 42,
  "termination_condition": "optimal",
  "capacities": { "n::solar": 80 }
}
```

And the runs-based status shape:

```json
{
  "state": "succeeded",
  "target": "pypsa",
  "runs": [
    { "target": "pypsa", "index": 0, "exit_code": 0,
      "contract": { "capacities": { "n::solar": 80 } } }
  ]
}
```
