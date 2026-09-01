# SC-06 · Add multiple PV instances to a building

- **Personas:** [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [MKT](../personas.md#mkt)
- **Stories:** [US-201](../user-stories.md#us-201), [US-205](../user-stories.md#us-205), [US-206](../user-stories.md#us-206)
- **Flow path:** `Configuring`, technologies stage

## Narrative

The technologies stage already shows a rooftop PV detected from the source
data. The user adds a second PV on another roof face, names it, and optionally
adds it as a PV plus storage pack. A confirmation shows per instance; each is
individually identifiable in results.

## Derived requirements

- multiple instances of one technology type, each named (convention
  `techname-face-N`)
- existing PV shown from live source data
- a standalone PV option and a PV plus storage pack option
- a per-instance add confirmation
