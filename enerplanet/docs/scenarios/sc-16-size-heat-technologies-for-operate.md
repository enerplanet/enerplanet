---
audience: developer
---

# SC-16 · Size heat technologies from peak heat demand in operate mode

- **Personas:** the project developer and community organiser, the regional
  planner, the green entrepreneur, the private end user
- **Stories:** operate mode simulates the buildings' existing systems; a
  run that cannot succeed is refused before it starts with a reason the
  user can act on; sizing heat technologies automatically is new
- **Flow path:** model setup (run mode, heat technologies), run, results

## Narrative

A user draws an area of six houses in Mönchweiler (Baden-Württemberg),
gives each a gas boiler, PV and a battery, and runs the first quarter of
2023 in operate mode. Operate mode does not size technologies; it
dispatches the sizes it is given. The gas boiler in the technology list has
no size, so before this scenario the map marked every house red and asked
for one. The user typed 10 kW for all six boilers. The houses' peak heat
demand is between 6.8 and 24.4 kW, so the run failed after dispatch with a
solver error.

With this scenario, the user leaves the boiler size empty. When the run
starts, EnerPlanET sizes each boiler from its house's peak heat demand in
the model period. The largest house peaks at 24.4 kW; its boiler converts
gas to heat at 90%, so it is sized to 27.1 kW of gas input and delivers the
peak. The run solves, and the results show each boiler at the size it was
given.

A user who knows that one house has an 18 kW boiler enters 18 kW for it.
That house peaks at 24.4 kW, so the run is refused before it starts, naming
the house, its peak heat demand and the size its heat technologies need.

## Rules

| Case in operate mode | Size used |
|---|---|
| A heat technology has no size | Peak heat demand in the model period, divided by the efficiency when the efficiency is below 1, rounded up to 0.1 kW |
| A heat technology has a size the user set | That size |
| A building's heat technologies together deliver less than its peak heat demand | The run is refused before dispatch |

- Heat technologies are the air-source and ground-source heat pump, the
  electric boiler and the gas boiler.
- A heat technology's size limits its input as well as its output, so a gas
  boiler of efficiency 0.9 delivers at most 90% of its size as heat. A heat
  pump's size limits its heat output.
- A building with several heat technologies gets each unsized one sized to
  cover the whole peak; dispatch chooses between them.
- In operate mode the map and the technology dialog no longer ask for a
  heat technology's size. Batteries and air conditioners still need one.
- Plan mode is unchanged: an unsized heat technology is sized by the
  optimisation.

## Derived requirements

- The backend sizes heat technologies at dispatch, after the BuEM series
  are attached and before the operate size check, from the building's heat
  series (space heating plus hot water, kW per model step).
- The refusal message names up to ten buildings with their peak heat
  demand and the heat their technologies deliver, and tells the user to
  raise the sizes or clear them.
- `operateSizeFields` (backend) and `OPERATE_SIZE_FIELDS` (frontend) list
  only the batteries and air conditioners.

## Out of scope

- Sizing from the year's peak rather than the model period's. A run of a
  mild month gets a smaller boiler than the house has; dispatch and
  operating costs are unaffected.
- Air conditioners sized from peak cooling demand.
- A boiler size that means heat output. The size limits input and output
  alike until MEME applies it to the output carrier only.
