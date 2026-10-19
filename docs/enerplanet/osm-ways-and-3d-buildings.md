---
audience: developer
---

# OSM Ways and 3D Buildings

A model's buildings are OSM ways from pylovo. Their envelopes come from
City2TABULA, which links LoD2 buildings (3D buildings) to OSM ways. The two
datasets do not split buildings the same way, so one OSM way and one 3D
building are not always one building. This page states how EnerPlanET models
each case.

**Terms.** A *way* is one OSM building outline, identified by its `osm_id`. A
*3D building* is one LoD2 building, identified by its City2TABULA `object_id`.
The *standing way* of a 3D building is the way its envelope is reported under.

## The three cases

| Case | Example | What City2TABULA returns | How EnerPlanET models it |
|---|---|---|---|
| One way, one 3D building | A detached house | The building under the way | One BuEM run under the way's id |
| One 3D building, several ways | A hospital block mapped as five OSM ways (DEBY_LOD2_7595822) | The building once, under its best way, with every way in `osm_ids` | The standing way carries the building; the other ways are *further ways* |
| One way, several 3D buildings | A terraced row mapped as one OSM outline (way 1001832407) | Each 3D building, all with the same way | Each 3D building runs through BuEM; the results are summed into the way |

A way can be in both of the last two cases at once: it stands for several 3D
buildings, one of which also has further ways. The rules below apply
independently.

## Standing way

The standing way of a 3D building is its best OSM match when the model holds
that way, otherwise the first of its ways the model holds. An area that cuts
off a building's best way therefore still models the building, under another
of its ways. `city2tabula.BuildingsResult.ByRequestedWay` computes this for the
heat-demand job, the enrich endpoint, PV and site creation alike.

## Further ways

A further way is a way that shares a 3D building with its standing way.

- **3D data:** counts as linked. It is not reported missing and starts no
  City2TABULA run.
- **BuEM:** not run. Its demand profile row has the status `shared` and names
  the standing way.
- **MEME:** the heat demand (with its heating technologies) and the
  electricity demand that the standing way's BuEM series covers are dropped. A
  carrier the standing way has no series for stays with the further way.
- **Grid and site mode:** stays a building of the grid with its own pylovo
  load.

## Ways covering several 3D buildings

Each 3D building is modelled with its own envelope and TABULA U-values: the
buildings of a terraced row can be of different TABULA types.

- **BuEM:** one run per 3D building, under the id `<osm_id>#<object_id>`, largest
  building first (largest by floor area, then footprint). A way with a single
  3D building keeps its `osm_id` as id.
- **Result:** the series are summed step by step into one profile for the way.
  Its summary statistics (total, mean, median, min, max, standard deviation)
  are recomputed from the sum, as BuEM computes them. The sum is stored once,
  keyed by its parts, and reused by later runs.
- **Demand profile row:** one per way, with the summed annual totals and the
  TABULA type and building type of the largest building.
- **Customised building:** the configurator shows and edits the largest 3D
  building. A customised BuEM block replaces that building's run only; the
  other buildings of the way are still resolved from City2TABULA.
- **PV:** the way offers the roofs of all its 3D buildings.
- **Enrich endpoint:** returns the largest building, with `building_count` set to
  the number of 3D buildings the way covers. The building dialog says so.
- **`run_buem` path:** the raw results of the buildings are combined into one
  result for the way in the same way before they are merged into the topology.

!!! warning "All or nothing"
    A way gets a demand only when every one of its 3D buildings has a result.
    If one cannot be prepared or BuEM rejects it, the whole way fails, and its
    reason lists each failing 3D building. A sum of the remaining buildings
    would undercount the way without saying so; a failed way instead runs on
    its yearly demand for its whole outline.

## Where it is implemented

| Concern | Code |
|---|---|
| Standing way, further ways, buildings per way | `internal/city2tabula/client.go` (`ByRequestedWay`) |
| BuEM ids, all-or-nothing, summing stored profiles | `internal/jobs/building_parts.go` |
| Summing raw results, summary statistics | `internal/buem/combine.go` |
| Dropping a further way's demand | `internal/jobs/further_ways.go` |
| Enrich response | `internal/handler/city2tabula/handler.go` |
