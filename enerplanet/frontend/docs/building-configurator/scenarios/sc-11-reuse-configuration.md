# SC-11 · Reuse configuration across buildings

- **Personas:** [any](../personas.md)
- **Stories:** none (new)
- **Flow path:** `Configuring`, any stage, a copy-from-building or apply-preset action

## Narrative

A user has fully configured one building. The next forty are the same type and
period, and the user plans the same wall insulation and the same PV product and
price for all of them. Rather than re-entering everything, the user copies the
shared parameters from the configured building onto a selection of others, and
saves the PV configuration as a named preset to apply per building with only the
capacity adjusted.

## Derived requirements

- copy from a source building: choose which categories to copy (classification,
  refurbishment measures, comfort assumptions); geometry and sizing are never
  copied
- a technology preset: save the product and economic parameters of a PV or
  battery configuration under a name; apply it to any building or cluster;
  sizing and orientation stay local
- model-level defaults: electricity tariff, comfort setpoints and a
  refurbishment target set once and inherited by every building unless
  overridden

## Parameter classification

Full per-stage table in `../design.md` section 1.7.
