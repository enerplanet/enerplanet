# SC-07 · Ask the tool to size PV

- **Personas:** [PLAN](../personas.md#plan), [MKT](../personas.md#mkt)
- **Stories:** [US-207](../user-stories.md#us-207) (priority 0)
- **Flow path:** `Configuring`, technologies stage

## Narrative

Rather than guessing capacity, the user requests a recommended PV size for the
building's demand. The tool returns a Calliope-based estimate with the related
grid context. The recommendation is used only where the user has not defined a
component; user plans take precedence.

## Derived requirements

- a "recommend size" action in the technologies stage
- the result shown with its basis
- depends on an optimisation path that does not exist yet (US-207 traces to
  "Model Optimization (new)"); the control is designed now and wired once that
  path exists
