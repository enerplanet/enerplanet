# Isolated PyPSA run — plan

**Status:** active · **Owner:** EnerPlanET backend (Phase 4: frontend)
**Goal:** after a Calliope run, enrich the model with a **second, isolated PyPSA
power-flow run** whose request is built from the **parsed Calliope results**, and
parse it into the electrical result layer.

**Relates to:** `pypsa-pass-ask.md` (this folder) — the **sendable ask**, the one doc
kept separate (it must not carry this plan's handoff/environment state; the legacy
reference it used to live beside is now **Appendix A** here) ·
`tasks/closed/grid-result-capabilities-plan.md` (capabilities/provenance — its
Phase 3 *is* this ingest) · `tasks/closed/meme-result-timeseries-mapping.md`
(Coati → R2 mapping) · `tasks/closed/meme-integration-plan.md` (the umbrella).

**Code this plan touches:** `enerplanet/backend/internal/meme/{mapping.json, t1k.go}` ·
`internal/jobs/{dispatch_meme.go, ingest_meme_result.go}` ·
`internal/result/service/{coati_ingest.go, coati_wire.go, meme_timeseries.go, cable_ratings.go}` ·
`internal/result/capabilities/capabilities.go` · `internal/result/handler/result_helpers_pypsa_files.go`
(the legacy PF reader we intend to reuse) · `internal/store/memerun/store.go`.

Method: **manual tests first** (discover the payload), **then** the parsing, **then**
integrate into the flow — only once both modules work.

---

## Where we are — handoff notes (read this first)

**Written:** 2026-10-06, at the end of the session that produced Rounds 1–4 of the
MEME result mapping. **Nothing in this plan is implemented yet** — it is a plan.

**Branch / tree**
- `feature/meme-integration`, HEAD `49fbfd8`. **HEAD and `4d2518a` are git *stash*
  objects that a rebase replayed as ordinary commits**: the branch had been moved
  onto a stash commit (`80e3592`, same message — still preserved as
  `backup/meme-pre-rebase`), and the rebase `tmp/rebase-meme-onto-heat` (onto
  `feature/heat-integration`) replayed it *plus its index commit* (`4d2518a`, which
  still names `58699da` — the HEAD when the stash was created). Content is correct
  (the docs); only the messages are git's stash boilerplate. **Do not rewrite them
  without asking.**
- **The branch now sits on `feature/heat-integration`** (`git merge-base
  --is-ancestor feature/heat-integration HEAD` → true) — that was the rebase's
  intent (`…-meme-onto-heat`), but it means the diff vs `main` includes heat's
  history. `main` is `[behind 3]`.
- This session's code is **committed** in `25fdbc0` (*"feat: implement power scaling
  and connection visualization"*): the real cable ratings (`cable_ratings.go`), the
  MW→kW boundary (`units.go`), the honest capabilities, and the frontend map
  connection layer + amber dev placeholders. The docs are in `49fbfd8`.
- Working tree right now: only the two submodule pointers (`infrastructure`,
  `platform-core`) are dirty, plus **2 untracked docs** — `pypsa-pass-ask.md` and
  this plan. Nothing staged.
- `tasks/` is **tracked** (these will be committed); diagrams and the manual-test
  scratch belong in `.local/` (gitignored).

**What is already done (context this plan builds on)**
- The result mapping (Rounds 1–4) is implemented and verified live on models 28/30:
  real cable ratings from the model config, real utilisation (0.83–3.53 %), MW→kW,
  `losses`/`curtailment` correctly false, red-marked connections on the map and in
  the topology.
