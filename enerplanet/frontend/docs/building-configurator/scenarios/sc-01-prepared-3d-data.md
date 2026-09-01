# SC-01 · Configure a building with prepared 3D data

- **Personas:** [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [USER](../personas.md#user)
- **Stories:** [US-209](../user-stories.md#us-209), [US-501](../user-stories.md#us-501), [US-502](../user-stories.md#us-502)
- **Flow path:** `AreaResolved -> Clicked -> Ready -> Configuring` (see `../design.md`, section 2.1)

## Narrative

The area is drawn and the grid loaded. The building's 3D data is already in the
City2TABULA link table. The user clicks it; the configurator opens at the
metadata stage pre-filled from City2TABULA and ignis. They step through the
stages, adjust what they need, and mark the building ready for simulation, then
move to the next building without leaving the configurator.

## Derived requirements

- stages pre-filled from the enrich-endpoint merge map
- every pre-filled value carries a source badge (measured, archetype, user)
- per-stage completion indicator
- a "next building" action within the configurator
