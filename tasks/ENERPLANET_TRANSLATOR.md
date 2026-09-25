# Go-Meme-Parser — EnerPlanET Config → MEME JSON Translator

A second Go package that runs **on top of** the `go-meme-parser` package
(`spec.md`). Its single job is translation: take an EnerPlanET model/config and
produce the MEME canonical JSON body (`{model, experiment}`) that the
`go-meme-parser` `client` then submits. It is the "caller-owned payload builder"
that `spec.md` deliberately kept out of the parser — packaged here as a small,
testable translator.

Nothing in this package talks to the network and nothing parses results. It is
the boundary where EnerPlanET's model representation becomes MEME's.

---

## 1. Relationship to the two other packages

```
EnerPlanET config ──► enerplanet-to-meme (THIS package)
                         │  builds {model, experiment} canonical body
                         ▼
                 go-meme-parser
                 ├── payload.Validate   → catch issues before submit
                 ├── client.Submit      → POST /simulate?target=…
                 ├── client.Wait/Result → poll + fetch contract
                 └── report             → derived metrics
```

Division of responsibility:

| Concern | Owner |
|---------|-------|
| Read EnerPlanET config/model | **this package** |
| Map EnerPlanET entities → MEME canonical body | **this package** |
| Shape canonical body validation | `go-meme-parser`/`payload` |
| Transport, polling, result fetch | `go-meme-parser`/`client` |
| Result parsing + aggregation | `go-meme-parser`/`contract` + `report` |

This package depends on `go-meme-parser` (for `payload.Validate` and to type the
output it produces). `go-meme-parser` does **not** depend on this package.

> **Relation to `internal/meme` (enerplanet/backend):** the EnerPlanET Go backend
> already contains a translator in `internal/meme/translate.go` (types in
> `internal/meme/job.go`) that emits a MEME `Job`. This spec describes that
> translator extracted/formalized as a standalone package that produces the same
> canonical body *and* validates it through `go-meme-parser`. Migration path:
> adopt the types/aggregation from `internal/meme` wholesale rather than
> rewriting the mapping.

---

## 2. Source shape: what EnerPlanET supplies

Ground truth from `internal/payload/payload.go` (`CalculationPayload`) and
`internal/meme/job.go`:

- A `models.Model` carries `Config` (JSONB) with keys such as `energyVectors`,
  plus derived fields (dates, resolution, country, region).
- Demand series arrive as per-building BuEM loads (`BuildingSeries`, kW per
  step): heating, hot water, electricity, kitchen — with a
  `KitchenElectric` flag.
- Nodes are transformer areas (with lat/lon + an import limit / transformer
  rating); buildings without an area land on the synthetic `unassigned` node.
- `energyVectors` gates which carriers are modelled: `electricity`, `heat`.

The translator's input contract must not assume a particular DB model — it
takes plain in-memory structs so it can be unit-tested without a database:

```go
// Mirror of enerplanet/backend internal/meme (BuildingSeries, NodeSeries,
// NodeInput) — reuse those exact types where possible.
type Input struct {
    Name        string
    Start, End  time.Time
    StepMinutes int
    Nodes       []NodeInput
    Series      []NodeSeries
    EnergyVectors []string
}
```

---

## 3. Translation rules

Reuse the aggregation and mapping already proven in
`internal/meme/translate.go`:

### Aggregation (`Aggregate`)
- Sum per-building series into one series per node per carrier, kW → MW.
- Electricity = electricity load + kitchen load **when `KitchenElectric`**.
- Heat = space heating + hot water.
- Building without a node → `unassigned` node.
- Sum over common prefix (shortest length wins); never invent demand.

### Model emission (`Translate`)
- One node per transformer area (+ `unassigned` when a series names it).
- One **demand** technology per node per carrier, reading an **inline** series
  (`demand_<node>_<carrier>`, `source: "inline"`, `unit: "MW"`).