- The reference evidence for this plan is **Appendix A** below (the legacy c2p
  conversion + the developer's guidance), with the open questions in **§12**; the
  sendable ask is `pypsa-pass-ask.md` — **prepared but not yet sent to the
  developer**.

**Where we stopped**
- Awaiting a go-ahead on either of: **(a)** Phase 1 step 3 — read MEME's pypsa target
  and answer **B1** (*can the schema express `lines` at all?*); no services needed;
  **(b)** bring the MEME + TentaCron containers back up, which unblocks the actual
  manual submit.
- The single open decision that gates everything: **B1**.

**Environment state at handoff**
- **Up:** backend `:8000` (pid 142593), Vite `:3000` (pid 142696).
- **Down:** TentaCron `:8400` (nothing listening) and the containers
  `meme-env-api-1`, `tentacron-env-tentacron-1`, `city2tabula-server`,
  `buem-gateway`, `ignis-http-ignis-1` — all `Exited` with code 1/2 about 21 h ago.
- **Up:** `postgres`, `redis`, `timescaledb`, `keycloak`, `auth-service`,
  `weather-serve`, `pylovo-api-1`, and the **legacy stack** `webservice`,
  `s6et-webservice-1`, `sim-haproxy` (= c2p; usable for reference PF output).
- Values: TentaCron `http://localhost:8400` · key `dev-frontend-key` · DB `spatialai`
  on `:5433` · `COATI_BIN=submodules/Coati/.venv/bin/coati`.

**Parallel work to be aware of** — `.local/docs/` also holds files this session did
not create (`calliope-ccgt-pv-implementation.md`, `calliope-ccgt-requirements.md`,
`calliope-solar-pv-requirements.md`), alongside this session's 8 MEME diagrams and
`index.html` (built with the `flow-diagrams` skill).

**Read in this order:** this plan (why + what/when — **Appendix A** has the full
legacy evidence) → `pypsa-pass-ask.md` (the open questions to the dev) →
`tasks/closed/grid-result-capabilities-plan.md` (the capability/provenance contract)
→ `tasks/closed/meme-result-timeseries-mapping.md` (the mapping already built).

**Immediate next action:** start Phase 1 step 3 (answer B1) — it needs no services
and it is the gate for Phases 3–5.

---

## 0. End state (what "done" looks like)

- Calliope runs **in isolation**; its results stay the main result set (unchanged).
- A **separate** PyPSA request is built *from the parsed Calliope results* and
  dispatched on its own (`target=meme-pypsa`).
- Its output is parsed into **voltage · per-bus P/Q · transformer loading ·
  line loading (real rating) · losses · convergence**.
- The model's capability source becomes **`full-grid-pf`**; the Grid sections light
  up with **no frontend change** (locked: `grid-result-capabilities-plan.md` C4).
- If the PF leg yields nothing (non-convergence is a *normal* outcome) the model
  still completes; only the electrical sections stay gated off.

---

## 1. What we already know

| need | where it is |
|---|---|
| **Reference conversion** | `dependencies/simulation-engine/webservice.docker/servicehub/c2p/temp_c2p_pkg/c2p/` — `inputs/read.py`, `inputs/create.py`, `net.py`, `settings.py`, `export.py`, `pattern.py` (service entrypoint: `servicehub/c2p/main.py`) |
| **What a request must carry** | lines (`type`, `length`, `num_parallel`), trafos (`type`, `num_parallel`), buses (`v_nom`), generators `p_set` ← Calliope `carrier_prod`, loads `p_set` ← Calliope `carrier_con`, snaps/timesteps |
| **Type → electrical params** | the equipment catalogue — `dependencies/enerplanet-pylovo/raw_data/equipment_data.csv` (`max_i_a`, `r_mohm_per_km`, `x_mohm_per_km`; `s_max_kva` for transformers) |
| **TentaCron config to add** | `meme-calliope` (to isolate step 1). `meme-pypsa` already exists (`?target=pypsa`) |
| **End result shape** | already in our API: `voltage[] {v_mag_pu,v_ang,bus}`, `power[] {p,q,bus}`, `transformer_loading[]`, `line_ratings`, `convergence` |
| **How to submit by hand** | `POST {TENTACRON_SERVICE_URL}/v1/requests`, header `X-Api-Key`, body `{"target":"meme-pypsa","payload":<job>}` → `202 {id}`; then `GET /v1/requests/{id}?wait=…` |

Local values today: `TENTACRON_SERVICE_URL=http://localhost:8400`,
`TENTACRON_API_KEY=dev-frontend-key`.

---

## 2. The reference as a spec table

File references below are relative to
`dependencies/simulation-engine/webservice.docker/servicehub/c2p/temp_c2p_pkg/c2p/`.

| c2p step | reads | produces | our equivalent |
|---|---|---|---|
| `inputs/read.py:153-185` | Calliope **results** `carrier_prod` → generators, `carrier_con` → loads (+ `results.nc`) | time series `p_set`, timesteps/snaps | the Pass (§5.3a) |
| `inputs/create.py:82-98` | the model's pypsa settings: `line_type_lv/mv`, `trafo_mv_lv_type`, `*_num_parallel` | the **type** per line/trafo | Pass, from our config's `pypsa` block |
| `inputs/create.py:113-134,179-185` | topology (from/to, length, pipe) | `{bus0,bus1,length,pipe,type,num_parallel}` → PyPSA buses/lines/trafos with `v_nom` | Pass, from the payload topology |
| `net.py` `create_network_df` | those frames + `p_set` | the PyPSA network | MEME's pypsa emitter |
| `c2p.py:115-138` | — | `lpf()` + `pf()` + **convergence guard** (clears bad results) | MEME's pypsa target |
| `c2p.py:152-176`, `export.py` | the network | netCDF/HDF5/CSV **+ the web PF CSVs** (`buses-v_mag_pu`, `lines-p0/p1`, `transformers-*`) | what we parse (§4) |

Electrical params are never literal in the legacy path — they come from the **type**.
That is the shape MEME would need to accept too.

---

## 3. Phase 1 — manual payload discovery (reference-driven, offline)

**Precondition (must be true before step 1).** The MEME + TentaCron stack must be
**up**. As of this writing it is **not**:

| container | status |
|---|---|
| `tentacron-env-tentacron-1` | **Exited (2) 21 h ago** |
| `meme-env-api-1` | **Exited (2) 21 h ago** |

Both exited with code 2 — start them and confirm the `meme-pypsa` target is reachable
before anything else. (Also down, and needed only for *new* model runs' demand
resolution, not for this manual test: `city2tabula-server`, `buem-gateway`,
`ignis-http-ignis-1`.)

**Usefully already up:** the **legacy webservice stack** — `webservice`,
`s6et-webservice-1`, `sim-haproxy`, `pylovo-api-1` — i.e. the c2p service itself. That
lets us generate **reference PF output locally** for §4's regression check.

**Purpose:** find the correct `target=pypsa` payload **by hand**, without touching
our dispatch flow. This phase also answers the blocking question (B1) first.

1. **Fixture.** Start with a dev model that has a real config *and* Calliope results
   (model 30: 1 grid, 9 buildings, 73 hourly steps). Keep a legacy model (e.g. 13)
   in reserve for §4's regression check.
2. **Extract the inputs** to a scratch dir (`.local/tmp/pypsa-manual/`):
   - from the config: `lines[]` (`cable_type`, `length_km`, `grid_result_id`),
     `transformers[]` (`rated_power_kva`), the `pypsa` block (`line_type_lv`,
     `line_type_mv`, `trafo_mv_lv_type`, `*_num_parallel`);
   - from the Calliope leg: `results_carrier_prod.csv`, `results_carrier_con.csv`,
     and the snapshot list.
3. **Read what the schema can accept today.** Inspect MEME's pypsa target
   (`dependencies/meme/internal/target/pypsa/{pypsa.go,emitter.go,native.go}`) and
   its model package. Record, explicitly:
   - can a **`Line`** (with `type`/`r`/`x`/`s_nom`) be expressed at all, or only
     transport `Link`s? (MEME currently says power_flow is *not claimed* —
     `pypsa.go:37-39`.)
   - what is the **minimal field set** the emitter needs for a solvable network?
   **This is the gate: if lines cannot be expressed, Phase 3 waits on a MEME change
   and we escalate with the filled-in answer + the `pypsa-pass-ask.md` questions.**
4. **Hand-build the candidate job**: our current job shape + lines/trafos/buses +
   the `p_set` series (generators/loads).
5. **Submit it manually:**
   ```bash
   curl -sS -X POST "$TENTACRON_SERVICE_URL/v1/requests" \
     -H "X-Api-Key: $TENTACRON_API_KEY" -H 'Content-Type: application/json' \
     -d @.local/tmp/pypsa-manual/job.json        # {"target":"meme-pypsa","payload":{…}}
   # → 202 {"id": "..."}
   # then poll: GET /v1/requests/{id}?wait=30s
   ```
6. **Inspect the bundle**: did it emit `lines.csv`? did `pf()` run? is convergence
   reported? (unzip into `.local/tmp/pypsa-manual/out/` and list.)
7. **Iterate** on the body until MEME accepts it and produces PF artifacts.

**Deliverable:** a working job body + a written statement of the minimal field set
and the B1 answer.
**Acceptance:** ≥1 job body MEME accepts that produces a PF artifact set — *or* a
documented, evidence-backed "the schema cannot" that we take back to the dev.

---

## 4. Phase 2 — determine the correct parsing

1. **Coati over the PyPSA leg:** `coati convert <network.nc> - pypsa-v1-2-4`
   (constant already defined: `result/service/coati.go:53`). Inventory the unified
   document's fields against our API contract.
2. **Inspect the emitted CSVs** (`lines-p0/p1`, `buses-v_mag_pu`, `buses-p`, `q`,
   `transformers-p0/p1/q0/q1`, `convergence_stats.csv`) and compare with what
   `enerplanet/backend/internal/result/handler/result_helpers_pypsa_files.go`
   **already reads** (`convergence_stats.csv`, `transformers*.csv`, `lines.csv`,
   `csv_web/snapshots-t.csv`, `generators-p-t` / `generators-p_set-t` for curtailment).
3. **Decide per field: Coati doc vs raw CSV.** Prefer the CSV wherever MEME emits
   the legacy names — that reader is written and battle-tested.
4. **Regression gate:** run a *legacy* model's PyPSA output through the same parse
   path and compare against the legacy tables/API (voltage, power, transformer
   loading, line ratings, convergence). Same shape in ⇒ same shape out. If needed,
   generate fresh reference output with the already-running legacy stack
   (`webservice`, `s6et-webservice-1`) via c2p.

**Deliverable:** a mapping table (PyPSA output → R2 table / API key → Coati or CSV).
**Acceptance:** the mapped parse reproduces the legacy API shape for a legacy model,
and covers all six electrical outputs.

---

## 5. Phase 3 — backend module

**3a. The Pass** — `payload + parsed Calliope results → the PyPSA job body`.
Open design point: where it lives. T1K is declarative JSON→JSON; injecting a 73-step
series *from another document* is the awkward part, so likely: T1K maps the
topology/types, and a small Go step injects the `p_set` series. Decide here.

**3b. The dispatch** — `SubmitMeme(target="meme-pypsa")` as a **second, independent**
run with its **own run record** (leg-keyed or a separate table) so it can never fight
the main run's "resume by id, never resubmit" logic (`memerun.Store.Save` upserts on
`model_id` — a second dispatch would overwrite the first leg).

