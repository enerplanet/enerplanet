# Fixtures

Small extracts that let the heat workflow run without any data pipeline: no
weather download, no CityGML import, no grid generation. `make setup` loads
them; `make fixtures` reloads them on a working checkout. Every file except
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

How the fixtures were produced, and how to regenerate them, is in
[docs/enerplanet/test-data.md](../docs/enerplanet/test-data.md).

## Sites

| Site | Country | Area | 3D source |
|---|---|---|---|
| Loenen | NL | postcode 7371 | 3DBAG |
| Bremen | DE | LoD2 tile `LoD2_32_486_5882_2_HB`, 8.7909 53.0873 to 8.8208 53.1053 | LoD2 Land Bremen |
| Vienna | AT | postcodes 1010, 1070, 1080 and 1090, clipped to `pylovo/vienna_coverage.wkt` | Generalisiertes Dachmodell (LoD2), Stadt Wien |
| Brno | CZ | box 16.603 49.190 to 16.613 49.200 inside postcode 60200, `pylovo/brno_box.wkt` | 3D model budov, Brno |

## Files

| File | Size | Used by | Site | Purpose | Loaded by |
|---|---|---|---|---|---|
| `city2tabula/city2tabula_loenen.sql.gz` | 5.7 MB | City2TABULA | Loenen | building envelopes, surfaces and links to PyLovo buildings | `load.sh city2tabula`, into `<DB_NAME>_nl` |
| `city2tabula/city2tabula_bremen.sql.gz` | 20 MB | City2TABULA | Bremen | as above | `load.sh city2tabula`, into `<DB_NAME>_de` |
| `city2tabula/tabula_nl.sql.gz` | 12 kB | City2TABULA | NL | Dutch TABULA archetypes, needed to classify buildings | `load.sh city2tabula`, into `<DB_NAME>_nl` |
| `city2tabula/tabula_de.sql.gz` | 20 kB | City2TABULA | DE | German TABULA archetypes | `load.sh city2tabula`, into `<DB_NAME>_de` |
| `city2tabula/city2tabula_vienna.sql.gz` | 15 MB | City2TABULA | Vienna | as above | `load.sh city2tabula`, into `<DB_NAME>_at` |
| `city2tabula/tabula_at.sql.gz` | 16 kB | City2TABULA | AT | Austrian TABULA archetypes | `load.sh city2tabula`, into `<DB_NAME>_at` |
| `city2tabula/city2tabula_brno.sql.gz` | 4.7 MB | City2TABULA | Brno | as above | `load.sh city2tabula`, into `<DB_NAME>_cz` |
| `city2tabula/tabula_cz.sql.gz` | 9 kB | City2TABULA | CZ | Czech TABULA archetypes | `load.sh city2tabula`, into `<DB_NAME>_cz` |
| `pylovo/pylovo_fixture.sql.gz` | 7.8 MB | PyLovo | all four | low-voltage grids, buildings and their inputs, for every site in one database | `make pylovo-fixture` (`load.sh pylovo`), before PyLovo starts |
| `pylovo/bremen_tile.wkt` | 4 kB | `export_pylovo.py` | Bremen | the clip polygon the PyLovo fixture is cut to | not loaded; regeneration input |
| `pylovo/vienna_coverage.wkt` | 5 kB | `export_pylovo.py` | Vienna | as above | not loaded; regeneration input |
| `pylovo/brno_box.wkt` | 4 kB | `export_pylovo.py` | Brno | as above | not loaded; regeneration input |
| `weather/cosmo_rea6/netherlands/output/COSMO_REA6_2018_annual_all_attrs.nc` | 1.9 MB | weather-serve | Loenen | hourly 2018 weather, 3×3 cells | `load.sh weather`, into the weather checkout's `data/` |
| `weather/cosmo_rea6/germany/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.1 MB | weather-serve | Bremen | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `weather/cosmo_rea6/austria/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | weather-serve | Vienna | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `weather/cosmo_rea6/czech_republic/output/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | weather-serve | Brno | hourly 2018 weather, 4×4 cells | `load.sh weather` |
| `models/loenen.json`, `models/bremen.json` | 96 kB, 132 kB | backend | Loenen, Bremen | example saved models, development only | `make example-models` (`example_models.sh`) |

## Weather per provider

A model uses one weather archive for all of its simulations. Each provider
needs its own cut per site, in the layout weather-serve reads:
`<provider>/<country>/output/<PROVIDER>_2018_annual_all_attrs.nc`.

| Provider | Loenen (NL) | Bremen (DE) | Vienna (AT) | Brno (CZ) |
|---|---|---|---|---|
| `cosmo-rea6` | committed | committed | committed | committed |
| `era5-land` | not yet | not yet | not yet | not yet |
| `merra-2` | not yet | not yet | not yet | not yet |

## Scripts

| Script | Does |
|---|---|
| `load.sh` | restores every fixture set, or only the named ones (`weather`, `city2tabula`, `pylovo`); never overwrites existing data, except weather files under `FORCE=1` |
| `example_models.sh` | creates the example models through the backend API; refuses unless `APP_ENV=development` |
| `export_pylovo.py` | regenerates the PyLovo fixture from a populated PyLovo database |

## Reloading

`load.sh` skips a City2TABULA database that already exists and a PyLovo
database whose `grid_result` has rows; `FORCE=1` replaces only the weather
files. Reloading over existing data therefore means dropping the databases
first. Run from the repository root:

1. Fetch the current fixtures: `git pull && git lfs pull --include=fixtures`.
2. Stop PyLovo with `make -C dependencies/enerplanet-pylovo down`. Its
   `make dev` loads the full Bremen dump when `pylovo_db` is missing, so it
   must stay down until step 5.
3. Drop the City2TABULA databases, one per country, inside `city2tabula-db`:

   ```bash
   for c in nl de at cz; do
     docker exec city2tabula-db psql -U postgres -c "drop database if exists city2tabula_$c with (force)"
   done
   ```

   The prefix is `C2T_DB_NAME`, default `city2tabula`.
4. Drop the PyLovo database on the platform Postgres. The name and user are
   `DBNAME` and `DBUSER` in `dependencies/enerplanet-pylovo/.env.docker`, the
   port is `DB_PORT` in `enerplanet/backend/.env`:

   ```bash
   psql -h localhost -p 5433 -U postgres -d postgres -c 'drop database if exists pylovo_db with (force)'
   ```

5. Reload with `FORCE=1 make fixtures`. `city2tabula-db` must be running
   (`make city2tabula`). Any `SKIP` line for `city2tabula` or `pylovo` means
   its database was not dropped.
6. Start PyLovo with `make pylovo`, and restart City2TABULA with
   `make city2tabula`.

**Steps 3 and 4 delete data.** Anything built locally in those databases, such
as a full-country PyLovo grid, is lost.

To reload one set, drop only its database and run `fixtures/load.sh <set>`.
