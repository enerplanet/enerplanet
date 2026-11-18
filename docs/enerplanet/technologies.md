---
audience: non-technical
---

# Technologies

A technology is a piece of equipment placed on a building, such as solar panels,
a battery or a heat pump. This page lists the technologies EnerPlanET can
simulate, the default values they start with, and what each setting in the app
means.

## Types and products

Every technology belongs to one of eight **types**. The type decides what the
simulation does with the technology: what it takes in and what it gives out.

A type can have several **products**: the default product that comes with
EnerPlanET, and any variants you create yourself, for example a heat pump with
a higher COP. When you add a technology to a building, you first pick the type
and then the product.

| Type | Key | Takes in | Gives out |
|---|---|---|---|
| Photovoltaics | `pv_supply` | sunlight | electricity |
| Battery storage | `battery_storage` | electricity | electricity, later |
| Air-source heat pump | `air_source_heat_pump` | electricity | heat |
| Ground-source heat pump | `ground_source_heat_pump` | electricity | heat |
| Electric boiler | `electric_boilers` | electricity | heat |
| Gas boiler | `gas_boiler` | natural gas | heat |
| Air conditioner | `air_conditioner` | electricity | cooling |
| Gas supply | `gas_supply` | nothing (gas is bought at a fixed price) | natural gas |

The key is the internal name of the type. You only need it when you create your
own technology or import technologies from a file.

How the types work together:

- A building can have only one heat supply: an air-source heat pump, a
  ground-source heat pump, an electric boiler or a gas boiler.
- A building's heating and hot-water demand is included in the simulation only
  when the building has a heat supply. Its cooling demand is included only when
  it has an air conditioner.
- A building with a gas boiler, or with gas for cooking, gets a gas supply
  automatically. You do not need to add it yourself.

## Optimisation and simulation

EnerPlanET can run a model in two ways, and some settings on this page behave
differently in each:

- **Optimisation:** EnerPlanET chooses the size of each technology, between its
  minimum and maximum size, and how it runs hour by hour, so that the total
  cost is as low as possible. Use this when you do not yet know how large a
  system should be.
