# Fixtures

Small extracts that let the heat workflow run without any data pipeline: no
weather download, no CityGML import, no grid generation. `make setup` loads
them; `make fixtures` loads any that are missing, and `make fixtures-reload`
replaces them all (see Reloading). Every file except
the scripts is a Git LFS object, so install Git LFS before cloning.

Credits and licence terms for every extract are in [ATTRIBUTION.md](ATTRIBUTION.md).
The credit lines, in short:

| Data | Used for | Credit | Licence |
|---|---|---|---|
| 3DBAG | Loenen 3D buildings | © 3DBAG by tudelft3d and 3DGI | CC BY 4.0 |
| LoD2 Land Bremen | Bremen 3D buildings | Quellenvermerk: Landesamt GeoInformation Bremen | CC BY 4.0 |
| Generalisiertes Dachmodell | Vienna 3D buildings | Datenquelle: Stadt Wien – data.wien.gv.at | CC BY 4.0 |
| 3D model budov | Brno 3D buildings | Data o 3D modelu budov byla získána pod licencí CC BY z data.brno.cz. | CC BY 4.0 |
| TABULA | archetypes, all countries | IEE Projects TABULA + EPISCOPE (www.episcope.eu) | TABULA/EPISCOPE terms of use |
| OpenStreetMap | grids, buildings, smoke GeoJSON | © OpenStreetMap contributors | ODbL 1.0 |
| CBS PC4 | Loenen postcode | Source: Statistics Netherlands (CBS) | CC BY 4.0 |
| Statistik Austria | Vienna postcodes | Datenquelle: Statistik Austria | CC BY 4.0 |
| ČSÚ via RCzechia | Brno postcode number | Zdroj: Český statistický úřad (ČSÚ) | CC BY 4.0 |
| COSMO-REA6 | weather, all sites | Datenbasis: Deutscher Wetterdienst, Ausschnitt, eigene Elemente ergänzt | CC BY 4.0 |
| MERRA-2 | scenario weather, all sites | Global Modeling and Assimilation Office (GMAO), NASA GES DISC | NASA EOSDIS data use guidance |

How the fixtures were produced, and how to regenerate them, is in
[docs/enerplanet/test-data.md](../docs/enerplanet/test-data.md).

## Sites

PyLovo covers the area in the third column. The 3D data covers a smaller box
inside it, split into a processed part, which is already extracted and linked
to PyLovo, and a raw part, which City2TABULA processes on request when a model
is drawn there. Elsewhere in the area, buildings have no 3D data.

| Site | Country | PyLovo area | 3D box (EPSG:4326) | Processed part | 3D buildings (processed) | 3D source |
|---|---|---|---|---|---|---|
| Loenen | NL | postcode 7371 | 6.01175 52.09877 to 6.03662 52.11506 | south of lat 52.11099 | 737 (333) | 3DBAG |
| Bremen | DE | LoD2 tile `LoD2_32_486_5882_2_HB`, 8.7909 53.0873 to 8.8208 53.1053 | 8.79239 53.09770 to 8.80586 53.10312 | west of lon 8.79613 | 836 (419) | LoD2 Land Bremen |
| Vienna | AT | postcodes 1010, 1070, 1080 and 1090, clipped to `pylovo/vienna_coverage.wkt` | 16.33877 48.20692 to 16.35360 48.21506 | west of lon 16.34686 | 927 (514) | Generalisiertes Dachmodell (LoD2), Stadt Wien |
| Brno | CZ | box 16.603 49.190 to 16.613 49.200 inside postcode 60200, `pylovo/brno_box.wkt` | 16.60300 49.19000 to 16.61262 49.19996 | south of lat 49.19430 | 655 (370) | 3D model budov, Brno |

Every 3D building in a box also exists in the PyLovo fixture. A model drawn
across a split line counts the processed buildings it touches and may start no
run; draw it clear of the line to test on-request processing.

## Files

