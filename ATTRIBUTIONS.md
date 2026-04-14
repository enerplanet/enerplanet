# Attributions

This project uses the following third-party open-source components and data sources.

## Software Libraries

### Frontend

| Component | License | Source |
|---|---|---|
| React | MIT | https://reactjs.org |
| Vite | MIT | https://vitejs.dev |
| TailwindCSS | MIT | https://tailwindcss.com |
| Radix UI | MIT | https://radix-ui.com |
| TanStack Query | MIT | https://tanstack.com/query |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| OpenLayers | BSD-2-Clause | https://openlayers.org |
| MapLibre GL JS | BSD-3-Clause | https://maplibre.org |
| Apache ECharts | Apache-2.0 | https://echarts.apache.org |
| Turf.js | MIT | https://turfjs.org |
| i18next | MIT | https://www.i18next.com |

### Backend

| Component | License | Source |
|---|---|---|
| Gin Web Framework | MIT | https://github.com/gin-gonic/gin |
| GORM | MIT | https://gorm.io |
| Asynq | MIT | https://github.com/hibiken/asynq |
| Logrus | MIT | https://github.com/sirupsen/logrus |
| golang-migrate | MIT | https://github.com/golang-migrate/migrate |

### Infrastructure

| Component | License | Source |
|---|---|---|
| PostgreSQL + PostGIS | PostgreSQL / GPL-2 | https://postgis.net |
| pgRouting | GPL-2 | https://pgrouting.org |
| Redis | BSD-3-Clause | https://redis.io |
| Keycloak | Apache-2.0 | https://www.keycloak.org |
| Nginx | BSD-2-Clause | https://nginx.org |

### PyLovo (Grid Engine)

| Component | License | Source |
|---|---|---|
| FastAPI | MIT | https://fastapi.tiangolo.com |
| Pandapower | BSD-3-Clause | https://pandapower.readthedocs.io |
| Calliope | Apache-2.0 | https://www.callio.pe |
| PyPSA | MIT | https://pypsa.org |
| NREL PySAM | BSD-3-Clause | https://nrel-pysam.readthedocs.io |
| pvlib | BSD-3-Clause | https://pvlib-python.readthedocs.io |
| HAProxy | LGPL-2.1 | https://haproxy.org |

## Data Sources

| Dataset | License | Source |
|---|---|---|
| OpenStreetMap | ODbL | https://openstreetmap.org |
| 3D BAG (Netherlands) | CC BY 4.0 | https://3dbag.nl |
| CBS Open Data (Netherlands) | CC BY 4.0 | https://www.cbs.nl/en-gb/onze-diensten/open-data |
| EP-Online (Netherlands) | Open Government | https://ep-online.nl |
| GADM (Austria) | Academic / Non-Commercial | https://gadm.org |
| Geofabrik OSM Extracts | ODbL | https://download.geofabrik.de |
| Stromspiegel Deutschland | — | https://www.stromspiegel.de |

## Research

The PyLovo grid generation algorithm is described in:

> Reveron Baecker, B., Candas, S., Tepe, D., & Mohapatra, A. (2025): *Generation of low-voltage synthetic grid data for energy system modeling with the pylovo tool*. Sustainable Energy, Grids and Networks, 41, 101617. ISSN 2352-4677. [doi:10.1016/j.segan.2024.101617](https://doi.org/10.1016/j.segan.2024.101617)

## Standards & Technical References

The following standards and technical references inform energy demand estimation and grid sizing in PyLovo:

| Reference | Description | Source |
|---|---|---|
| Stromspiegel Deutschland | Household electricity consumption benchmarks (Germany) | https://www.stromspiegel.de |
| BDEW Standard Load Profiles | Sector-level electricity load profiles | https://www.bdew.de |
| DIN 18015-1 | Residential peak load and electrical connection sizing | https://www.din.de |
| CIBSE TM46 Energy Benchmarks | Non-residential building energy consumption benchmarks | https://www.cibse.org |
| Kerber Simultaneity Formula | Statistical simultaneity factor for residential load aggregation (`P_sim = P_peak × (g + (1 − g) × n^(−3/4))`) | Georg Kerber, *Aufnahmefähigkeit von Niederspannungsverteilnetzen für die Einspeisung aus Photovoltaikkleinanlagen* (2011) |
