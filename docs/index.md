# EnerPlanET

EnerPlanET is an open-source platform for designing, simulating, and optimising local energy distribution networks. It supports data-driven community energy planning — from polygon-based region selection and synthetic grid generation to power-flow simulation and cost analysis.

## Platform Components

```mermaid
graph TD
    A[Frontend<br/>React 19 + TypeScript] --> B[Backend API<br/>Go + Gin]
    B --> C[PostgreSQL 17<br/>+ PostGIS + pgRouting]
    B --> D[Redis 7<br/>Sessions / Queue]
    B --> E[PyLovo<br/>Grid Generation]
    B --> F[Simulation Engine<br/>Calliope / PyPSA]
    G[Keycloak 26<br/>OIDC / OAuth2] --> B
    F --> H[Tech Microservices<br/>PV / Wind / Biomass]
```

## Key Capabilities

| Capability | Description |
|---|---|
| Interactive Mapping | 2D (OpenLayers) and 3D (MapLibre GL JS) building visualisation |
| Grid Generation | Synthetic LV network design from OSM building footprints via PyLovo |
| Energy Simulation | Calliope and PyPSA optimisation via scalable simulation workers |
| Building Enrichment | 3D BAG, EP-Online, CBS (Netherlands); EUBUCCO (Germany); extensible |
| Technology Modelling | PV, wind, battery, biomass, geothermal |
| Cost Analysis | Cable, transformer, and equipment cost estimation |
| Multi-language | 8 languages: EN, DE, NL, ES, FR, IT, CS, PL |

## Documentation Sections

- **[EnerPlanET Platform](enerplanet/index.md)** — Installation, architecture, deployment, and Keycloak setup
- **[PyLovo Grid Engine](pylovo/index.md)** — Quickstart, algorithms, building types, AI energy estimation, REST API
- **[Simulation Webservice](webservice/index.md)** — Energy technology modelling and simulation endpoints
- **[Open Source Checklist](getting-started/open-source-checklist.md)** — Requirements for publishing under THD-Spatial-AI

## License

MIT License — Copyright (C) 2023–2026 Technische Hochschule Deggendorf

## Citation

If you use PyLovo in a scientific publication, please cite:

> Reveron Baecker et al. (2025): *Generation of low-voltage synthetic grid data for energy system modeling with the pylovo tool*. [doi:10.1016/j.segan.2024.101617](https://doi.org/10.1016/j.segan.2024.101617)
