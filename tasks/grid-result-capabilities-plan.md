# Grid result capabilities — plan (provenance + conditional UI)

**Status:** `[IN PROGRESS]` — Phases 1, 2, 3 and **4 (frontend gating)** landed &
verified (2026-09-30); Phase 5 (tests) partially — `capabilitiesFrom` unit test
added, component/DOM test infra absent in this app. Live end-to-end run still
pending (see `meme-integration-plan.md` §Remaining work).
**Supersedes:** `tasks/grid-panel-feature-flags.md` (static flags dropped in favour
of this dynamic, data-driven design).
**Parent:** `tasks/meme-integration-plan.md` §8.3/§8.4, D8/D9.
**Why now:** the MEME PyPSA route is the only source of results for meme runs, and
it cannot produce voltage/reactive/convergence/transformers. Rather than ship a UI
that silently omits — or worse, *fakes* — those, we declare result provenance and
let the UI render accordingly. This is also the resumption point: Step 6/8 stopped
at PyPSA parsing precisely because of this gap.

---

## 0. Current state (what we stopped at)

Last three commits on `feature/meme-integration`:

| Commit | What it did |
|---|---|
| `ecaa922` | heat patch for the MEME dispatch path — T1K `mapping.json` + `internal/meme/t1k.go` (+ live test); the payload/translate side |
| `93fb8b3` | dispatch over TentaCron's **durable queue** — `internal/jobs/dispatch_meme.go`, `jobs/result_zip_store.go`, `model_meme_runs` (migration `046`), TentaCron client/`dispatch.go` |
| `0a21524` | **MEME dispatch + Coati result ingest** — `internal/result/service/coati{,_doc,_ingest}.go`, `internal/jobs/ingest_meme_result.go`, `submodules/Coati` added; ingest writes the R2 small/summary tables for **Calliope only** |

So: dispatch ✔, zip stored ✔, **Calliope** parsed ✔, **PyPSA not parsed yet**
(`IngestCoatiResult` locates only `files/<target>/run_i/output/results.nc` and its
own doc says "Calliope-electricity-only for now"). Step 8.3 (the PyPSA wire
writer) is where this plan picks up.

---

## 1. Decisions (locked)