**3c. The ingest** — parse the PyPSA bundle → the electrical R2 tables; set the
capability source to `full-grid-pf`.

**3d. Trigger + staleness** — enqueue after the Calliope ingest; tie it to the
Calliope run id so a Calliope re-run **invalidates** the PF leg; allow an on-demand
re-run (it is derived and idempotent).

**Acceptance:** a real model gets the electrical layer; a PF failure leaves the model
*complete* with the sections gated off.

---

## 6. Phase 4 — frontend module

- The sections already exist and are **capability-gated** — they appear once the
  source is `full-grid-pf`. Verify each with real data: Voltage, Voltage Profile,
  Power Flow, Transformer, Loading, Losses, PyPSA Run Status, Renewable Curtailment.
- Add the two-leg **stage display** (status × stage, §7).
- Optionally the on-demand action ("compute the power flow for this result").

**Acceptance:** an enriched model shows all sections; a Calliope-only model hides
them exactly as today.

---

## 7. Phase 5 — flow integration (only after §5 and §6 work)

- Add **`meme-calliope`** to TentaCron's config and default the main run to
  **Calliope-only** (retire the bundled `pypsa,calliope` target for our dispatch —
  the bundled request is the incorrect implementation).
- Stages as **status × stage**, reusing the existing lifecycle enum
  (`draft · queue · running · processing · completed`) and adding
  `stage: simulate_calliope | parse_calliope | simulate_pypsa | parse_pypsa`.
  The MEME path starts using `processing` (today it jumps `running → completed`).
