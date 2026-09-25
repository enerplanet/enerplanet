# Go-Meme-Parser — Package Specification

A dedicated Go package that retrieves and parses MEME run results and returns
them as typed, aggregated data. MEME supports **Calliope**, **AdOpT-NET0** and
**PyPSA**; all three are handled. Primary targets for this project are **Calliope
and PyPSA**; AdOpT-NET0 is included for future use.

---

## 1. Purpose

Extract usable results from MEME's remote jobs. Input: a MEME server URL, an
`api_key`, an engine **target**, and a canonical payload. Output: a typed result
contract (capacities, dispatch, generation, costs, timeseries) plus derived
metrics (totals, renewable share, LCOE) and CSV export.

Non-goals:

- **No payload building.** Translating an internal model → MEME canonical JSON
  is the caller's job. `client` ships whatever body it's given.
- **No ZIP parsing.** The bundle may be downloaded as a file, but its internals
  are never parsed. JSON is the contract; the zip is a debugging artifact.

---

## 2. Prerequisites

What must hold before building this package. Each item is either a decision,
an environment fact, or an input the package needs to be correct.

### Decisions (required before scaffolding)

| # | Prerequisite | Status | Notes |
|---|--------------|--------|-------|
| P1 | **Go module path** | required | Repo currently has no `go.mod` yet. The directory is `go-meme-parser`; choose `go-meme-parser` or a `github.com/<org>/go-meme-parser` path. First line of `go.mod`. |
| P2 | **Go toolchain** | confirmed | System has `go 1.26.6`. Set `go` directive to a floor the team is on (>= 1.24). |
| P3 | **Zero external deps for the pure core** | decision | `sanitize`, `contract`, `report`, `payload` should be stdlib-only. Keep the dep surface to just `client` (net/http) so the parsing core stays trivially portable and vendorable. |

### Inputs needed for correctness

| # | Prerequisite | Status | Notes |
|---|--------------|--------|-------|
| P4 | **MEME canonical schema** (`revised_unified_schema.json`) | needed | `payload.Validate` (the §6 check list) must be accurate against the real MEME schema, not only TEMPO's subset. Vendor the schema file or link it for tests. |
| P5 | **Real sample result contract** | `[BLOCKED]` | The `contract` struct + key-parsing rules are currently inferred from *TEMPO*'s `memeClient.js`, not verified against a live MEME `result.json`. A single genuine Calliope result.json would lock the struct shape. |
| P6 | **Wire protocol confirmation** | `[BLOCKED]` | Poll fields, `result.json` keying, and the target-keyed contract unwrap are *assumed*. Confirm against a running MEME server (or TentaCron-delegated endpoint) before relying on `client`. |
| P7 | **`api_key` source** | required | Must come from config/env secrets, never hard-coded or committed. It is a top-level JSON body field (§6 client), so it is not a header the transport can inject from env silently. |

### Development prerequisites

- The parser is built against MEME's own behavior, **not** TEMPO's UI or
  EnerPlanET's backend. TEMPO and EnerPlanET are sources of truth for the data
  model, but MEME is the authority on the wire protocol and contract shape.
- Unit + mocked transport tests must run headless with no live server and no
  network access (P5/P6 are integration concerns, not unit concerns).
- Keep the package agnostic of EnerPlanET's model representation — that linkage
  belongs to the translator (`ENERPLANET_TRANSLATOR.md`) and the integration
  requirements (`INTEGRATION_REQUIREMENTS.md`), not the parser.

---

## 3. Layout

One Go module, four packages, acyclic dependencies:

```
go-meme-parser/
├── sanitize.go        // root helper: Calliope _safe_id().lower() naming (share-safe)
├── client/
│   └── client.go      // HTTP transport only
├── payload/
│   ├── payload.go     // canonical payload builder helpers + validation (no knowledge of your model)
│   └── validate.go    // pre-submit validation → issues list
├── contract/
│   ├── contract.go    // typed result structs + key parsing
│   └── adopt.go       // AdOpT-NET0 name-remap normalizer (adaptor, opt-in)
└── report/
    └── report.go      // pure derivation: aggregate, KPIs, CSV
```

