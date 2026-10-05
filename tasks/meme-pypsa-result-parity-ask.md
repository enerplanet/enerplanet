# MEME PyPSA → EnerPlanET: short ask

**From:** EnerPlanET backend (THD) · **Date:** 2026-09-30
**MEME:** `main` @ `eff4d62`, PyPSA 1.2.4
*(full detail + evidence: `tasks/meme-pypsa-result-parity.md`)*

## Context

We're migrating our legacy PyPSA webservice onto MEME (dispatched via TentaCron),
and read results through your Coati tool: `backend → MEME ?target=pypsa,calliope →
zip → Coati → store → REST API → UI`.

## What we can't get

Our UI shows a Grid panel per wire: flow, rating, **line loading %**, bus voltage,
and a "power flow converged" badge. From MEME we only get **active flow +
transport capacity** per arc (`links_t_p0`, `links_p_nom_opt`) — no
`loading_percent`, no voltage/reactive, no convergence verdict.

We understand why, and it looks deliberate rather than a bug — your source says it:

> `power_flow (Lines/Transformers, KVL) is NOT claimed: no canonical field emits a
> lines.csv — all transmission becomes transport Links. Reclaim once the schema
> carries electrical parameters (r, x, s_nom).` — `internal/target/pypsa/pypsa.go:37-39`

So the arc is a transport `Link`, the driver calls `solve_model()` and never
`network.pf()`, and the electrical series was simply never produced. Nothing we
can reconstruct downstream from a dispatch LP.

## Quick ask — in order of cost

1. **Cheap, useful now:** mark each emitted link's origin (e.g. a
   `source: transmission | conversion` column on `links.csv`), so consumers can
   tell a wire from a conversion link without heuristics. Optionally a small
   `wire_summary.json` (per transmission id: `from`, `to`, capacity, peak/sum flow).
2. **Main ask:** is reclaiming the electrical result (real `Line` + `network.pf()`,
   per your own note) on the roadmap? We'd rather follow your design than work
   around it — and we can carry `r`/`x` via `native.pypsa` today (they already land
   on the link row as `links_r`/`links_x`), so `s_nom`/`v_nom` would make `Line`
   emission possible without a canonical schema change.
3. If yes, we'd coordinate the Coati side with you: Coati already reads
   `lines`/`transformers` and `s_nom`, but its document has no
   voltage/loading/convergence field (`schema_version` is pinned `1.0`).

## Three things only you can decide

1. **Slack bus** — who designates it, and how is it expressed in the canonical
   model? (No `control` column is emitted today; the fixture only reads `Slack`
   because that's PyPSA's default.)
2. **Electrical parameters** — per-line `r`/`x`/`s_nom`, or is a levelised
   per-voltage-level rating acceptable? We currently have one LV and one MV cable
   type per model, not per-line impedance.
3. **Non-convergence semantics** — should a failed `network.pf()` fail the job, or
   annotate the bundle and still return the dispatch result?

Happy to prototype S2 (native-carried params + `Line` + `pf()`) and send a patch
if that's the direction you'd want.

Thanks!