- The three traps:
  1. **"Done" = settled, not produced data** — non-convergence must still reach
     `completed`.
  2. **The enrichment is re-runnable** — the linear walk must not need new transitions.
  3. **Reconcile the `modified` drift** (2 models carry a status the enum and state
     machine do not define).

**Acceptance:** end-to-end on a fresh model; partial results behave; a re-run
invalidates the PF leg.

---

## 8. Phase 6 — verification & docs

- Regression: legacy models unchanged; previously-completing MEME models still complete.
- Update: this plan's boxes (and **§12** once the questions are answered) ·
  `grid-result-capabilities-plan.md` (its Phase 3 done) ·
  `meme-result-timeseries-mapping.md` (the PF supersedes the Round-3 wire-rating
  stopgap).

---

## 9. Risks & unknowns

- **B1 gates everything** — if the schema cannot express lines, Phase 3 waits on
  MEME. Phase 1 answers this *first*, on purpose.
- **Non-convergence is normal**, not an error (§5 acceptance).
- **Isolation must hold**: the PyPSA request must never be merged back into the
  Calliope request.
- Check `meme-pypsa`'s `attach_resolvent: false`
  (`dependencies/TentaCron/environment/config.yaml:101`) against our need to inject
  the profiles ourselves.
- **Units**: the legacy scaled `p_set` by `params.unit`; our MW→kW boundary must line
  up with whatever the pass emits.