Dependency direction: `report → contract`; `payload → (root) sanitize`;
`client → nothing`. No cycles. `client` is the only package touching the
network; `contract`, `report` and `payload` are pure and unit-testable without a
live server.

> **On payload building:** the package does *not* take your model and produce a
> MEME body — your model representation is yours. What `payload` provides
> instead is (a) helpers to assemble a valid body from parts you already have,
> and (b) a validator that checks a body against the canonical MEME schema and
> returns a clear list of issues *before* you hit the server. Same result, no
> coupling to your model shape.

---

## 4. Targets & integration matrix

`Target` is the single integration switch. It propagates from submit, through
result retrieval, to the normalizer that runs on the fetched contract.

```go
type Target string   // "pypsa" | "calliope" | "adopt-net0"
```

The caller chooses a target; the package keeps every target's behavior behind a
single, documented decision point so nothing sneaks in engine-specific logic.

| Aspect | Calliope | AdOpT-NET0 | PyPSA |
|--------|----------|------------|-------|
| MEME target value | `calliope` | `adopt-net0` | `pypsa` |
| Result keys | 3-part `loc::tech:carrier` | DB-native names (`Storage_Battery`) | 2-part `loc::tech` |
| Name normalization | `Sanitize` + lowercase (strict, superset) | DB → internal remap | `Sanitize` only |
| Timestamps | ISO strings | integers → re-derived from start+res | ISO strings |
| Extra metadata needed | — | **model definition** (reverse name map) | — |
| Generation/costs in result | present | absent → inferred | present |
| Trade imports in result | present | absent → synthesized = demand | present |
| Parsing path | `Contract.Parse` | `Contract.Parse` **+** `NormalizeAdopt` | `Contract.Parse` |

Key takeaways for integration:

- **Calliope is the superset** for key/naming parsing: its 3-part lowercase keys
  and `:dest` transmission rule offer full coverage; PyPSA's simpler 2-part keys
  fold into the same path. **Calliope and PyPSA are the near-term targets** and
  flow through the same, single parsing path.
- **AdOpT is the only divergence** — a **future** engine — and it needs extra
  input *and* extra steps: it requires the model definition
  (`NormalizeAdopt(contract, modelDef)`) because its raw result uses database
  tech names with no generation/costs/imports to infer. It is gated behind its
  own function so it never runs on the plain path and can be added later
  without touching Calliope/PyPSA.

---

## 5. `payload` — build helpers & pre-submit verification

The package does not build your payload from your model, but it gives you the
tools to assemble and *verify* one. All of this lives **before** `client.Submit`
— it never touches the network.

### Validation

```go
// Validate checks a canonical MEME body ({model, experiment}) against the
// schema and returns a list of issues. Severity lets callers distinguish
// blockers (would fail the run) from warnings (would be dropped/mis-mapped).
type Issue struct {
    Severity Severity     // Blocking | Warning
    Path     string       // e.g. "model.time.subset"
    Message  string       // human-readable, actionable
}

func Validate(payload map[string]any) []Issue
```

Checks performed:

- **Structure:** `model` and `experiment` present; `model` has the required
  top-level blocks (`metadata`, `time`, `carriers`, `nodes`, `technologies`).
- **Time:** `time.start`/`time.end` valid dates; `resolution` parseable
  (`1H`, `3H`, …); `time.subset` bounds fall within `start`–`end`.
- **Techs:** each `technologies` entry has `role` (supply|demand|storage|
  conversion), a `node`/`node_overrides` placement, and matching carriers where
  required (demand carrier_in, supply carrier_out).
- **Cross-refs:** every tech/transmission `node` reference exists in `nodes`;
  every `from`/`to` in `transmission` exists in `nodes`.
- **Naming:** ids pass `Sanitize` (no leading digit, no illegal chars) so the
  model is accepted by the strictest target (Calliope).
