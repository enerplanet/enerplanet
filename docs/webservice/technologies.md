# Energy Technologies

EnerPlanET models energy technologies using Calliope and PyPSA. Each technology is defined with capacity constraints, cost parameters, and technical specifications.

## Technology Categories

| Category | Technologies |
|---|---|
| Generation | Solar PV, Wind, Biomass, Geothermal, Hydropower |
| Storage | Battery |
| Demand | Household consumers, Non-household consumers |

## Technology Definitions

Technologies are configured as Calliope YAML nodes. Key parameters:

| Parameter | Description |
|---|---|
| `energy_cap_max` | Maximum installed capacity (kW) |
| `energy_cap_min` | Minimum installed capacity (kW) |
| `energy_eff` | Round-trip efficiency (0–1) |
| `lifetime` | Technology lifetime (years) |
| `cost.monetary.energy_cap` | CAPEX per kW (€) |
| `cost.monetary.om_annual` | Annual OPEX per kW (€/year) |
| `interest_rate` | Annualisation rate for CAPEX |

## Solar PV

Time-series generation profiles are fetched from the PV microservice (`:8082`) using NREL PySAM and pvlib for the model's location and date range.

```yaml
pv:
  essentials:
    name: Solar PV
    carrier: electricity
    parent: supply
  constraints:
    energy_cap_max: 1000      # kW
    resource: file=pv_profile.csv
    resource_unit: energy_per_cap
  costs:
    monetary:
      energy_cap: 900         # €/kW
      om_annual: 15           # €/kW/year
  lifetime: 25
```

## Wind

Wind generation profiles are computed by the Wind microservice (`:8083`) using NREL PySAM.

```yaml
wind:
  essentials:
    name: Wind Turbine
    parent: supply
    carrier: electricity
  constraints:
    energy_cap_max: 500
    resource: file=wind_profile.csv
    resource_unit: energy_per_cap
  costs:
    monetary:
      energy_cap: 1500
      om_annual: 40
  lifetime: 20
```

## Battery Storage

```yaml
battery:
  essentials:
    name: Battery Storage
    parent: storage
    carrier: electricity
  constraints:
    energy_cap_max: 500       # kWh
    charge_rate: 0.5          # C-rate
    discharge_rate: 0.5
    energy_eff: 0.92
    storage_loss: 0.001       # per hour
  costs:
    monetary:
      energy_cap: 300         # €/kWh
      om_annual: 5
  lifetime: 15
```

## Biomass

Biomass generation uses NREL PySAM Biopower (`:8084`) for dispatch modelling.

```yaml
biomass:
  essentials:
    name: Biomass CHP
    parent: supply
    carrier: electricity
  constraints:
    energy_cap_max: 200
    energy_eff: 0.35
  costs:
    monetary:
      energy_cap: 2500
      om_annual: 80
      om_prod: 0.05           # €/kWh
  lifetime: 20
```

## Geothermal

```yaml
geothermal:
  essentials:
    name: Geothermal
    parent: supply
    carrier: electricity
  constraints:
    energy_cap_max: 100
    energy_eff: 0.12
    resource: inf             # always available
  costs:
    monetary:
      energy_cap: 5000
      om_annual: 100
  lifetime: 30
```

## Demand Nodes

Demand loads are derived from PyLovo's per-building energy estimates, aggregated to the model area:

```yaml
demand:
  essentials:
    name: Electricity Demand
    parent: demand
    carrier: electricity
  constraints:
    resource: file=demand_profile.csv
    resource_unit: energy
    force_resource: true
```

## Adding a Technology

To add a new technology to a model:

1. Define the technology YAML block in the model configuration
2. Provide the time-series resource file (if applicable) via the relevant tech microservice
3. Include the technology key in the model's `locations` configuration
4. Submit the model for simulation via `POST /calliope/run`
