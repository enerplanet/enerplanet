# 0001 · Building Configurator state: server state in TanStack Query, UI and draft state in Zustand

- **Date:** 2026-09-01
- **State:** accepted

## Context

The prototype's per-building editor (`BuildingDialog.tsx`) holds every field in
a local `useState` (`editedFloors`, `editedArea`, `editedHouseholdSize`, and so
on). That does not survive a stage change, a "next building", or a page reload,
and no single place knows whether a building is ready to simulate.

The native configurator has to support:

- SC-02: the geometry stage loads asynchronously while the user edits other
  stages; the async fill must not clobber those edits.
- SC-10: a half-finished configuration survives a page reload; the user resumes
  across forty buildings.
- SC-11: a technology-preset library, independent of any model.
- the stage machine from `design.md` section 2.3 (Loading / Empty / Populated /
  Editing / Valid / Invalid per stage) and the readiness gate.

The frontend already provides both tools: `@tanstack/react-query` (wired in
`src/lib/react-query.ts`, per-feature `hooks/useXxxQuery.ts`) and Zustand
(`src/store/`, `persist` + `createJSONStorage(localStorage)`).

## Decision

Split state by ownership.

**Server state — TanStack Query.** The enrich merge map, the ignis TABULA
variant data per code, the weather series, and the saved configuration for each
building. Query keys include `modelId` and `osmId`. React Query owns fetching,
caching, deduplication, and refetch; the configurator never copies this into a
store.

**UI and draft state — one Zustand store, `useBuildingConfigStore`.** It holds:

- `activeBuilding: { modelId, osmId } | null` and `activeStage: StageId`
- `draft: BuildingDraft | null` — the working copy of the currently open
  building only. Seeded from the fetched saved config on open; the user edits
  the draft; a debounced mutation saves it.
- `stageStatus: Record<StageId, StageStatus>` — derived from the draft plus each
  stage module's pure `validate` / `isComplete`, recomputed on every draft
  change, not stored as an independent machine.
- `mode: 'simple' | 'pro'`

Only `activeStage` and `mode` are persisted to `localStorage`. The draft is
not persisted client-side: it is saved to the server (SC-10), and localStorage
is for per-viewer conveniences only.

**Preset state — a separate Zustand store, `useTechPresetStore`**, model
independent, persisted to `localStorage` and synced to the backend the way
`region-selector/store/default-region.ts` does.

**Persistence.** A debounced mutation (about 800 ms after the last edit) saves
the draft; on success React Query updates the saved-config cache. Switching
building or closing flushes a pending save first. A failed save is surfaced
non-blocking with retry; the draft stays in the store until it succeeds.

**One active draft, not a map.** The user edits one building at a time and
autosave runs continuously, so by the time they switch buildings the previous
draft is saved. Holding every building's draft in the store duplicates what the
server already has.

## Consequences

- `BuildingDialog.tsx`'s `useState` sprawl is replaced by one store plus query
  hooks. Each stage component reads `draft` and writes through store actions.
- New backend endpoints are required for per-building config persistence
  (`GET` / `PUT /api/v1/models/:id/buildings/:osmId/config` or equivalent).
  Tracked by #36; the store is built against a fixture until they exist.
- Stage status is always consistent because it is derived, never set directly.
  The cost is recomputing it on every keystroke; the validators are cheap pure
  functions over one building, so this is acceptable.
- Switching buildings has a flush-then-load step; a brief "saving" state can
  show on the stepper during it.
- No XState dependency.

## Alternatives considered

- **Everything in Zustand with `persist`, including the draft.** Rejected:
  localStorage would hold forty building drafts, it does not sync across the
  user's devices, and it silently diverges from the server copy. SC-10 wants
  server persistence anyway.
- **XState for the stage machine.** Rejected: stage status is almost entirely
  derived state (has data, has edits, passes validator); only the async load is
  a real event. A derived selector is smaller and the team uses no XState
  elsewhere.
- **Keep per-component `useState`, lift only what is shared.** Rejected: it is
  the prototype's approach and the reason state does not survive navigation or
  reload.
- **A draft map keyed by `modelId:osmId` in the store.** Rejected: duplicates
  server state, and autosave means the previous building is already saved
  before the user moves on.
