# tasks/ — index

**Read this first (30 seconds).** Everything under `tasks/` is one task per doc, sorted
by whether its work is finished. This file is the map: what is open, what shipped, and
what a closed task leaves behind.

- **`open/`** — work not finished: the active plan, the pending ask, the deferred registers.
- **`closed/`** — finished work: plans whose decisions shipped, plus evidence. Still
  worth reading — each carries a **"Code this governs"** map back to the source.

## The one hard rule — code references docs, one direction only

- **Code MAY reference an OPEN task doc.** e.g. `// see tasks/open/heat-patch.md` — a
  live deferred register that explains why something is missing.
- **Code must NEVER reference a CLOSED task doc. On close, every reference to that
  document is removed from the code.** The link then lives in the doc itself: a
  **"Code this governs"** line naming the files it owns.
- Why: a closed record can be rewritten, folded or moved without touching a single
  source file — and a stale pointer to a frozen doc is worse than no pointer.

Enforced by a grep that must return nothing:

```bash
grep -rn "tasks/closed/" enerplanet/ --include=*.go --include=*.ts --include=*.tsx --include=*.sql
```

## How to use this folder

1. **One doc per task.** Each starts with a `**Status:**` line. If the status and the
   code disagree, the code wins — the stale status is a bug: fix it.
2. **A task addressed to someone else is a pair:** the long internal doc (evidence,
   decisions, risks) plus a short `…-ask.md` (sendable — no internal state, no
   environment details). Only the ask leaves the building.
3. **Fold, don't duplicate.** If a doc supersedes another, fold the still-true parts
   in and *delete* the old one (as `meme-pypsa-result-parity-ask.md` was folded into
   the PyPSA plan's §12 + the new ask).
4. **Closing a task — the checklist:** move it to `closed/`, update its row here,
   **remove every code reference to it** (the hard rule above), and add its
   **"Code this governs"** line.
5. **Diagrams are not tasks** — they live in `.local/docs/` (gitignored).

## Open — what still needs doing

| Doc | What it is | What it needs |
|---|---|---|
| `open/pypsa-isolated-run-plan.md` | **the active plan** — the isolated PyPSA (power-flow) run: Calliope first, PyPSA as a second, separate pass fed by the parsed Calliope results | Phases 1–6. **Gated on B1**: can MEME's schema express `lines` at all? Start at Phase 1 step 3 — it needs no services |
| `open/pypsa-pass-ask.md` | the sendable ask to the MEME/T1K/TentaCron dev (8 questions, the legacy + schema ones) | **Send it.** Then record the answers in the plan's §12 and unblock B1 |
| `open/heat-patch.md` | deferred register — the heat vector on the MEME dispatch path | after electricity is solid end-to-end |
| `open/pv-patch.md` | deferred register — a precomputed profile for physics PV/wind (a `pv_supply` tech currently 422s the whole dispatch) | when a real TentaCron `resolvent-pvgis` run is available |

## Closed — what shipped, and what it records

| Doc | What it records | Standing caveat |
|---|---|---|
| `closed/meme-result-timeseries-mapping.md` | Rounds 1–4: the Coati/Calliope → R2 mapping, name normalisation, the MW→kW boundary, the per-grid cable rating | Round 3's rating is a **stopgap** — the PyPSA plan supersedes it once real `lines` exist |
| `closed/grid-result-capabilities-plan.md` | the capability/provenance contract (`legacy`/`meme`/`full-grid-pf`), the conditional Grid UI, migration 047 | Phase 3 is **partly superseded** — see the banner at its §4 |
| `closed/meme-integration-plan.md` | the umbrella runbook: steps 1–10 and the D-decision register | ~all `[DONE]`; its open residuals are listed below |
| `closed/meme-pypsa-result-parity.md` | the API-contract vs MEME-PyPSA **parity analysis** (the field-coverage tables) | it is the evidence base for the open plan's **Phase 2** — read it before deciding the parsing |

## Start here — the MEME migration story, in order

1. `closed/meme-integration-plan.md` — the umbrella: what was decided and why (the D-register).
2. `closed/meme-result-timeseries-mapping.md` — how a MEME result becomes R2 tables (as built).
3. `closed/grid-result-capabilities-plan.md` — why the Grid hides sections a source cannot fill.
4. `open/pypsa-isolated-run-plan.md` — **what happens next** (the electrical layer), with its handoff notes at the top.

## What stays open after a task closes

Nothing should silently disappear when a doc moves to `closed/`. Currently:

- `closed/meme-pypsa-result-parity.md` — its coverage tables feed the open plan's Phase 2.
- `closed/meme-integration-plan.md` **Step 10 — "retire the webservice path, at parity"** → __not started__, gated on parity.
- `closed/meme-integration-plan.md` **Step 7 — run-id diff schema** → deferred, and it has no doc of its own (tracked here).
- **Heat** and **PV** → their `open/` registers.
- The **`modified` model status** (2 rows in the DB carry it, but the lifecycle enum and state machine don't define it) → reconcile when the status × stage work happens (PyPSA plan Phase 5).

## Conventions

- **Doc status** is one line: `**Status:** active | proposed | DECIDED | IMPLEMENTED | DEFERRED — …`.
- **Model lifecycle statuses** (a different thing, in `infrastructure/common/pkg/contracts/lifecycle.go`):
  `draft · queue · running · processing · completed · published · failed · cancelled`.
- **Paths inside docs are repo-relative** (`tasks/open/…`, `tasks/closed/…`) so a
  folder move is a `grep`, never a guess.
