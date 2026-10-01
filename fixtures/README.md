# Fixtures

Small extracts that let the heat workflow run without any data pipeline: no
weather download, no CityGML import, no grid generation. `make setup` loads
them; `make fixtures` reloads them on a working checkout. Every file except
the scripts is a Git LFS object, so install Git LFS before cloning.

Credits and licence terms for every extract are in [ATTRIBUTION.md](ATTRIBUTION.md).
How the fixtures were produced, and how to regenerate them, is in
[docs/enerplanet/test-data.md](../docs/enerplanet/test-data.md).

## Sites

| Site | Country | Area | 3D source |
|---|---|---|---|
| Loenen | NL | postcode 7371 | 3DBAG |
| Bremen | DE | LoD2 tile `LoD2_32_486_5882_2_HB`, 8.7909 53.0873 to 8.8208 53.1053 | LoD2 Land Bremen |

## Files

| File | Size | Used by | Site | Purpose | Loaded by |
|---|---|---|---|---|---|
| `city2tabula/city2tabula_loenen.sql.gz` | 8.1 MB | City2TABULA | Loenen | building envelopes, surfaces and links to PyLovo buildings | `load.sh city2tabula`, into `<DB_NAME>_nl` |
| `city2tabula/city2tabula_bremen.sql.gz` | 19 MB | City2TABULA | Bremen | as above | `load.sh city2tabula`, into `<DB_NAME>_de` |
| `city2tabula/tabula_nl.sql.gz` | 12 kB | City2TABULA | NL | Dutch TABULA archetypes, needed to classify buildings | `load.sh city2tabula`, into `<DB_NAME>_nl` |
| `city2tabula/tabula_de.sql.gz` | 20 kB | City2TABULA | DE | German TABULA archetypes | `load.sh city2tabula`, into `<DB_NAME>_de` |
| `pylovo/pylovo_fixture.sql.gz` | 5.0 MB | PyLovo | Loenen, Bremen | low-voltage grids, buildings and their inputs, for both sites in one database | `make pylovo-fixture` (`load.sh pylovo`), before PyLovo starts |
| `pylovo/bremen_tile.wkt` | 4 kB | `export_pylovo.py` | Bremen | the clip polygon the PyLovo fixture is cut to | not loaded; regeneration input |
| `weather/cosmo_rea6/netherlands/output/COSMO_REA6_2018_annual_all_attrs.nc` | 1.9 MB | weather-serve | Loenen | hourly 2018 weather, 3×3 cells | `load.sh weather`, into the weather checkout's `data/` |
| `weather/cosmo_rea6/germany/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.1 MB | weather-serve | Bremen | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `models/loenen.json`, `models/bremen.json` | 96 kB, 132 kB | backend | Loenen, Bremen | example saved models, development only | `make example-models` (`example_models.sh`) |

## Weather per provider

A model uses one weather archive for all of its simulations. Each provider
needs its own cut per site, in the layout weather-serve reads:
`<provider>/<country>/output/<PROVIDER>_2018_annual_all_attrs.nc`.

| Provider | Loenen (NL) | Bremen (DE) |
|---|---|---|
| `cosmo-rea6` | committed | committed |
| `era5-land` | not yet | not yet |
| `merra-2` | not yet | not yet |

## Scripts

| Script | Does |
|---|---|
| `load.sh` | restores every fixture set, or only the named ones (`weather`, `city2tabula`, `pylovo`); never overwrites existing data unless `FORCE=1` |
| `example_models.sh` | creates the example models through the backend API; refuses unless `APP_ENV=development` |
| `export_pylovo.py` | regenerates the PyLovo fixture from a populated PyLovo database |