- **Experiment:** `mode` in the allowed set; `solver.name` non-empty.
- **Engine-specific:** for `adopt-net0`, `allow_unmet_demand.enabled` must not
  require a penalty price TEMPO can't express (flagged as a warning).

The goal is that `Validate` catches, client-side, the errors MEME would
otherwise return as a 422 — with the path and a fix hint, not a terse HTTP
message.

### Build helpers

Lightweight, model-agnostic helpers to cut boilerplate and reduce drift between
the payload and the parser's expectations:

```go
// Helper wrappers that mirror the package's own expectations, so builder and
// parser agree. These DO NOT know your model — they just shape the canonical
// body.
func NewTime(start, end time.Time, resolution string) map[string]any
func NewTech(role Role, node any, carriers Carriers) map[string]any
func NewCarriers(ids ...string) map[string]any
func NewTransmission(from, to, carrier string, opts ...CapOption) map[string]any
```

Every one of these produces output that `payload.Validate` and
`contract.Parse` already understand. The value: a user assembling a body by
hand — or porting from a config — gets immediate typo/schema feedback from
`Validate` instead of debugging a remote 422.

> **Scope guard:** these are *shaping* helpers (produce canonical-shaped maps),
> not a model builder. If you need a full internal-model → payload translator,
> that remains your code; `payload` only makes the canonical side safer and
> more legible.

---

## 6. `client` — transport

Thin, stateless HTTP driver. No parsing, no payload knowledge, **target-agnostic**.

### Types

```go
type Client struct {
    BaseURL    string
    APIKey     string        // sent in JSON body, NOT a header
    PollEvery  time.Duration // default 1500ms
    Timeout    time.Duration // per-request; result.json may be slow
}

type Job struct {
    ID       string
    Target   Target
}
```

### Methods

```go
// Submit a canonical payload; returns job with ID. Delivery waits for the
// synchronous validation (401/auth / 422/payload rejections surface as errors).
func (c *Client) Submit(ctx, target Target, payload map[string]any) (*Job, error)

// Poll until succeeded or failed. Returns terminal status.
func (c *Client) Wait(ctx, job Job, onLog func(line string)) (*Status, error)

// Fetch the frozen result contract (runs[].contract → status.contract →
// GET /jobs/{id}/result.json fallback).
func (c *Client) Result(ctx, job Job, status *Status) (*contract.Contract, error)

// Download the raw zip bundle to a file (optional, for debugging).
func (c *Client) Bundle(ctx, job Job, dest string) error
```

### Wire protocol (from TEMPO's memeClient.js — see P6, unverified)

```
POST /simulate?target=<t>      → 202 { id, state, warnings }
GET  /jobs/{id}/status         → { state, log, error, ... }
GET  /jobs/{id}/result.json    → frozen contract JSON
GET  /jobs/{id}                → zip bundle
```

Rules:

- `api_key` is a **top-level JSON body field**, never an HTTP header.
- Contract resolution order: `status.runs[].contract` (first run with one) →
  `status.contract` → `GET /jobs/{id}/result.json`.
- If the contract is keyed by target (multi-target extension, no `capacities`
  field), unwrap `status.target` (**P6 — assumed, not verified**).
- `Wait` polls every `PollEvery`, streams log deltas, gives up after a bounded
  number of consecutive status failures.
- No server-side cancel endpoint; context cancellation stops client-side polling.

---

## 7. `contract` — the frozen result contract

Typed representation of the parsed result. Parsing is **target-aware but unified**
— one path handles Calliope (superset) + PyPSA; AdOpT layers a normalizer on top.

### Types