- **Simulation** (operate mode): you decide the sizes, and EnerPlanET works
  out how the equipment runs hour by hour and what it costs. Use this when you
  already know what you want to install. See
  [Heat pumps, boilers and air conditioners](#heat-pumps-boilers-and-air-conditioners)
  for the sizes a Simulation run needs.

## Entering values

!!! note "Fractions, not percentages"
    The app labels some values with %, but they must be entered as fractions:
    0.9 means 90 %, and an interest rate of 0.02 means 2 %.

Costs are entered in euros. The investment cost is spread over the
technology's lifetime using the interest rate. The results show the share
that falls in the model period, not the full purchase price: a model period
of one month shows about one twelfth of a year's share.

## Default values

These are the values a technology starts with. You can change them for a
single building, or create your own product with different values (see
[Creating your own technology](#creating-your-own-technology)).

| Type | Efficiency | Investment cost | Lifetime | Interest rate | Yearly operation and maintenance (O&M) |
|---|---|---|---|---|---|
| Photovoltaics | calculated from the weather and system losses | 575 EUR/kW | 25 years | 0.02 (2 %) | 8 EUR/kW |
| Battery storage | 0.949 per direction (about 90 % for a full charge and discharge) | 300 EUR/kW plus 600 EUR/kWh | 15 years | 0.02 (2 %) | 30 EUR/kW |
| Air-source heat pump | COP 3.33 | 900 EUR/kW | 18 years | 0.1 (10 %) | 0 |
| Ground-source heat pump | COP 4.55 | 1800 EUR/kW | 25 years | 0.1 (10 %) | 0 |
| Electric boiler | 0.99 | 150 EUR/kW | 20 years | 0.1 (10 %) | 0 |
| Gas boiler | 0.90 | 100 EUR/kW | 18 years | 0.1 (10 %) | 0 |
| Air conditioner | COP 3.2 | 500 EUR/kW | 15 years | 0.1 (10 %) | 0 |
| Gas supply | not applicable | gas costs 0.04 EUR/kWh | not applicable | not applicable | not applicable |

The coefficient of performance (COP) is the amount of heat or cooling
delivered per unit of electricity used. A COP of 3.33 means 1 kWh of
electricity gives 3.33 kWh of heat.

## Settings for every type

These settings apply to every type except gas supply.

| Name in the app | Key | Unit | What it means |
|---|---|---|---|
| Maximum installed energy capacity | `cont_energy_cap_max` | kW | Largest size the optimisation may choose. `INF` means there is no limit. |
| Minimum installed energy capacity | `cont_energy_cap_min` | kW | Smallest size the optimisation may choose. |
| System-wide maximum installed energy capacity | `cont_energy_cap_max_systemwide` | kW | Largest total size of this technology across all buildings in the model. |
| Energy efficiency | `cont_energy_eff` | fraction, or COP | Output per unit of input. See each type below. |
| Technology lifetime | `cont_lifetime` | years | Number of years over which the investment is paid off. |
| Investment cost | `cost_energy_cap` | EUR/kW | Cost per kW of installed size. |
| Interest rate | `cost_interest_rate` | fraction | Rate used to spread the investment over the lifetime. |
| Yearly O&M costs | `cost_om_annual` | EUR/kW per year | Yearly operation and maintenance cost per kW of installed size. |
| Fractional yearly O&M costs | `cost_om_annual_investment_fraction` | fraction of the investment per year | Alternative way to enter yearly O&M costs. Use either this or Yearly O&M costs, not both. |
| Production O&M costs | `cost_om_prod` | EUR/kWh | Cost for each kWh the technology produces. |
| Purchase cost | `cost_purchase` | EUR | One-off cost paid when the technology is installed, whatever its size. |

## Photovoltaics

EnerPlanET places one solar array on each suitable surface of a building. Each
array gets its own hour-by-hour production, based on the model's weather and
the direction and slope of its surface.

**Which surfaces get an array:**

- Roofs of at least 10 m², tilted 60° or less, and facing anywhere from east
  through south to west. North-facing roofs are left out.
- Flat roofs (tilted less than 10°). Panels on a flat roof are assumed to be
  mounted at 15°, facing south.
- Walls never get an array automatically, but you can choose them in the
  building configurator.
- A building without 3D data gets one flat array on its footprint.

**How large an array can be:**

- 80 % of each surface counts as usable, and each m² of usable area can hold
  up to 0.2 kW. For example, a 50 m² roof has 40 m² of usable area and allows
  up to 8 kW.
- If you lay out modules in the building configurator, the limit is the number
  of modules times the module power instead. For example, 20 modules of 0.4 kWp
  allow up to 8 kWp.
- In an optimisation, EnerPlanET chooses each array's size up to its limit. In
  a Simulation run, an array with a module layout is installed at
  exactly that size.

| Name in the app | Key | Unit | Default | What it means |
|---|---|---|---|---|
| PV System Loss | `losses` | fraction | 0.14 | Losses from dirt, wiring, shading and similar causes. |
| DC/AC Ratio | `dc_ac_ratio` | ratio | 1.1 | Panel power divided by inverter power. |
| Inverter Efficiency | `inv_eff` | fraction | 0.96 | Share of the panels' output that the inverter passes on. |
| PV Module Type | `module_type` | | 0 | 0 standard, 1 premium, 2 thin film. |
| PV Module Width | `module_width_m` | m | 1.134 | Used to place modules in the building configurator. |
| PV Module Height | `module_height_m` | m | 1.762 | Used to place modules in the building configurator. |
| PV Module Power | `module_power_kwp` | kWp | 0.4 | Peak power of one module. |

The cost and lifetime settings for every type apply too.

**Settings in the app that have no effect on photovoltaics:**

- PV Panel Tilt, PV Panel Orientation and Auto-Optimize Tilt & Azimuth. The
  tilt and direction of each array come from its surface and mounting instead.
- PV Panel Peak Capacity, Maximum installed energy capacity, Energy
  efficiency, Plant parasitic efficiency, Inverter Type, Energy capacity scale,
  Export capacity and Resource unit.

## Battery storage

A battery has two sizes:

- its **power** in kW, which limits how fast it can charge and discharge;
- its **storage capacity** in kWh, which limits how much energy it can hold.

The default battery is 10 kW and 20 kWh at most.

| Name in the app | Key | Unit | Default | What it means |
|---|---|---|---|---|
| Maximum storage capacity | `cont_storage_cap_max` | kWh | 20 | Largest storage capacity the optimisation may choose. |
| Minimum storage capacity | `cont_storage_cap_min` | kWh | 0 | Smallest storage capacity. |
| Cost of storage capacity | `cost_storage_cap` | EUR/kWh | 600 | Cost per kWh of storage capacity, on top of the investment cost per kW. |
| Energy efficiency | `cont_energy_eff` | fraction | 0.949 | Applied once when charging and again when discharging. 0.949 × 0.949 gives about 90 % for a full cycle. |
| Rate of storage loss per hour | `cont_storage_loss` | fraction per hour | 0.00004 | Share of the stored energy lost each hour. The default loses about 1 % over ten days. |
| Initial storage level | `cont_storage_initial` | fraction | 0 | How full the battery is at the start of the model period. |
| Storage depth of discharge | `cont_storage_discharge_depth` | fraction | 0 | Share of the capacity that must always stay stored. |

Energy capacity scale, Export capacity and Carrier export cost have no effect.

## Heat pumps, boilers and air conditioners

Energy efficiency is the COP for heat pumps and air conditioners, and a
fraction for boilers.

In a Simulation run:

- A heat supply that has no size is sized automatically to cover the
  building's highest heat demand in the model period. For a boiler, whose
  efficiency is below 1, the size is increased to make up for its losses.
- If you set a size that is too small to cover that highest demand, the run
  stops with an error.
- Battery storage and air conditioners must have a maximum size.

!!! tip "Air conditioners"
    The default air conditioner has no maximum size (`INF`). Set one before
    running a Simulation.

## Gas supply

| Name in the app | Key | Unit | Default | What it means |
|---|---|---|---|---|
| Carrier consumption cost | `cost_om_con` | EUR/kWh | 0.04 | Price of gas. |
| Maximum installed energy capacity | `cont_energy_cap_max` | kW | `INF` | Largest amount of gas the building can draw at once. |

## Adding a technology to buildings

- **On the map:** in the model's configuration panel, open Technologies and
  drag a technology onto a building. To add it to every building, choose Add
  to all buildings. For a heat supply, you then choose whether to add it only
  to buildings that have none yet, or to replace the existing one.
- **In the building configurator:** open a building, go to the Technologies
  tab, choose Add a technology, then pick its type and product.
- **After heat demand is assigned:** choose Auto-assign to give every building
  a typical heat supply for its building type, or Manual to pick each one
  yourself.

When picking a product, choose Define my own to change its settings for that
one building only.

## Creating your own technology

1. Open the Technologies page.
2. Use **Copy** on an existing technology of the type you want.
3. Give the copy a new key and name, and change its settings.

The copy keeps the type of the original and appears as a product of that type
wherever technologies are picked.

!!! warning "Use Copy, not Add Technology"
    A technology created with Add Technology has no type. The simulation
    includes it only when its key is exactly one of the eight keys listed
    under [Types and products](#types-and-products); otherwise it is left out
    of the simulation without a warning.

## Importing technologies

Import JSON on the Technologies page reads a file in this form:

```json
{
  "technologies": [
    {
      "key": "ashp_high_cop",
      "type": "air_source_heat_pump",
      "alias": "Air-source heat pump, high COP",
      "icon": "flame",
      "description": "Air-source heat pump with a higher COP.",
      "constraints": [
        { "key": "cont_energy_eff", "alias": "Energy efficiency", "default_value": 4.0 },
        { "key": "cost_energy_cap", "alias": "Investment cost", "unit": "EUR/kW", "default_value": 1100 },
        { "key": "cont_lifetime", "alias": "Technology lifetime", "unit": "years", "default_value": 20 }
      ]
    }
  ]
}
```

- `key` must be new. A technology whose key already exists is skipped.
- `type` is one of the eight keys under [Types and products](#types-and-products).
  If `type` is missing, the key is used as the type.
- `alias` is the name shown in the app.
- `constraints` holds the settings, using the keys from the tables on this
  page.
- For heat pumps, boilers, air conditioners and gas supply, any setting you
  leave out takes its value from [Default values](#default-values). For
  photovoltaics and battery storage, include every setting you need.
