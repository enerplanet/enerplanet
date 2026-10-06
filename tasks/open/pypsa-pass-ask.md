# PyPSA pass → EnerPlanET: short ask

**From:** EnerPlanET backend (THD) · **Date:** 2026-10-06
**Follows up on:** our call about the PyPSA pass.
*(full detail + evidence: `tasks/open/pypsa-isolated-run-plan.md`, especially §11–12
and Appendix A; narrows the earlier `tasks/closed/meme-pypsa-result-parity.md`)*

## What we took away

1. **PyPSA runs separately — never at the same time as Calliope.**
2. The PyPSA pass is a **passthrough of the Calliope results**: Calliope decides the
   dispatch, PyPSA runs the power flow on it.
3. Reference for the conversion is the **old webservice** — we've read
   `dependencies/simulation-engine` (`c2p`: `inputs/read.py` reads the Calliope
   results `carrier_prod`/`carrier_con` as the generator/load `p_set`;
   `inputs/create.py` builds bus/trafo/**line** from the topology + the `pypsa`
   settings' **types**, `length`, `num_parallel`, `v_nom`; then `lpf()` + `pf()`).
4. **The JSON defines the power lines**, and the missing **technical attributes must
   be supplied**.

## Where we are

We currently dispatch `target=pypsa,calliope` in **one** request (the bundled target)
— which per point 1 is wrong, and which is why our PyPSA leg comes back as a single
`"now"` snapshot with no voltage/loading. We already ship a `meme-pypsa` target and
our backend can already select it per request.

## The ask — in order of cost

1. **Confirm the shape.** Should MEME's schema gain a **`lines`** block carrying
   `type` + `length` + `num_parallel` (+ `v_nom`), with the cable/transformer type
   resolved **inside** MEME — or would you rather we pass literal `r`, `x`, `s_nom`?
   (We can already carry `r`/`x` today as `links_r`/`links_x`; what's missing is the
   canonical way to say "this is a `Line`, of type T".)
2. **Which catalogue resolves the type** — the equipment table we already embed
   (pylovo `equipment_data.csv`: `max_i_a`, `r_mohm_per_km`, `x_mohm_per_km`;
   `s_max_kva` for transformers), or one MEME ships?
3. **Does `target=pypsa` run the PF** once lines exist, or only emit the network?
4. **Where do the Calliope results come from** for the pass — the Calliope leg's own
   bundle (`carrier_prod` / `carrier_con`, which Coati already gives us), or a
   separate document we hand you?

**Carried over from our earlier note to you (sent 2026-09-30)**

5. **Slack bus** — who designates it, and how is it expressed in the canonical
   model? (No `control` column is emitted today; the fixture only reads `Slack`
   because that is PyPSA's default.)
6. **Cheap, useful now:** mark each emitted link's origin (e.g. a
   `source: transmission | conversion` column on `links.csv`) so a consumer can tell
   a wire from a conversion link without heuristics.

## One thing only you can decide

**Non-convergence semantics** — the legacy webservice *cleared the whole PF export*
if any snapshot failed to converge. Should a failed `network.pf()` fail the MEME job,
or annotate the bundle and still return the dispatch result? (Same question as #3 in
the earlier ask — happy to take your call either way.)

If a `lines` block is the direction you want, we're glad to prototype the pass on our
side (fill the PyPSA request from the Calliope results, then dispatch it separately)
and send a patch.

Thanks!
