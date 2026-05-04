# EnerPlanET

Community energy grid planning and simulation platform.

EnerPlanET lets planners and engineers design, simulate, and optimise local low-voltage distribution networks, from drawing a polygon on a map to a full Calliope/PyPSA energy optimisation result. It covers synthetic grid generation from OpenStreetMap building data, multi-technology energy modelling (PV, wind, battery, biomass, geothermal), and interactive 2D/3D geospatial visualisation.

**Documentation:** [enerplanet.github.io/enerplanet](https://enerplanet.github.io/enerplanet)

---

## Stack

| Layer          | Technologies                                                        |
| -------------- | ------------------------------------------------------------------- |
| Frontend       | React 19, TypeScript, Vite, TailwindCSS, OpenLayers, MapLibre GL JS |
| Backend        | Go 1.24, Gin, GORM, Asynq (Redis-backed job queue)                  |
| Grid engine    | Python / FastAPI (PyLovo), PostgreSQL + PostGIS + pgRouting         |
| Simulation     | Calliope 0.6.10, PyPSA, PySAM (PV / Wind / Biomass / Geothermal)    |
| Auth           | Keycloak 26, OIDC / OAuth2                                          |
| Infrastructure | PostgreSQL 17 + PostGIS, Redis 7, Nginx, Docker Compose             |

---

## Quickstart

**Prerequisites:** Docker 20.10+, Docker Compose 2.0+, Git with Git LFS.

```bash
git clone https://github.com/enerplanet/enerplanet.git
cd enerplanet
git lfs pull
make setup
```

> [!NOTE]
> `make setup` creates the database, builds images, and starts all services. _(This might take a while)_

Default development credentials (change before any non-local deployment):

```bash
Email:    admin@example.de
Password: 12345678
```

See the [Installation Guide](https://enerplanet.github.io/enerplanet/docs/enerplanet/installation/) for full prerequisites, environment variables, and Keycloak configuration.

---

## Key Links

- [System Architecture](https://enerplanet.github.io/enerplanet/docs/enerplanet/architecture/)
- [Deployment Guide](https://enerplanet.github.io/enerplanet/docs/enerplanet/deployment/)
- [Authentication / Keycloak Setup](https://enerplanet.github.io/enerplanet/docs/enerplanet/keycloak/)
- [PyLovo Quickstart](https://enerplanet.github.io/enerplanet/docs/pylovo/quickstart/)
- [AI Energy Estimation](https://enerplanet.github.io/enerplanet/docs/pylovo/ai-estimation/)
- [REST API Reference](https://enerplanet.github.io/enerplanet/docs/pylovo/api/)

---

## Contributing

Bug reports, feature requests, and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

---

## License

MIT License — Copyright (C) 2023–2026 Technische Hochschule Deggendorf (BigGeoData & Spatial AI). See [LICENSE](LICENSE) for the full text.

---

## Citation

If you use EnerPlanET in a scientific publication, please cite:

```bibtex
@software{enerplanet2026,
  title   = {EnerPlanET},
  author  = {BigGeoData & Spatial AI, Technische Hochschule Deggendorf},
  year    = {2026},
  url     = {https://github.com/enerplanet/enerplanet},
  license = {MIT}
}
```

If you use the PyLovo grid engine specifically:

> Reveron Baecker et al. (2025). _Generation of low-voltage synthetic grid data for energy system modeling with the pylovo tool_. Sustainable Energy, Grids and Networks. [doi:10.1016/j.segan.2024.101617](https://doi.org/10.1016/j.segan.2024.101617)

---

## Acknowledgments

Developed by the **BigGeoData & Spatial AI** research group at Technische Hochschule Deggendorf.

Open data: OpenStreetMap, NASA MERRA-2, Open Meteo, CBS, EP-Online, GADM, 3D BAG, OpenGeoData NRW, ČÚZK LiDAR, GeoSN Sachsen, GAIA Thüringen, Geofabrik — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

This project is being developed in the context of the research project RENvolveIT (<https://projekte.ffg.at/projekt/5127011>).
This research was funded by CETPartnership, the Clean Energy Transition Partnership under the 2023 joint call for research proposals, co-funded by the European Commission (GA N°101069750) and with the funding organizations detailed on <https://cetpartnership.eu/funding-agencies-and-call-modules>.​

<img src="docs/assets/sponsors/CETP-logo.svg" alt="CETPartnership" width="144" height="72"> <img src="docs/assets/sponsors/EN_Co-fundedbytheEU_RGB_POS.png" alt="EU" width="180" height="40">