- **The PF inherits our star topology.** The pass builds the network from the
  payload's topology (building → trafo, straight-line length), so the electrical
  results reflect that simplification. Real per-cable ratings/voltages along the
  actual LV lines still need the LV network modelled — out of scope here, noted so
  the result is not over-read.

## Not in scope

- Modelling the real LV line network (star topology stays).
- Heat (deferred, `heat-patch.md`).
- Any T1K mapping change beyond the PyPSA job body.

---

## 10. Definition of done

- [ ] Phase 1: a working `target=meme-pypsa` payload, documented, with the B1 answer
- [ ] Phase 2: the parse mapping table + the legacy regression gate green
- [ ] Phase 3: pass + isolated dispatch + ingest; `full-grid-pf` set
- [ ] Phase 4: all electrical sections verified in the UI
- [ ] Phase 5: `meme-calliope` added; stages wired; the three traps handled
- [ ] Phase 6: regressions green; docs updated

---

## 11. Blockers (the two that gate this plan)

**B1 — MEME has no canonical `lines`.** MEME states it itself
(`dependencies/meme/internal/target/pypsa/pypsa.go:37-39`): *"power_flow
(Lines/Transformers, KVL) is NOT claimed: no canonical field emits a lines.csv — all
transmission becomes transport Links. Reclaim once the schema carries electrical
parameters (r, x, s_nom)."* Until that changes a PyPSA run can only produce a
transport network — no PF, no voltage, no loading. **This is the gate**, and Phase 1
step 3 answers it first, on purpose.

**B2 — our mapping must emit the topology + types.** Today the payload's `pypsa`
block is dropped and transmission arcs carry no electrical attributes
(`enerplanet/backend/internal/meme/mapping.json`), so even a capable MEME would have
nothing to build lines from. This is ours to fix — the "the JSON defines the power
lines" note.

---

## 12. Questions to the developer

*(the sendable version is `pypsa-pass-ask.md`)*

1. **Schema:** a `lines` block carrying `type` + `length` + `num_parallel` (+ `v_nom`)
   with the type resolved inside MEME — or literal `r, x, s_nom`?
