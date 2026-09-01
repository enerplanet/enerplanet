# SC-03 · Configure a building City2TABULA could not match

- **Personas:** [USER](../personas.md#user), [PLAN](../personas.md#plan)
- **Stories:** [US-203](../user-stories.md#us-203), [US-502](../user-stories.md#us-502)
- **Flow path:** `Clicked -> Estimated -> Configuring` (see `../design.md`, section 2.1)

## Narrative

City2TABULA returns the building with no TABULA variant. The geometry stage
opens with archetype defaults derived from type and period, a banner that
geometry is estimated, and the user can still complete every stage and run
BuEM.

## Derived requirements

- an "estimated, no measured geometry" banner
- defaulted values visually distinct from measured and from user-entered
- no blocked stages
- options that do not apply are hidden, not disabled (US-203)