| # | Decision |
|---|---|
| C1 | Provenance is a **3-valued enum**: `"legacy"` \| `"meme"` \| `"full-grid-pf"` |
| C2 | Persist **only the source**; derive the capability set from it in Go (one mapping function, one source of truth). No capability matrix stored in the DB. |
| C3 | Legacy results are **backfilled by a migration** → `"legacy"`, so already-parsed models stay correct and the mapping survives removal of the old parser. |
| C4 | When the Coati/upstream pf feature ships, the ingest writes `"full-grid-pf"` — **the UI needs no change** (the same capability lookup flips the sections back). |
| C5 | **Lines are a relabel, not a gate**: `line_loading` stays present for `"meme"`, but `loading_percent` is labelled *utilization* and kVA-as-`\|P\|`. Driven by a `utilizationOnly` capability. |
| C6 | Missing data: **prod hides** the component entirely; **local shows a small in-place placeholder** naming the truncated component. |
| C7 | **No summary strip** (rejected: complexity without user value). |
| C8 | Local placeholder gating: `import.meta.env.DEV \|\| VITE_SHOW_RESULT_GAPS === 'true'` (the repo's 127-exit `import.meta.env.DEV` convention; the env escape covers a *built* local bundle where `DEV` is false). Vite statically substitutes `DEV`, so the placeholder is dead-code-eliminated in prod. |

---

## 2. Phase 1 — API contract (schema-first)

Additive block on `GET /api/v1/models/:id/results/pypsa`
(handler `internal/result/handler/result_handler.go:267`):

```jsonc
{
  "source": "meme",                       // legacy | meme | full-grid-pf
  "capabilities": {
    "convergence":     false,
    "voltage":         false,
    "power":           false,
    "transformers":    false,
    "lineLoading":     true,
    "utilizationOnly": true,              // -> relabel, not gate
    "curtailment":     true,
    "losses":          true
  },
  "line_loading": [ … ], "line_ratings": { … }, "locations": [ … ]
}
```

Source of truth for the mapping (new, backend-owned):

```
internal/result/capabilities/capabilities.go
  type Source string            // legacy | meme | full-grid-pf
  type Capabilities struct { … } // the keys above
  func For(s Source) Capabilities
```

`For("legacy")` = everything true; `For("meme")` = the block above;
`For("full-grid-pf")` = everything true. Unknown/empty source → treat as the
**least** capable (never assume data exists → never fake).

**DONE (2026-09-30):** `internal/result/capabilities/capabilities.go` (Source,
Capabilities, `For`) + `capabilities_test.go` (truth table, unknown-claims-nothing,
JSON key pinning). The handler now opens the response with
`"source"` + `"capabilities"` (`result_handler.go` `GetPyPSAResults`).
`go build ./...` exit 0; `go test ./...` 0 FAIL / 28 ok.

---

## 3. Phase 2 — Provenance persistence + backfill migration

**Persist** the source on both result write paths:

| Path | Where | Value |
|---|---|---|
| legacy streamer | `internal/result/service/result_service.go:145-152` (already updates `model.results`) | `"legacy"` |
| Coati ingest | `internal/result/service/coati_ingest.go:206-214` (already updates `model.results`) | `"meme"` |

**Storage — RESOLVED: (B) dedicated column.**

- **(B) `models.result_source` column** (chosen 2026-09-30). The struct field lands
  in `infrastructure/common/pkg/models/model.go` — the `infrastructure` submodule,
  so the edit must be committed **in that submodule's repo**, separately from the
  backend changes. Nullable/`size:32`, so it is backwards-compatible for
  `auth-service` / `webservice` (webservice is legacy and goes away once the MEME
  integration completes).

**Migration `047` (either way) — backfill already-parsed models:**

```sql
-- 047_add_result_source.sql
BEGIN;
-- (A) UPDATE models SET results = results || '{"source":"legacy"}'::jsonb
--     WHERE results IS NOT NULL AND NOT (results ? 'source');
-- (B) ALTER TABLE models ADD COLUMN IF NOT EXISTS result_source TEXT;
--     UPDATE models SET result_source = 'legacy'
--     WHERE result_source IS NULL
--       AND EXISTS (SELECT 1 FROM model_results mr WHERE mr.model_id = models.id);
COMMIT;
```

Backfill predicate: a model **has parsed results** — presence of `model_results`
rows (and/or non-null `model.results`). Deliberately does *not* touch models with
no results.

**Done when:** a legacy-parsed model and a meme-parsed model report the correct
`source`; a never-parsed model reports none.

**DONE (2026-09-30)** — option (B):

- `infrastructure/common/pkg/models/model.go` — `ResultSource string`
  (`gorm:"column:result_source;size:32"`, `json:"result_source,omitempty"`).
  **Submodule edit** (`.gitmodules` → `path = infrastructure`): commit it in that
  repo.
- `migrations/047_add_model_result_source.sql` — `ADD COLUMN IF NOT EXISTS` +
  backfill `'legacy'` where `model_results` rows exist. The migration runner
  re-executes every file each run, so it is written idempotent.
- Both write paths set the source: legacy streamer
  (`result_service.go`, `"legacy"`), Coati ingest (`coati_ingest.go`, `"meme"` —
  the `Update("results", …)` became a two-key `Updates(map)`).
- Verified: `go build ./...` exit 0; `go test ./...` → **0 FAIL, 28 ok**
  (`infrastructure/common` builds + vets clean too).

---

## 4. Phase 3 — PyPSA ingest (resumes Step 8.3)

Extend `IngestCoatiResult` (`internal/result/service/coati_ingest.go`) with a PyPSA
branch — the exact work Step 8 left open:

1. Locate the per-target PyPSA file: `files/pypsa/run_i/output/network.nc`
   (mirror `locateCalliopeResultsNC`).
2. `coati convert <network.nc> - pypsa-v1-2-4`.
3. Map into the **existing** tables — no migration, they already exist:
   - wire set = `tech_metadata[tech].parent == "transmission"`,
   - `transmission_flow["a::b"].timeseries` → `results_pypsa_line_loading`
     (`line`, `bus0`/`bus1` = `from`/`to`, `p1` = series, `p0` = series ÷ efficiency
     — Coati reports **destination-side arrival**; see plan §8.3),
   - `capacities["a::tech"]` → `line_ratings`,
   - node ids → `locations` (the panel's render gate),
   - **do NOT** write voltage/power/convergence/transformers.
4. Set `source = "meme"`.
5. Keep the transaction/idempotency shape (delete-then-store, as Calliope).
6. Serve **one leg** per model — prefer PyPSA, fall back to Calliope
   (plan §8.3 "Leg selection"). Two legs are two different solves of the same
   wires; never concatenate.

**Done when:** a PyPSA model submits via TentaCron and `/results/pypsa` returns
`locations` + `line_loading` + `line_ratings` + the meme capability block.

**DONE (2026-09-30)** — as built, with three deviations from the sketch above:

- `internal/result/service/coati_wire.go` — `mapWireLoading` / `wireRatings` /
  `wireNamesByEndpoints` / `sortedPair` / `wireDocument`. One mapping serves both
  legs (Coati normalises them); `wireDocument` prefers the PyPSA `network.nc` and
  **logs** the fall-back to the Calliope document when the bundle has no PyPSA
  output or Coati cannot convert it.
- **A wire is named by its transmission technology, derived from the capacity
  endpoint pairs.** `transmission_flow` entries carry no tech id, so the name is
  recovered from the `"loc::tech"` capacity keys (a transmission tech appears once
  per endpoint). Where two wires cover the same node pair the derivation is
  ambiguous and the row falls back to the node-pair key.
- **P1 is nil, by design:** Coati reports the destination-side net arrival and the
  document carries no origin-side series, so `p0` holds that value and losses read
  0. Documented on `PyPSALineLoadingRecord`.
- **`line_ratings` lives in the result summary**, not a new column:
  `CoatiSummary.LineRatings`/`LineCount`, read back by the handler
  (`lineRatingsFromSummary`) only when the on-disk `lines.csv` read found nothing.
- **`locations` widened** (store `GetPyPSALocations`, replacing
  `GetPyPSAVoltageLocations`): the union of `results_pypsa_voltage.location` and
  the wire endpoints `bus0`/`bus1` — the panel's render gate for either source.
- Tests: `coati_wire_test.go` (naming, utilisation, negative flow, ambiguity
  fallback, missing rating, bounds) + `TestLiveWireMappingRealPyPSA` in
  `coati_live_test.go` (`manualignis`) over the real `pypsa.zip` fixture.
  **Verified live:** real `network.nc` → `ratings={line1:300}`,
  `names={n1::n2: line1}`, 24 rows, peak utilisation **40.00%** (120/300) —
  matches the hand-checked fixture. `go build ./...` exit 0;
  `go test ./...` → **0 FAIL, 28 ok**.

---

## 5. Phase 4 — Frontend

**New files**

- `src/config/resultCapabilities.ts` — the `Capabilities` type + a hook
  (`useResultCapabilities(pypsaData)`) reading the response block, defaulting to
  **least capable** when absent (so a stale backend can't un-hide things).
- `src/features/model-results/components/ui/GatedSection.tsx` — one wrapper:
  - unmet requirement + prod → `null`;
  - unmet requirement + local → small in-place placeholder card (dashed border,
    `CHART_CARD_CLASS`, the section's own title/icon, "not in this result") so the
    slot, its name and the reason are visible;
  - met → children.

**Wiring (components to gate — inventory with line refs):**

| Flag / capability | Components | File refs |
|---|---|---|
| `convergence` | "PyPSA Run Status" card | `GridPanel.tsx` ≈L481–535 |
| `voltage` | Voltage Profile; Voltage Violations; Worst Buses; Bus Details avg-voltage + voltage-span tiles; NetworkTopology node colour + voltage label; map bus markers + status derivation | `GridPanel.tsx` ≈L623–642, L667–672, L719–733, L564–583; `NetworkTopology.tsx` ≈L31–45, L143–161, L185–200; `useModelResultsMap.ts` ≈L383–429; `ModelResultsViewer.tsx` ≈L102–128, L505–513, L525 |
| `power` | Power Flow chart; Bus Details avg-power tile | `GridPanel.tsx` ≈L644–665, L570–575 |
| `transformers` | Transformer Loading chart; "Most loaded transformer"; "Top transformer"; transformer half of the Losses chart | `GridPanel.tsx` ≈L680–685, L584–591, L608–615, L704–714 |
| `utilizationOnly` *(relabel)* | Line Loading chart title/axis; "Worst Lines" row; "Busiest line" row; kVA→`\|P\|` wording | `GridPanel.tsx` ≈L673–677, L735–751, L600–607, L320–341; `PyPSALineLoadingChart.tsx` |
| `curtailment` *(optional gate)* | Renewable Curtailment chart | `GridPanel.tsx` ≈L686–701 |

**DONE (2026-09-30)** — as built:

- `src/config/resultCapabilities.ts` — `ResultSource`, `Capabilities`,
  `LEAST_CAPABLE`, `capabilitiesFrom(pypsaData)` (absent/partial block ⇒ least
  capable, never un-hide). `PyPSAModelResults` carries `source?` +
  `capabilities?`. + `resultCapabilities.test.ts` (3 cases).
- `components/ui/GatedSection.tsx` — `GatedSection` (met ⇒ children; unmet+prod ⇒
  null; unmet+local ⇒ in-place placeholder card naming the section), `GapNote`
  (compact tile placeholder), `SHOW_RESULT_GAPS = import.meta.env.DEV ||
  VITE_SHOW_RESULT_GAPS === 'true'`. Hook (`useTranslation`) runs before the
  early return so the rules of hooks hold.
- `GridPanel.tsx` takes a `capabilities` prop: Run Status card ⟶ `convergence`;
  Voltage Profile / Voltage Violations / Worst Buses / avg-voltage + voltage-span
  tiles ⟶ `voltage`; Power Flow / avg-power tile ⟶ `power`; Transformer Loading /
  "Most loaded transformer" / "Top transformer" ⟶ `transformers`; Line Loading + Losses ⟶
 `lineLoading`/`losses` (chart title/axis/tooltip relabelled to *utilization*
 via `utilizationOnly`); bottleneck rows gated. Curtailment kept ungated (O3).
- `NetworkTopology.tsx` — `voltageAvailable`/`powerAvailable` props; when voltage
  is absent, nodes get a neutral cluster-only style, the tooltip drops the
  voltage/power/status rows and the voltage threshold legend collapses to the
  gap note — no defaulted green "1.00 p.u.".
- `ModelResultsViewer.tsx` — computes `capabilitiesFrom(pypsaData)` and passes it
  to `GridPanel`; bus map markers now `rightPanelView === 'grid' &&
  capabilities.voltage` (the green-"1.00" default lie).
- i18n: `results.grid.notInResult` + `results.grid.transmissionUtilization` added
  to all 8 locales (narrow `patch`, purely additive).
- Verified: `npx tsc --noEmit -p tsconfig.app.json` → only the 8 pre-existing
  `building-configurator` errors (nothing in the touched files);
  `npx vitest run` → 3/3; eslint on touched files → 0 errors.

**Note:** the app has no component/DOM test infra (no jsdom, no
@testing-library/react, zero existing `*.test.tsx`), so the GatedSection
dev/prod render test is done by observation in the live run, not a unit test.

**Stays ungated:** bus/node list + count (`GridPanel.tsx` ≈L549–563), Network
Topology graph structure (≈L466–477), line list/utilization, line losses,
curtailment. Keep the **Grid tab** visible (`ModelResultsViewer.tsx:1069`,
`results.tabs.grid`) — utilization keeps it useful.

**Mandatory side-effects of gating (these currently *lie* when data is absent):**

| Location | Today | Required |
|---|---|---|
| Run Status badge (`GridPanel.tsx:487–495`) | `isFullyConverged` undefined → amber **"Needs Review"** | hidden with the card (`convergence`) |
| Voltage Violations (`:722–731`) | **"No voltage violations."** | section gated (`voltage`) |
| Map bus markers (`useModelResultsMap.ts:396–413`) | `avgVoltage` falls back to `1` → **green "1.00"** everywhere | markers not created (`voltage`) |

**Panel-level gate (unchanged):** `GridPanel.tsx:454–456` → `PanelEmptyState` when
`locations` is empty. Hence Phase 3 must populate `locations` or nothing renders.

**i18n:** add the placeholder string + the utilization relabels to all 8 locales
(`src/locales/{en,de,pl,fr,es,it,cs,nl}.json`, keys under `results.grid.*`).

---

## 6. Phase 5 — Tests & verification

- Go: `capabilities.For` truth table; handler test asserting the block for a
  `"meme"`-sourced model; ingest test asserting `source="meme"` + no
  voltage/power rows written; legacy path asserts `"legacy"`.
- Migration test: a model with `model_results` rows but no source → backfilled
  `legacy`; a result-less model → untouched.
- Frontend: a unit test over `GatedSection` (hidden in prod mode, placeholder in
  dev mode) and the "capabilities absent ⇒ least capable" default.
- Manual: run a meme model → Grid tab shows utilization + placeholders locally,
  and *no* voltage/convergence/transformer sections in a production build.

---

## 7. Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| O1 | Where is `source` persisted? | (A) inside `model.results` JSONB · (B) new `models.result_source` column | **RESOLVED (B)** 2026-09-30 — dedicated column, shared struct field added in the `infrastructure` submodule |
| O2 | Is the placeholder wording per-component, or one generic string? | per-section (uses the section's own title) · generic | per-section — the title already exists in every block |
| O3 | Ship `curtailment` gated or ungated? | gate it (staged) · leave ungated (it *is* derivable) | leave ungated; keep the capability key for the future |