2. **Type library:** the catalogue we already embed (pylovo `equipment_data.csv`:
   `max_i_a`, `r_mohm_per_km`, `x_mohm_per_km`; `s_max_kva` for transformers), or one
   MEME ships?
3. **Does `meme-pypsa` run the PF** once lines exist, or only emit the network?
4. **Where do the Calliope results come from** — the Calliope leg's own bundle
   (`carrier_prod` / `carrier_con`, which we already map), or a separate document?
5. **Same job with extra fields, or a distinct PyPSA body?**
6. **Non-convergence:** the legacy cleared the entire PF export when any snapshot
   failed. Same rule for MEME?
7. **Slack bus** — who designates it, and how is it expressed in the canonical model?
   *(No `control` column is emitted today; the fixture only reads `Slack` because
   that is PyPSA's default.)* — folded in from the earlier parity ask.
8. **Cheap, useful now:** mark each emitted link's origin (e.g. a
   `source: transmission | conversion` column on `links.csv`) so a consumer can tell
   a wire from a conversion link without heuristics. — also folded in from there.

---

## Appendix A — the legacy reference, in full

All evidence under `dependencies/simulation-engine/`; the shipped package is
`webservice.docker/servicehub/c2p/temp_c2p_pkg/c2p/`, and the service entrypoint is
`servicehub/c2p/main.py:34` → `c2p.c2p(path)`.

**Guidance from the developer (meeting, 2026-10-06), as recorded**

- PyPSA has to be experimented with; treat it as its own thing.
- **PyPSA must run separately — never at the same time as Calliope.**
- The PyPSA pass is a **passthrough**: it should use the **Calliope results**.
- **The JSON defines the power lines**, and the missing **technical attributes must
  be supplied**.
- Reference for the conversion is the **old webservice**: check how it uses the
  Calliope results and adapt that into a pass that fills the PyPSA request for MEME
  **before sending it off separately**.
- Configs can be loaded per single transformer.
- "Wrap things around MEME again afterwards" — post-process after the run.

**Input 1 — time series ← the Calliope RESULTS** (`inputs/read.py:153-185`):

```
""" Reads calliope csv results (only carrier_prod, carrier_con files). """
carrier_prod → extract.from_key(csv_file(..., 'generators'))
carrier_con  → extract.from_key(csv_file(..., 'loads'))
```

plus a netcdf reader for `results.nc`. Those become the PyPSA **generators'** and
**loads'** `p_set`, scaled by the unit factor (`c2p.py:107-112`).

**Input 2 — network ← the model's topology + the `pypsa` settings**
(`inputs/create.py`): `:82-98` reads `trafo_mv_lv_type`, `line_type_mv`,
`line_type_lv` and the `*_num_parallel` values; `:113-134` builds one row per
connection `{bus0, bus1, length, pipe, type, num_parallel}`; `:179-185` emits buses
(`v_nom`), lines (`{bus0,bus1,type,length,num_parallel}`) and transformers. The
electrical parameters are **never literal** — they come from the cable/line **type**
via the type library. The pass supplies type + length + num_parallel (+ v_nom).

**Then** `c2p.py:115-138`: `lpf()` → `pf(use_seed=…, distribute_slack=False)` with a
convergence guard —

> *"Power flow failed to converge for some or all snapshots. Clearing bad results."*

— and `:152-176` exports the network (csv/hdf5/netcdf) **plus the web PF CSVs**
(`buses-p`, `buses-v_mag_pu`, `lines-p0/p1`, `transformers-*`).

**Conclusion.** PyPSA never re-optimises: Calliope decides the dispatch, PyPSA takes
it as fixed injections and runs a power flow over the network. Hence it cannot run
before or alongside Calliope, and "the passthrough" is exactly `read.py` +
`create.py`, then `pf()`. The web PF CSVs it exported are the very files our legacy
reader parses (`enerplanet/backend/internal/result/handler/result_helpers_pypsa_files.go`)
— which is why the legacy source has real voltage / line loading / convergence.
