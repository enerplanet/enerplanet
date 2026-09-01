# SC-02 · Configure a building whose 3D data is not yet prepared

- **Personas:** [any](../personas.md)
- **Stories:** none (new, from the c2t enrich-endpoint design)
- **Flow path:** `AreaResolving -> Clicked -> Preparing -> Ready|Estimated` (see `../design.md`, section 2.1)

## Narrative

The user clicks a building in an area City2TABULA has never processed. The
geometry stage shows a "preparing 3D data for this area, this can take a few
minutes" state with progress (N of M buildings). The metadata and technologies
stages stay usable. When the run completes the geometry stage fills in without
discarding anything the user has entered.

## Derived requirements

- a per-stage loading state, distinct from empty
- area-level progress from the enrich endpoint's status and resolved counts
- other stages remain editable during the wait
- the async fill must not overwrite user edits made while waiting
