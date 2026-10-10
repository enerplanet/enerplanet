# DEV gating in the EnerPlanET frontend

How to make a UI affordance visible **only while developing**, and keep it out of
production builds. Use this when adding unfinished, internal, or risky controls
that developers need locally but users must not see yet.

## The one-liner

```tsx
{import.meta.env.DEV && <MyExperimentalControl />}
```

Vite **statically replaces** `import.meta.env.DEV` with `true` in the dev server
and `false` in `vite build`, so a gated element is dead-code-eliminated from a
production bundle — it is not merely hidden at runtime. That is the whole
mechanism; nothing else is needed for the common case.

## The two-way gate (dev server OR a built local bundle)

`DEV` is `false` in any real build, including a local `npm run build`. If you
need the control visible in a *built* local bundle (e.g. to check the exact prod
rendering), add a `VITE_*` escape hatch:

```tsx
const showGaps = import.meta.env.DEV || import.meta.env.VITE_SHOW_RESULT_GAPS === 'true';

{showGaps && <PlaceholderForMissingSection />}
```

- Document the flag in `.env.example`.
- **`.env` is a stale copy** created by `make setup` from an older
  `.env.example` — a new key will be missing there, `import.meta.env.VITE_X` is
  `undefined`, and any fallback silently wins. Append it to `.env` too.
- **Restart the Vite dev server** after editing `.env` — env is read once at
  startup.
- `.env` is gitignored; appending to it creates no tracked change.

## Local-only placeholders render **amber**

A placeholder that exists only because of the gate must never look like a neutral
part of the UI — otherwise it reads as real content that happens to be empty. Render
it **amber** (the app's warning colour; there is no `--warning` token, so use
Tailwind `amber-*` with a dark variant, matching `useConfirmDialog` /
`SidebarPanel`):

```tsx
border-dashed border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400
```

So far that means: the `GapNote` box, the gated section's header, and the card's
`ring-1 ring-amber-500/40` (`GatedSection`), plus the topology legend's inline
`notInResult` note. Amber = "this slot is local-only and drops out of a prod build";
if a gap note is ever *not* dev-gated, do not colour it amber — amber asserts the
gate.

## DEV gate vs. runtime Settings toggle — pick the right one

| Use a **DEV gate** | Use a **runtime toggle** (Settings → Experimental) |
|---|---|
| Internal/unfinished plumbing, debug affordances, a route you're mid-building | A feature a *user* opts into that they should be able to flip without a rebuild |
| Nobody outside the dev team should ever see it | Ships to users as an opt-in, with a "may be unstable" warning |
| Cheap: one expression, DCE'd out of prod | A zustand `persist` store + settings panel + route guard |

Rule of thumb: **if a user will decide, use a runtime toggle; if only a
developer should see it, use a DEV gate.** Do not add a Settings toggle for
result data a model simply does not have (that is availability, not a choice —
see the result-capability rule), and do not gate a user-facing experimental
feature behind a build-env flag when a runtime toggle is expected.

## Where it is used today

- `import.meta.env.DEV` — console logging in error paths across the app (search
  it for examples: `useForm`, `map-location`, `geocoding`, …).
- `VITE_SHOW_RESULT_GAPS` — the two-way gate in `GatedSection` that renders an
  in-place "missing section" placeholder in local builds.

## Gotchas

- `process.env` does **not** exist in the browser bundle — always
  `import.meta.env`.
- Never gate on a value computed at runtime; the gate must be a build-time
  constant to be DCE'd.
- A gate hides the UI, not the capability. If the backend endpoint must also be
  restricted in prod, guard it server-side too.
- Keep the gate expression in one place per feature so flipping it is a single
  edit, not a scavenger hunt through components.
