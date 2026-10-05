# PV Patch — supplying a precomputed profile for physics PV (and wind)

**Status:** DEFERRED — a normal run without PV works end-to-end (model 28,
`completed`, `result_source=meme`); models carrying a `pv_supply` tech fail the
whole dispatch. This doc records the cause and the intended fix so it is not
re-derived.

**Why deferred:** the fix is a mapping/translator change that needs a real
capacity-factor series, not a synthetic one. Until then, electricity runs
without PV are the supported path.

---

## Symptom (verified 2026-10-05, models 25/26/27)

Every model with a `pv_supply` tech is marked `failed` with, verbatim:

```
tech pv_supply_2: physics model "pv" requires a precomputed profile for target "pypsa"
(run the model externally and set performance.precomputed)
```

## Cause

1. The model's topology carries a `pv_supply` tech (the only physics tech in
   25/26/27).
2. The vendored T1K mapping emits, for `pv_supply`
   (`enerplanet/backend/internal/meme/mapping.json`, `performance.type` →
   `"physics"`, `performance.model` → `"pv"`, plus tilt/azimuth/loss params) —
   and **no `performance.precomputed`**.
3. MEME's target capability check rejects that:
   `dependencies/meme/internal/target/validate.go:182-185` — `FeatPhysicsPerformance`
   is native only where a target claims it (AdOpT). **PyPSA and Calliope do not
   claim it**, so a physics tech without `precomputed` is a hard error
   (`internal/model/model.go:444-448`).
4. The TentaCron target is hard-fixed to `pypsa,calliope`, and MEME fails a
   multi-target request **whole** when one framework rejects it → the dispatch
   422s → `HandleDispatchMeme` marks the model `failed`.

Model 22 (and 28) succeeded only because they carry **no** `pv_supply` tech.
The `elOnlyPayload()` unit fixture ships `"techs": null` for the same reason.

## The fix — let TentaCron resolve the profile (do NOT build one)

TentaCron has a PV resolvent; the profile does not have to come from us:

- `resolvent-pvgis` → PVGIS (JRC) public API (GET), configured in the
  orchestrator (`dependencies/TentaCron/environment/config.yaml`).
- Resolvents are resolved **in place** at the target's `timeseries_path`; for
  MEME that is **`model.timeseries`** (`.local/dependencies/TentaCron/TENTACRON.md`
  §4.2). Genuine `{"type":"time-series",…}` objects are left untouched.

So the emitted job should carry a resolvent series and point the tech at it:

```jsonc
"model": {
  "timeseries": {
    "pv_cf": { "type": "resolvent-pvgis",
               "location": { "lat": <node lat>, "lon": <node lon> },
               "capacity_kw": <p_nom / or 1 kW for a per-kW CF> }
  },
  "technologies": {
    "pv_supply_<n>": {
      "performance": { "type": "physics", "model": "pv", "precomputed": "pv_cf",
                       "params": { "tilt": …, "azimuth": …, "loss": … } }
    }
  }
}
```

Mapping work (T1K `enerplanet-to-meme` + the vendored copy):

- add a `model.timeseries.pv_cf` rule emitting the `resolvent-pvgis` object from
  the tech's node coordinates;
- add `performance.precomputed: "pv_cf"` to the `pv_supply` block
  (mapping.json ~L430-467).

**Wind is a separate case:** `resolvent-wind` is **retired** (no backend runs in
this stack) — `dependencies/TentaCron/environment/config.yaml` keeps only
`resolvent-pvgis`. A wind tech would need its own resolvent backend before it can
emit a precomputed CF, so keep `wind_onshore` out of scope until then.

**Synthetic profiles are off the table** — OpenTech-DB's embedded solar profile
is synthetic and must never ship; the resolvent fetches the real thing.

## Acceptance for the patch

- A CalculationPayload with a `pv_supply` tech translates to a job that passes
  `POST /validate?target=pypsa,calliope` against live MEME (HTTP 200) and
  simulates to `optimal`.
- The resolved `pv_cf` reaches MEME as a real series (TentaCron log shows the
  PVGIS fetch, not a passthrough placeholder).
- A `pv_supply` model completes dispatch → ingest, `result_source=meme`, with PV
  capacity/dispatch present in the result.
- The `pv_cf` resolvent adds no unknown MEME field (the payload still decodes
  under MEME's `DisallowUnknownFields`).
