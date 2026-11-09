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
6. **`optional/` holds deferred *design* decisions** — a known trade-off that was consciously not taken now,
   with its options, upsides/downsides and the trigger that should reopen it. Nothing in `optional/` is
   committed work; a doc moves to `open/` when its trigger fires.

## Open — what still needs doing

| Doc | What it is | What it needs |
|---|---|---|
| `open/pypsa-isolated-run-plan.md` | **the active plan** — the isolated PyPSA (power-flow) run: Calliope first, PyPSA as a second, separate pass fed by the parsed Calliope results | Phases 1–6. **Gated on B1**: can MEME's schema express `lines` at all? Start at Phase 1 step 3 — it needs no services |
| `open/pypsa-pass-ask.md` | the sendable ask to the MEME/T1K/TentaCron dev (8 questions, the legacy + schema ones) | **Send it.** Then record the answers in the plan's §12 and unblock B1 |
| `open/heat-patch.md` | deferred register — the heat vector on the MEME dispatch path. **Re-baselined 2026-10-20:** the T1K mapping already carries heat/cooling/gas and run mode exists; the gaps are frontend `energyVectors` + heat techs, the unconditional `capacity.expandable` vs `operate`, and enforcing `operate` for heat models | gap 1 (frontend schema) first, then the Go expandable pass |
| `open/pv-patch.md` | deferred register — a precomputed profile for physics PV/wind (a `pv_supply` tech currently 422s the whole dispatch) | when a real TentaCron `resolvent-pvgis` run is available |

## Optional — deferred design decisions

| Doc | The decision | Reopen when |
|---|---|---|
| `optional/pypsa-payload-parity.md` | the pypsa leg rebuilds a **bare** payload while the Calliope leg enriches its own (BuEM series, PV arrays, grid prices, heat pruning), so the two jobs differ in tech-id space. Options: share the enrichment (adds BuEM/PV/price deps + model writes to a leg meant to be a passthrough), persist what Calliope built (storage + a column), or keep tolerating (mapper guards) | a **new enrichment step** lands in `HandleDispatchMeme`, or drift shows up **electrically** (a dropped/created tech changes the solved network, not just the job's non-electrical parts) |

## Closed — what shipped, and what it records

| Doc | What it records | Standing caveat |
|---|---|---|
| `closed/meme-result-timeseries-mapping.md` | Rounds 1–4: the Coati/Calliope → R2 mapping, name normalisation, the MW→kW boundary, the per-grid cable rating | Round 3's rating is a **stopgap** — the PyPSA plan supersedes it once real `lines` exist |
| `closed/grid-result-capabilities-plan.md` | the capability/provenance contract (`legacy`/`meme`/`full-grid-pf`), the conditional Grid UI, migration 047 | Phase 3 is **partly superseded** — see the banner at its §4 |
| `closed/meme-integration-plan.md` | the umbrella runbook: steps 1–10 and the D-decision register | ~all `[DONE]`; its open residuals are listed below |
| `closed/meme-pypsa-result-parity.md` | the API-contract vs MEME-PyPSA **parity analysis** (the field-coverage tables) | it is the evidence base for the open plan's **Phase 2** — read it before deciding the parsing |
| `closed/pr377-review-fixes.md` | the PR #377 review resolution: the B1–B6/N1–N6 triage with file·line refs, the per-fix commit log, and the fixes found during live validation | the `pending`-request handshake (`pending` row + 409 guard) was added **after** the review; the review's N4 wording was later re-scoped in the validation doc |
| `closed/pr377-validation.md` | the live-validation record for those fixes: V1–V9 with per-step evidence, the corrections to my own expectations, and the findings the runs produced | V8's original target (`published`) is unreachable — the status is vestigial; legacy pre-059 runs still lack the file-derived Grid sections |

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
- **`modified` model status** → the entry here previously claimed "2 rows in the DB carry it"; the current DB
  has **none** (`draft` ×2, `completed` ×7, `failed` ×3 only), so either those rows were re-run or the claim was
  stale. The lifecycle enum still doesn't define it → reconcile when the status × stage work happens (PyPSA plan Phase 5), **together with `published`** (below).
- **PR #377 (`feature/pypsa-update`)** → the reviewer reply (per-fix commit ids + the **line-loading disclosure**:
  the old ingest over-counted lines, so pre-branch numbers change) and the **push** are both outstanding. The
  branch is committed locally (20+ commits) and has never been pushed. Docs closed, action pending.
- **The `published` model status is vestigial** → declared in the contract enum, rendered by the frontend
  (type union, badge colours, `isDone`, the always-zero admin/status counters) and read exactly once in the
  backend (`stats.Published = byStatus[models.ModelStatusPublished]`, `model/handler/model.go:550`) — but **no
  code path anywhere sets it**, and the DB has never held one. Not related to sharing (`model_shares`, keyed by
  user/email and explicitly independent of workspaces). → cleanup ticket.
- **Legacy pre-059 power-flow runs** → a `pypsa` leg row with no `extracted_path` falls back to the newest
  `model_results` bundle (the Calliope one), which has no `power_flow/`, so the file-derived Grid sections
  (convergence, transformer loading, line ratings) are **absent**. Not a regression (F3 could not retroactively
  fix a pre-059 row) and a re-run repairs it. Optional follow-up: have `pypsaExtractedPath` search sibling
  `model_<id>_*` dirs for a `power_flow` marker before giving up. Evidence: `closed/pr377-validation.md` V9.
- **Coati document version skew** → Coati emits `schema_version="1.1"` while the backend expects `1.0`
  (non-fatal, `success=true capacities=3`). On the **Calliope** ingest path, not PR #377. Unexamined.

## Conventions

- **Doc status** is one line: `**Status:** active | proposed | DECIDED | IMPLEMENTED | DEFERRED — …`.
- **Model lifecycle statuses** (a different thing, in `infrastructure/common/pkg/contracts/lifecycle.go`):
  `draft · queue · running · processing · completed · published · failed · cancelled`.
- **Paths inside docs are repo-relative** (`tasks/open/…`, `tasks/closed/…`) so a
  folder move is a `grep`, never a guess.