| File | Size | Used by | Site | Purpose | Loaded by |
|---|---|---|---|---|---|
| `city2tabula/city2tabula_loenen.sql.gz` | 4.1 MB | City2TABULA | Loenen | the full database for the processed part: CityDB import, TABULA archetypes, envelopes, surfaces and links to PyLovo buildings | `load.sh city2tabula`, into `<DB_NAME>_nl` |
| `city2tabula/city2tabula_bremen.sql.gz` | 4.4 MB | City2TABULA | Bremen | as above | `load.sh city2tabula`, into `<DB_NAME>_de` |
| `city2tabula/city2tabula_vienna.sql.gz` | 25.1 MB | City2TABULA | Vienna | as above | `load.sh city2tabula`, into `<DB_NAME>_at` |
| `city2tabula/city2tabula_brno.sql.gz` | 11.6 MB | City2TABULA | Brno | as above | `load.sh city2tabula`, into `<DB_NAME>_cz` |
| `city2tabula/lod2/netherlands/3dbag/` | 1.0 MB | City2TABULA | Loenen | 3D source for the whole box, CityJSON, with `attribution.json` | `load.sh city2tabula`, into the City2TABULA checkout's `data/lod2/` |
| `city2tabula/lod2/germany/bremen/` | 1.6 MB | City2TABULA | Bremen | 3D source for the whole box, CityGML, with `attribution.json` | as above |
| `city2tabula/lod2/austria/vienna/` | 8.1 MB | City2TABULA | Vienna | 3D source for the whole box, CityGML, with `attribution.json` | as above |
| `city2tabula/lod2/czechia/brno/` | 2.0 MB | City2TABULA | Brno | 3D source for the whole box, CityJSON, with `attribution.json` | as above |
| `pylovo/pylovo_fixture.sql.gz` | 7.8 MB | PyLovo | all four | low-voltage grids, buildings and their inputs, for every site in one database | `make pylovo-fixture` (`load.sh pylovo`), before PyLovo starts |
| `pylovo/bremen_tile.wkt` | 4 kB | `export_pylovo.py` | Bremen | the clip polygon the PyLovo fixture is cut to | not loaded; regeneration input |
| `pylovo/vienna_coverage.wkt` | 5 kB | `export_pylovo.py` | Vienna | as above | not loaded; regeneration input |
| `pylovo/brno_box.wkt` | 4 kB | `export_pylovo.py` | Brno | as above | not loaded; regeneration input |
| `weather/cosmo_rea6/netherlands/output/COSMO_REA6_2018_annual_all_attrs.nc` | 1.9 MB | weather-serve | Loenen | hourly 2018 weather, 3×3 cells | `load.sh weather`, into the weather checkout's `data/` |
| `weather/cosmo_rea6/germany/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.1 MB | weather-serve | Bremen | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `weather/cosmo_rea6/austria/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | weather-serve | Vienna | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `weather/cosmo_rea6/czech_republic/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | weather-serve | Brno | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `weather/merra2/<country>/output/percentile/merra2_<p10,p50,p90>_<01..12>_all_attrs.nc` | 2.6 MB per country | weather-serve | all four | low, typical and high solar year scenarios, one MERRA-2 cell per site, 36 files per country | `load.sh weather` |
| `models/loenen.json`, `models/bremen.json` | 96 kB, 62 kB | backend | Loenen, Bremen | example saved models, development only | `make example-models` (`example_models.sh`) |

## Weather per provider

A model uses one weather archive for all of its simulations. Each provider
needs its own cut per site, in the layout weather-serve reads: a year archive
at `<provider>/<country>/output/<PROVIDER>_2018_annual_all_attrs.nc`, scenarios
at `<provider>/<country>/output/percentile/<provider>_<p10|p50|p90>_<month>_all_attrs.nc`.
The scenarios p10, p50 and p90 are the low, typical and high solar year,
ranked on monthly global horizontal irradiance.

| Provider | Kind | Loenen (NL) | Bremen (DE) | Vienna (AT) | Brno (CZ) |
|---|---|---|---|---|---|
| `cosmo-rea6` | 2018 | committed | committed | committed | committed |
| `cosmo-rea6` | scenarios | not yet | not yet | not yet | not yet |
| `era5-land` | 2018 or scenarios | not yet | not yet | not yet | not yet |
| `merra-2` | 2018 | not yet | not yet | not yet | not yet |
| `merra-2` | scenarios | committed | committed | committed | committed |

## Scripts

| Script | Does |
|---|---|
| `load.sh` | restores every fixture set, or only the named ones (`weather`, `city2tabula`, `pylovo`); never overwrites existing data, except the weather and City2TABULA source files under `FORCE=1` |
| `example_models.sh` | creates the example models through the backend API; refuses unless `APP_ENV=development` |
| `export_pylovo.py` | regenerates the PyLovo fixture from a populated PyLovo database |

## Reloading

`load.sh` skips a City2TABULA database that already exists and a PyLovo
database whose `grid_result` has rows; `FORCE=1` replaces only the weather
and City2TABULA source files. To replace everything with the committed fixtures, from the repository
root:

```bash
git pull
make fixtures-reload
```

**This drops the City2TABULA databases (`city2tabula_nl`, `_de`, `_at`, `_cz`)
and `pylovo_db`.** Anything built locally in them, such as a full-country PyLovo
grid, is lost.

To reload one set, drop only its database and run `fixtures/load.sh <set>`.
