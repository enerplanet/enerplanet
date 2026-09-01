# SC-10 · Resume a half-finished configuration

- **Personas:** [any](../personas.md)
- **Stories:** none (new)
- **Flow path:** re-entry, `Clicked -> Ready` with saved state (see `../design.md`, section 2.4)

## Narrative

The user configures three of forty buildings, closes the browser, and returns
the next day. The three are still complete; the rest still show as not started.
They continue from where they left off.

## Derived requirements

- per-building configuration state persisted server-side, keyed to the model
- stage completeness restored on return
- re-resolving the area does not wipe entered data
