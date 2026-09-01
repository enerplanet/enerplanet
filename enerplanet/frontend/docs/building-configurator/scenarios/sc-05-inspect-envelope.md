# SC-05 · Inspect and adjust the envelope

- **Personas:** [PLAN](../personas.md#plan), [USER](../personas.md#user)
- **Stories:** [US-202](../user-stories.md#us-202), [US-701](../user-stories.md#us-701), [US-502](../user-stories.md#us-502)
- **Flow path:** `Configuring`, geometry stage

## Narrative

In the geometry stage the user reviews each envelope element: wall, roof, floor
and window areas, orientation, U-values. Labels read as plain-language
questions with an info affordance. Units are shown and correct. City2TABULA-
derived values are badged; an edited value becomes "custom".

## Derived requirements

- element list grouped by type
- plain-language labels with info popovers (US-105)
- a unit label on every numeric field
- a source badge per value; editing a value flips its source to custom