```go
type Contract struct {
    Objective           float64
    Termination         string            // "optimal", "infeasible", ...
    Capacities          map[string]float64 // "loc::tech" → MW
    Generation          map[string]float64 // "loc::tech" → MWh
    CostsByTech         map[string]float64
    CostsByLocation     map[string]map[string]float64 // loc → {tech: cost}
    DemandByLocation    map[string]float64
    UnmetByLocation     map[string]float64
    TotalUnmetMWh       float64
    ImportsByLocation   map[string]float64
    Timestamps          []time.Time
    Dispatch            map[string][]float64 // tech → aligned to Timestamps
    DemandTimeseries    []float64
    TransmissionFlow    map[string]TransmissionLine // "A::B" → line
    TechMetadata        map[string]TechMeta         // authoritative classification
    TechParents         map[string]string           // legacy fallback
    ShadowPrices        map[string]any
    SporesData          []any
}

type TransmissionLine struct {
    From, To   string
    Timeseries []float64
}

type TechMeta struct {
    Parent      string // supply | supply_plus | storage | conversion | ...
    CarrierOut  string
    DisplayName string
}
```

### Parsing functions

```go
// Parse decodes a MEME result.json / contract body into typed form.
// Handles Calliope (3-part) and PyPSA (2-part) keying in one path.
func Parse(data []byte) (*Contract, error)

// NormalizeAdopt rebuilds a canonical contract from AdOpT's HDF5-extracted
// data, which uses DB-native tech names and lacks generation/costs/imports.
// Requires the model definition (reverse map). Opt-in; runs AFTER Parse.
// Reserved for when AdOpT-NET0 support lands — not exercised in the near term.
func NormalizeAdopt(c *Contract, modelDef any) (*Contract, error)
```

### Key parsing rules (owned by `contract`)

- Split keys on `"::"` → `{loc, tech, carrier?}`. Calliope emits
  `loc::tech:carrier`; PyPSA `loc::tech`.
- A second `":"` inside the tech segment (e.g. `pFV:CHERCAN`) means
  **transmission** — the tech carries a `:dest` suffix.
- Calliope names are normalized: `_safe_id().lower()`. Result keys will NOT
  match raw model input names unless this transform is applied. Prefer the
  shared root `Sanitize` helper.
- Carrier suffix is stripped from the tech name; `loc` and `tech` are the
  operative dimensions.
- Timestamps may be ISO strings (Calliope/PyPSA) or integers (AdOpT) to be
  re-derived from start + resolution. Normalize to `time.Time`.
- All maps tolerate absent keys (empty → zero value).

See §9 for the shared naming rule that keeps build and parse sides in agreement.

---

## 8. `report` — derived results

Pure derivation, imported by callers who want summary numbers, not raw maps.
**Engine-agnostic** — it cannot see Calliope/PyPSA/AdOpT.

### Types

```go
type Summary struct {
    ByTech             map[string]float64 // technical totals (strip transmission, skip ≤0)
    ByLocation         map[string]float64
    TotalCapacityMW    float64
    TotalGenerationMWh float64
    TotalCost          float64
    RenewableShare     float64 // renGen / totalGen
    LCOE               float64 // totalCost / totalGen
}
```

### Functions

```go
func Aggregate(c *contract.Contract) *Summary
func RenewableShare(c *contract.Contract) float64
func LCOE(c *contract.Contract) float64
func WriteCSV(w io.Writer, c *contract.Contract, kind CSVKind) error
```

Rules (mirror TEMPO `resultExports.js`):

- Skip `≤0` capacity/generation values when summing.
- Strip transmission atoms (tech containing `:`) from per-tech totals.
- Renewable detection = substring match on tech name
  (solar, wind, hydro, biomass, biogas, geo, geothermal, pv, csp, tidal, wave).
- Renewable share / LCOE are computed from **aggregated** totals, not per-key.
- `WriteCSV` supports: capacities, generation, costs_by_tech, costs_by_location,
  demand_unmet_by_location, dispatch (timestamp × tech), summary_kpis.
- `report` can never branch on target — it consumes the normalized contract.

---

## 9. Root `sanitize.go` — shared naming

Calliope's `_safe_id().lower()`, exposed once so the **caller's payload builder**
and **`contract`'s key parser** agree on the same rule.

```go
// Sanitize normalizes a name for MEME/Calliope: strip :: → __ and : → _,
// collapse runs of non-word chars to _, drop leading/trailing _, prepend "n_"
// to a leading digit, lowercase. Matches Calliope's _safe_id().lower().
func Sanitize(name string) string
```