- One **heat pump** per node with heat demand: `conversion` role,
  electricity→heat, fixed capacity = peak heat / COP (see constants below),
  `expandable: false`.
- One **electricity import** per node (`trade` entry, `import.limit` from the
  transformer rating / import limit; nil = unlimited).
- Time window: `time.start`/`time.end` (UTC RFC3339), `resolution` as pandas
  frequency (`1H`, `15min`) from `StepMinutes`.
- Carriers block declares `electricity` and `heat` (only heat when
  `energyVectors` gates it out).
- Experiment: `mode: "operate"`, `objective: "min_cost"`, solver `highs`,
  operate window/horizon.

### Constants (keep as documented policy values)
```go
const (
    heatPumpCOP      = 3.0
    solverName       = "highs"
    operateWindow    = "24h"
    UnassignedNode   = "unassigned"
)
```

### Series handling
- Slice series to the time window; **pad short series with their last value**
  (MEME sizes the calendar from the longest series and never truncates).
- Reject unsupported carriers.
- `unassigned` node is allowed without an explicit `NodeInput`; any other
  unknown node reference is an error.

---

## 4. Output

The output is — by design — the exact shape `go-meme-parser` consumes:

```go
type Translation struct {
    Body     map[string]any   // {model, experiment} — ready for payload.Validate + client.Submit
    Warnings []string         // e.g. series truncation IDs, unassigned buildings
    Target   meme.Target      // "calliope" | "pypsa" (adopt-net0 future)
}

func Translate(in Input, target meme.Target) (Translation, error)
```

`Body` is produced as the parsed canonical JSON (the structs from
`internal/meme/job.go`), then `json.Marshal`-able to exactly what
`client.Submit` expects. `Target` is set by the caller (see integration doc:
**PyPSA must be routed through MEME**; default is `calliope`).

### Target-specific emission
- **Calliope (primary):** 3-part canonical keys; emit as `internal/meme/job.go`
  already does.
- **PyPSA:** also supported by the same canonical body (the unified schema is
  target-agnostic); the `client` just uses `?target=pypsa`.
- **adopt-net0 (future):** current translator makes no adopt-specific emission —
  do not add any until that engine is actually wired; keep this package emitting
  the shared canonical form.

---

## 5. Verification (built-in, cheap)

```go
func (t Translation) Validate() []payload.Issue {
    return payload.Validate(t.Body)
}
```

Every `Translate` output should pass `go-meme-parser/payload.Validate` with zero
Blocking issues. This is the contract between this package and the parser — if
the two drift (new field not understood, naming mismatch), validation catches it
immediately, client-side, instead of a remote 422.

Suggested test fixtures mirror `internal/meme`'s existing tests plus the core
guards from `translate.go`:
- valid single-node, single-carrier (electricity) model → clean body.
- two-carrier (electricity + heat) with heat pumps.
- building without node → `unassigned` series + warning.
- short series → padded to window + warning.
- bad step (`StepMinutes <= 0`) and `End <= Start` → errors.
- every output body passes `payload.Validate`.

---

## 6. Non-goals

- **No network, no parsing of results, no `go-meme-parser/client` calls** — this
  package only translates. The caller wires the `client`.
- **No model persistence / DB reads** — accept `Input` structs.
- **No PyPSA-specific model building beyond the shared canonical body.** If
  PyPSA needs engine-specific techs later, that lands by extending the shared
  emission, not a parallel translator.
- **No adopt-net0 work** until that engine is actually integrated.

---

## 7. Out-of-scope flow (for reference, owned by the caller)

The translator feeds, but does not perform, this path:

```
EnerPlanET config → THIS Translate() → Body
    → go-meme-parser/payload.Validate(Body)   (fix Blocking, review Warnings)
    → go-meme-parser/client.Submit(ctx, target, Body)   [MUST go via TentaCron]
    → client.Wait / Result → client.Bundle (zip, for user download)
    → contract.Parse (+ NormalizeAdopt for future adopt) → report.Aggregate → DB
```
