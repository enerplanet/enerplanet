---
audience: developer
---

# SC-15 · Use each building's recorded use for its type and its heat

- **Personas:** the project developer and community organiser, the regional
  planner, the green entrepreneur, the private end user
- **Stories:** a model's heat demand reflects the buildings that are heated;
  results group demand by building type; the building's use from the 3D
  data is new
- **Flow path:** model setup (grid generation, heat technologies, building
  analysis), building configurator, results

## Narrative

A user draws an area in Mönchweiler (Baden-Württemberg) and generates the
grid. It holds 24 buildings. OpenStreetMap tags all of them only as
`building=yes`, so OpenStreetMap alone says nothing about their use. The 3D
data does: the land survey records 15 of them as houses and 9 as garages.

EnerPlanET takes each building's use from the 3D data. The map and the
building details show 15 residential buildings and 9 ancillary buildings.
When heat technologies are assigned automatically, the 15 houses get one
each and the 9 garages get none. Building analysis runs BuEM for the 15
houses only, and the garages have no heat demand. The results chart "Demand
by building type" shows two groups, residential and ancillary, instead of
one group of 24 "Other buildings".

In a Bavarian area the 3D data records many buildings only as "building for
business or trade", which does not say whether a building is a shop or a
hay barn. These count as unknown use. An unknown building that is both
lower than 5 m and smaller than 50 m² in footprint is treated as ancillary;
any other unknown building is treated as heated. A 3.8 m hay barn of 35 m²
is not heated; a 4.5 m single-storey workshop of 120 m² is.

A user who knows that one of the garages is a heated workshop changes its
type in the building details. From then on it is heated, gets a heat
technology and is analysed with the others.

## Rules

| Case | Building type | Heated |
|---|---|---|
| The 3D data records a use, e.g. residential, office, school | That use | Yes |
| The 3D data records an ancillary use (garage, shed, canopy, transformer) | Ancillary | No |
| The 3D data records an agricultural or industrial use | That use | Yes, unless it is both lower than 5 m and smaller than 50 m² in footprint |
| The 3D data records no use, or only a general one; OpenStreetMap gives a specific use | The OpenStreetMap use | Yes, unless that use is ancillary |
| Neither source gives a use | Other buildings | Yes, unless it is both lower than 5 m and smaller than 50 m² in footprint |
| The building has no 3D data | The OpenStreetMap use, or Other buildings | No heat demand can be calculated; it is not given a heat technology, and the building details say why |
| The user changes the type | The user's type, which wins over both sources | As the user's type implies |

- A building that is not heated gets no heat technology from automatic
  assignment or from "Add to all buildings", and building analysis does not
  run BuEM for it.
- A heat technology already on a building that turns out not to be heated,
  for example one assigned before the analysis finished, is removed when the
  analysis completes. A notice names how many buildings this affected.
- A run is never refused because a building that is not heated has no heat
  profile.

## Derived requirements

- The backend reads `use_type` and `residential` from City2TABULA's building
  response alongside the envelope, and stores them on each building of the
  model.
- One resolver applies the type order above (user type, 3D use, specific
  OpenStreetMap use, Other buildings) and the heated rule, and every caller
  uses it: automatic assignment, "Add to all buildings", building analysis,
  the dispatch check for missing heat profiles, the map, the building
  details and the results grouping.
- The size rule, for unknown, agricultural and industrial use, takes the
  building's height and footprint area from the 3D data, with the two
  limits (5 m, 50 m²) as named constants.
- Measured on the v4 test data, where every building has a recorded use,
  the size rule would treat as unheated 70% (Baden-Württemberg) and 66%
  (North Rhine-Westphalia) of ancillary buildings, and 0.3% and 7.4% of
  residential buildings. Height alone (under 5 m) would treat 6.5% and
  13.3% of residential buildings as unheated.
- The building details show the type, where it came from (3D data,
  OpenStreetMap or the user) and whether the building is heated, and let
  the user change the type, for buildings with and without 3D data.
- City2TABULA serves the general German code "building for business or
  trade" as unknown use rather than as commercial.

## Out of scope

- A source of building use for Vienna. Its 3D data records no use, so
  Vienna's buildings follow the OpenStreetMap and size rules until a source
  is added.
- Electricity demand. PyLovo's per-building electricity demand is not
  changed by this scenario.
- Partly heated buildings, such as a house with an attached unheated garage
  recorded as one building. A German building has one recorded use; a Dutch
  building takes the use covering most of its floor area.