The single most important Calliope consistency point: build side and parse side
must use the same transform or keys never match.

---

## 10. Error handling & validation

- JSON parse failures and schema drift → typed `contract.ParseError` so callers
  can distinguish "malformed result" from other errors.
- Missing required fields (`capacities` absent AND no other result key) → error;
  a valid empty result is fine, a partial/empty object is suspicious.
- Network/timeouts → wrapping `error` from `client`.
- No silent numeric forgive-and-set-default; expose malformed values via an
  `errors` collection on `Contract` where reasonable.
- AdOpT without a model definition → clear error from `NormalizeAdopt` ("AdOpT
  results require the model definition; see §4 matrix").
- `payload.Validate` issues are **not** errors — they are a report the caller
  inspects before submit. Surface as `[]Issue`, never a thrown error.

---

## 11. Verification strategy

- **Unit (contract/report):** feed fixtures for the near-term targets — Calliope
  3-part keys and PyPSA 2-part — and assert typed output. Add AdOpT DB-name
  fixtures when AdOpT is brought in. Use the minimal contract from TEMPO's test
  — `{"capacities":{"n::solar":80}}` must parse clean.
- **Unit (sanitize):** assert the documented transforms fold to identical
  strings on both directions.
- **Unit (payload):** `Validate` must flag every schema violation in the §5
  check list, distinguish Blocking from Warning, and return clean (no issues)
  for a valid canonical body. Assert each build helper's output passes
  `Validate` — this is the drift guard between builder and parser.
- **Integration (client):** mocked HTTP transport (no live server needed) for
  poll order, contract resolution fallback, and api_key-in-body.
- **Live (blocked — P5/P6):** MEME passthrough is not verified end-to-end yet,
  so the wire protocol (poll fields, result.json keying, target-keyed unwrap) is
  inferred from TEMPO's `memeClient.js` and marked as such in the client code.
  Validate against a running MEME server once available.

---

## 12. Integration flow (canonical path)

The end-to-end walkthrough a user follows. Target choice drives where the
package branches; everything else is uniform.

```
 1. Pick target          Calliope | pypsa (| adopt-net0, future)
 2. Assemble + verify    CALLER assembles the body; call payload.Validate(body)
                        → fix Blocking issues, review Warnings before submitting
 3. Submit               client.Submit(ctx, target, body)  → job
 4. Wait                 client.Wait(ctx, job, onLog)      → status
 5. Fetch + parse        client.Result(ctx, job, status)   → *Contract
    AdOpT only:          contract.NormalizeAdopt(contract, modelDef)
 6. Derive metrics       report.Aggregate(contract)        → *Summary
 7. Export               report.WriteCSV(w, contract, kind) → CSV
```

Step 2 is the pre-submit safety net: the payload is still caller-assembled, but
`payload.Validate` and the build helpers make assembling and checking it a
package-supported, iterable step rather than a guess-then-422.

Where the target matters: **only** in step 1 (payload shape is caller-owned; the
target string rides along in the job) and step 5 (AdOpT requires the extra
`NormalizeAdopt` step and the model definition). Calliope and PyPSA flow through
steps 3–7 identically.

### Caller-owned vs. package-owned

| Concern | Owner |
|---------|-------|
| Model → canonical payload | **caller** |
| Payload schema checks | **package** (`payload.Validate`) |
| Payload build helpers | **package** (`payload`), optional |
| Target selection | **caller** (package stays target-agnostic in `client`) |
| Name normalization (build side) | **caller**, via root `Sanitize` |
| Name normalization (parse side) | **package** (`contract`) |
| HTTP transport / polling | **package** (`client`) |
| Contract parse | **package** (`contract.Parse`) |
| AdOpT normalization | **package** (`contract.NormalizeAdopt`, opt-in) |
| Derived metrics / CSV | **package** (`report`) |

This split is the whole integration contract: keep payload *building* out of the
package (your model is yours), but let the package own payload *verification* and
shaping — so assembling a body is safe and iterable, and the package stays
reusable across target and model-representation changes.
