# SC-04 · Exclude a floor from a building's model

- **Personas:** [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [MKT](../personas.md#mkt), [USER](../personas.md#user)
- **Stories:** [US-204](../user-stories.md#us-204) (priority 1)
- **Flow path:** `Configuring`, metadata stage

## Narrative

A ground floor is a shop, not part of the community. In the metadata stage the
user reduces the modelled storey count or marks a floor excluded. The reference
floor area and downstream demand recompute, a save confirmation shows, and BuEM
runs without error.

## Derived requirements

- a storey count and floor-exclusion control in the metadata stage
- dependent values (reference floor area, demand) recompute live
- an explicit save confirmation
