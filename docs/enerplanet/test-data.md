---
audience: developer
---

# Test Data

The heat workflow smoke test needs 3D building data, a weather archive and a
PyLovo grid. Producing those from source means downloading tens of gigabytes
and running import pipelines. Instead, small extracts covering one area are
committed to this repository under `fixtures/` and loaded by one command.

## Before you clone

Install Git LFS first. The fixtures and the smoke test's GeoJSON are LFS
objects, and a clone made without it gives pointer files of a few hundred bytes
that load without error and fail later as unreadable data.

```bash
git lfs install
```

Budget 27 GB of disk, and 35 GB to work in comfortably. The figures below
were measured on amd64 Linux on 2026-09-27 and drift as base images change, so
treat them as an order of magnitude.

About 2.2 GB is the checkout, and `npm install` adds 1 GB of `node_modules`.
enerplanet-pylovo accounts for 1.6 GB of it, most of that LFS history. The
fixtures are 39 MB. simulation-engine is not cloned by `make setup`; `make
webservice` clones it (6 GB) when the Calliope/PyPSA simulation is needed.

Container images take about 22 GB. The largest are PyLovo's API at 6.5 GB,
which `make setup` builds locally, and weather at 4.9 GB.

Adding up what each image reports gives a larger number, around 35 GB, because
a layer shared by several images is reported by each of them while being stored
once. BuEM's model image is the clearest case: it reports 4.1 GB but shares all
but 18 MB with weather.

The fixtures avoid the source data downloads, which dwarf all of this: a
weather archive alone runs to tens of gigabytes. They do not make the images
smaller.

## Loading

First time, from a fresh clone:

```bash
make setup    # includes the fixtures
```

`make setup` runs the loader after the service checkouts exist. On a checkout
that already works, or after pulling a new fixture, load them on their own
instead:

```bash
make fixtures
```

Then run the smoke test:

```bash
cd enerplanet/backend && ./scripts/smoke/heat_workflow_smoke.sh
```

It should report `0 failure(s)`. If it fails at step 2a with `HTTP 000`,
TentaCron is not on the port `repos.conf` allocates it; see the note on
existing `.env` files under Connection settings.

## What is loaded

The fixtures cover four regions, each complete enough that a model drawn
anywhere inside them resolves. Each appears by name under "Go to region" in the
frontend, which zooms to the covered extent, so there is no bounding box to
memorise and no hunting for the part of a city that happens to hold data.

| Region | Extent | 3D source | CRS |
|---|---|---|---|
| Loenen, Netherlands | postcode 7371 | 3DBAG | EPSG:28992 |
| Bremen, Germany | LoD2 tile `LoD2_32_486_5882_2_HB`, 8.7909 53.0873 to 8.8208 53.1053 | LoD2 Land Bremen | EPSG:25832 |
| Vienna, Austria | postcodes 1010, 1070, 1080 and 1090, clipped to `fixtures/pylovo/vienna_coverage.wkt` | Generalisiertes Dachmodell, Stadt Wien | EPSG:31256 |
| Brno, Czechia | box 16.603 49.190 to 16.613 49.200 in postcode 60200, `fixtures/pylovo/brno_box.wkt` | 3D model budov, Brno | EPSG:5514 |

The region is defined by whichever is narrower, the postcode or the 3D source.
Loenen's postcode falls inside the 3DBAG cut, so it is used whole. Bremen's
tile straddles five postcodes and covers none of them completely, so the five
are clipped to the tile instead. Brno has 3D data for the whole city, so it is
cut to a box of about 0.7 by 1.1 km in the centre to keep the fixture small.
Clipping the geometry rather than shipping the
administrative boundary is what keeps the extent the UI advertises equal to the
extent that can be served.

!!! warning "Both weather cuts together need weather 2.0.1 or newer"
    Germany's country bounding box contains the Dutch fixture area, so a
    Loenen query matches both cuts. Releases before 2.0.1 took the first
    matching box and could answer a Dutch point from the German archive,
    returning a series from a cell hundreds of kilometres away with no error
    and a demand figure that looks plausible. 2.0.1 resolves the nearest
    covering archive instead, and rejects a nearest grid cell further than
    20 km.

PyLovo stores its geometry in EPSG:3035 and City2TABULA in a country-specific
CRS, EPSG:28992 for the Netherlands, EPSG:25832 for Germany, EPSG:31256 for
Austria and EPSG:5514 for Czechia. Neither is
reprojected at load time, because the join between them is precomputed in
`building_link`.

| Fixture | Size | Populates | Lands in |
|---|---|---|---|
| `city2tabula/city2tabula_loenen.sql.gz` | 8.1 MB | 3,106 buildings, 53,043 surfaces, 3,106 links (2,382 matched) | a new `<DB_NAME>_nl` database |
| `city2tabula/tabula_nl.sql.gz` | 9 kB | 135 Dutch TABULA archetype rows | the `tabula` schema of `<DB_NAME>_nl` |
| `city2tabula/tabula_de.sql.gz` | 18 kB | 232 German TABULA archetype rows | the `tabula` schema of `<DB_NAME>_de` |
| `city2tabula/city2tabula_bremen.sql.gz` | 19 MB | 9,284 buildings, 137,276 surfaces, 9,284 links (7,827 matched) | a new `<DB_NAME>_de` database |
| `city2tabula/tabula_at.sql.gz` | 16 kB | 165 Austrian TABULA archetype rows | the `tabula` schema of `<DB_NAME>_at` |
| `city2tabula/city2tabula_vienna.sql.gz` | 17 MB | 1,318 buildings, 95,807 surfaces, 1,318 links (1,219 matched) | a new `<DB_NAME>_at` database |
| `city2tabula/tabula_cz.sql.gz` | 9 kB | 84 Czech TABULA archetype rows | the `tabula` schema of `<DB_NAME>_cz` |
| `city2tabula/city2tabula_brno.sql.gz` | 4.8 MB | 778 buildings, 33,631 surfaces, 778 links (691 matched) | a new `<DB_NAME>_cz` database |
| `weather/…/netherlands/…/COSMO_REA6_2018_annual_all_attrs.nc` | 1.9 MB | full-year hourly weather, 3×3 cells, 13 variables | the weather checkout's `data/` |
| `weather/…/germany/…/COSMO_REA6_2018_annual_all_attrs.nc` | 3.1 MB | full-year hourly weather, 4×4 cells, 13 variables | the weather checkout's `data/` |
| `weather/…/austria/…/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | full-year hourly weather, 4×4 cells around Vienna, 13 variables | the weather checkout's `data/` |
| `weather/…/czech_republic/…/COSMO_REA6_2018_annual_all_attrs.nc` | 3.3 MB | full-year hourly weather, 4×4 cells around Brno, 13 variables | the weather checkout's `data/` |
| `pylovo/pylovo_fixture.sql.gz` | 7.8 MB | 221 grids, 9,073 buildings, 17,782 lines, 39 transformers over 11 postcodes, plus their inputs and reference tables | the existing pylovo database |

The pylovo fixture carries its own schema and restores into an empty database.
The schema is rendered from pylovo's `config/config_table_structure.py`
CREATE_QUERIES rather than dumped from a running instance, so it carries no
drift from whichever machine produced it.

The City2TABULA fixture serves data; it cannot rebuild it. The raw CityGML
import schemas are excluded, so feature extraction cannot be re-run from it,
and neither can the PyLovo link step, whose results are precomputed in
`building_link`. The TABULA cuts are separate because classification reads
`tabula.tabula`: a building cut without one answers reads but fails any
pipeline run with `relation "tabula.tabula" does not exist`.

### Regenerating them

`fixtures/export_pylovo.py` produces the pylovo fixture:

```bash
./fixtures/export_pylovo.py --scope NL:7371 \
    --scope DE:28195 --scope DE:28209 --scope DE:28215 \
    --scope DE:28217 --scope DE:28219 \
    --scope AT:1010 --scope AT:1070 --scope AT:1080 --scope AT:1090 \
    --scope CZ:60200 \
    --clip DE:fixtures/pylovo/bremen_tile.wkt \
    --clip AT:fixtures/pylovo/vienna_coverage.wkt \
    --clip CZ:fixtures/pylovo/brno_box.wkt \
    --state-name NL:gelderland=Gelderland \
    --state-name "AT:wien=Wien (Vienna)" \
    --state-name "CZ:jihomoravsky=Jihomoravský kraj (Brno)" \
    --source-db <populated pylovo db> -o fixtures/pylovo/pylovo_fixture.sql
```

`--clip` cuts a country to its 3D source extent and clips the postcode
geometries to match. The Brno postcode row is then edited by hand: its `note`
becomes `60200 Czechia` and its `qkm` the box's area, so the fixture carries
no attribute of the source postcode dataset (see `fixtures/ATTRIBUTION.md`). `--state-name` sets the label the region list shows:
PyLovo fills `state_name` from `regions.yaml` during a constructor run, which a
fixture-loaded database never has, so without it a reader sees whatever the
source database happened to hold.

The fixtures follow the deployed layout: one pylovo database holding every
country, and one City2TABULA database per country, each linked to that single
pylovo database. Each country's City2TABULA fixture is produced in three steps:

1. Extract the country's 3D source into its own City2TABULA database.
2. Truncate `building_link`, then run `-link-pylovo` with `PYLOVO_FDW_*` pointing
   at the pylovo database the fixture above is exported from.
3. `pg_dump --schema=city2tabula`, with `lod2_child_feature`,
   `lod2_child_feature_geom_dump` and `lod2_surface_raw` truncated first (the
   `lod3_` equivalents for an LoD3 source, and `_building_part` where it
   exists). Nothing served reads those tables, and they triple the fixture size.

Link against the pylovo database itself over `postgres_fdw`, not against a copy
of its `res` and `oth` tables. The link records OSM ids, so a link made against
different pylovo data points at buildings the pylovo fixture may not contain.

| Variable | Value |
|---|---|
| `PYLOVO_FDW_HOST` / `PYLOVO_FDW_PORT` | the pylovo Postgres, as reached from inside `city2tabula-db` |
| `PYLOVO_FDW_DBNAME` | the populated pylovo database |
| `PYLOVO_FDW_USER` / `PYLOVO_FDW_PASSWORD` | a role with `SELECT` on `public.res` and `public.oth` only |

!!! warning "The host is resolved by the database server, not by `c2t`"
    `postgres_fdw` connects from the `city2tabula-db` container, which is on
    `city2tabula_default` while the platform Postgres is on `spatialhub-net`.
    `localhost` and `postgres` do not resolve there. The gateway of
    `city2tabula_default` on the published port 5433 reaches it; so does
    attaching `city2tabula-db` to `spatialhub-net` and using `postgres:5432`,
    which does not depend on the port being published.

!!! note "One City2TABULA database per country"
    `fixtures/load.sh` creates `<DB_NAME>_<cc>` from one file and skips a
    database that already exists. Every region of a country therefore goes into
    that country's single dump; a second file for the same country is not
    loaded.

The link query does not push its area filter to the pylovo server: each batch
reads the whole `res` table across the connection and filters locally. That is
a few seconds for a city-sized fixture and grows with the size of the pylovo
database, so a country-scale link is slow.

!!! warning "Order matters, and the link step is a silent no-op"
    `building_link` is precomputed against PyLovo, so the pylovo fixture has to
    be produced and loaded before City2TABULA is linked and dumped. Re-running
    `-link-pylovo` over an already-populated `building_link` does nothing and
    still exits 0, logging `No LOD2 buildings with footprints found`: the
    batching query only selects buildings with no link yet. Truncate
    `building_link` first.

## The stack runs on plain HTTP

Every heat service runs its `http` environment. Nothing in this setup terminates
TLS, so there is no certificate to generate, no `caddy trust` step, and no
browser warning to click through. A reverse proxy is not started at all.

That is the deployed shape too, not a local shortcut: the platform terminates
TLS at its own front door and the services behind it speak HTTP. Each repo also
ships an `https` environment for a standalone deployment that has no such front
door; nothing here uses it.

Ports come from `repos.conf`, which is the one place to change them.

| Service | Port | Who calls it |
|---|---|---|
| Frontend (Vite) | 3000 | you |
| Backend API | 8000 | the frontend, and any other UI |
| TentaCron | 8400 | the backend only |
| meme | 8401 | TentaCron only |
| buem-gateway | 8402 | TentaCron only |
| ignis | 8403 | TentaCron only |
| City2TABULA | 8404 | TentaCron only |
| weather | 8406 | TentaCron only |

Only the backend is called from a browser. The 84xx services talk to each other
by container name on the `tentacron-net` Docker network, so their published
ports exist for inspection with curl rather than for the application path. The
range avoids the crowded 8080 and 9000 neighbourhoods, 8080 in particular being
Keycloak's.

## Using the fixtures in the frontend

```bash
cd enerplanet/frontend && npm run dev
```

Vite serves on port 3000 and proxies `/api` to the backend on 8000. The
`@spatialhub/*` packages do not need building first: `vite.config.ts` aliases
them to `libs/*/src`. Sign in with the same account the smoke test uses,
`admin@example.de` / `12345678`, through the backend rather than Keycloak
(`VITE_SSO_ENABLED` is false).

Two limits determine where an area can be drawn. Both produce an empty result
that looks like missing data.

A separate UI can call the same backend without being part of this frontend.
Serve it on port 3000 or 5173, which the backend's CORS allowlist accepts, and
authenticate the way the frontend does: `GET /api/csrf-token`, then
`POST /api/login`, then send every request with credentials included and the
`X-CSRF-Token` header on anything that is not a GET.

!!! warning "The allowlist is exact, so pin your port"
    Only `localhost:3000` and `localhost:5173` are accepted, plus whatever
    `APP_URL` is set to. Any other port is refused, and so is `127.0.0.1` on an
    accepted port, because the match is on the exact string. A dev server that
    silently falls back to 5174 when 5173 is busy produces a CORS failure that
    reads like an auth problem, so pin the port rather than letting it drift.

    Do not repoint `APP_URL` at your own origin to get around this. It is also
    the callback URL that PyLovo and the simulation engine post results back
    to, and changing it breaks result delivery.

!!! warning "The map does not open where the data is"
    A fresh map centres on Deggendorf, about 700 km from anything the fixtures
    cover, so it opens on an empty view. Choose **Gelderland** from the region
    selector: that fits the view to the region's bounding box, which sits
    essentially on top of the fixture area.

!!! warning "Draw inside the grid extent"
    Drawing an area calls PyLovo's `generate-grid`, which computes from
    PyLovo's own input tables rather than reading the four grids the fixture
    ships. Those inputs cover only the ground the grids occupy, so a polygon
    drawn inside

    ```
    6.0162 52.0988  to  6.0384 52.1130
    ```

    returns buildings, and one drawn outside it returns none however much map
    is visible. This is the sharpest limit of the fixture set.

## Example models

A development setup opens with one saved model per fixture region, so the heat
workflow and the 3D building view can be tried without drawing an area first.

| Model | Buildings | Grid | Period |
|---|---|---|---|
| Example: Loenen (NL) | 8 | 2585 | 2018 |
| Example: Bremen (DE) | 7 | 29 | 2018 |

Every building in both has a City2TABULA envelope, and the period matches the
weather fixtures. Loenen's building 268428040 was edited in the 3D view and
saved (attached neighbours set to terraced), so it carries a stored BuEM
building: opening it, and running the model, take the saved values rather
than City2TABULA's.

They are a starting point for work that begins from a saved model. Work on
creating a model (drawing an area, grid generation, building selection) draws
in the full regions under What is loaded, so it is not tested only against a
handful of buildings. `make dev-bg` creates them once the backend is up, owned by
the dev admin and in its default workspace; run `make example-models` to create
them against a backend started some other way. A model whose title already
exists is left alone.

!!! warning "Development only"
    `fixtures/example_models.sh` does nothing unless `enerplanet/backend/.env`
    sets `APP_ENV=development` explicitly. An unset `APP_ENV` is not enough,
    because the backend itself treats unset as development.

Each file under `fixtures/models/` is the request body the frontend sends when
a model is saved. To replace one, save the model in the frontend against the
fixtures, then export its row from the `models` table as
`{title, description, from_date, to_date, resolution, coordinates, config}`.
Keep the drawn area inside the fixture extent, or its buildings resolve no
envelope.

## Connection settings

The City2TABULA restore runs `psql` inside the `city2tabula-db` container,
because that database publishes no host port and is the one
`city2tabula` reads. The defaults mirror the compose file's own, so the
loader and the server derive the same database from the same inputs. Override
any of these to restore elsewhere:

| Variable | Default |
|---|---|
| `C2T_DB_CONTAINER` | `city2tabula-db` |
| `C2T_DB_NAME` | `city2tabula`, with `_nl` or `_de` appended |
| `C2T_DB_USER` / `C2T_DB_PASSWORD` | `postgres` |

!!! warning "`environment/http/docker.env` is not the source"
    That file configures the interactive pipeline service, which points at a
    host Postgres under a different database name. A loader following it
    restores the fixture where the server never reads, leaving a stray
    `city2tabula_test_*` database on the host and a server still reporting no
    data for the area.

!!! warning "An existing `.env` keeps its old TentaCron port"
    The backend reaches TentaCron on the port `repos.conf` allocates it, 8400.
    `make env-setup` copies `.env.example` only when no `.env` exists, so a
    checkout whose `.env` predates that allocation keeps whatever it had and
    the backend calls a port nothing listens on. The smoke test reports it as
    step 2a failing with `HTTP 000`. Fix it in `enerplanet/backend/.env`:

    ```
    TENTACRON_SERVICE_URL=http://localhost:8400
    ```

The pylovo restore takes the database name, user and password from that
checkout's `.env.docker`, falling back to `.env.example`, and the host and port
from `enerplanet/backend/.env`. Those files disagree deliberately: pylovo's
`HOST`/`PORT` are compose-internal (`postgres:5432`), while the same instance is
published to the host on `DB_PORT`, which is 5433. Overrides are
`PYLOVO_DB_NAME`, `PYLOVO_DB_HOST`, `PYLOVO_DB_PORT`, `PYLOVO_DB_USER` and
`PYLOVO_DB_PASSWORD`.

## Traps

!!! warning "`fixtures/load.sh` does not pull LFS objects"
    `make fixtures` runs `git lfs pull` first; calling the loader directly
    does not. On a checkout made without Git LFS (see Before you clone) that
    is the difference between restoring the fixture and restoring a pointer
    file.

    The smoke test's own `loenen_buildings.geojson` is an LFS object too, so
    such a checkout fails the smoke whether or not any fixture is loaded.

!!! info "Gelderland carries no \"3D\" badge, and that is correct"
    The region selector badges a region as 3D from PyLovo's `has_3d`, which
    means LiDAR building heights in PyLovo's own tables. PyLovo has none for
    the Netherlands, so the badge is absent for the one region these fixtures
    make fully modellable. Nothing is gated on it.

    It is the same shape as the other divergences here: PyLovo and City2TABULA
    both describe these buildings, for different consumers, and disagree on
    classification, footprint area and now 3D heights. Neither is authoritative
    for the other's purpose. The 3D that makes Loenen work is City2TABULA's
    3DBAG envelopes, which reach the model by a different route entirely.

!!! info "A database existing is not evidence its data loaded"
    City2TABULA creates a database per country on demand. Finding one is no
    guarantee it has tables, and a partially loaded one answers reads while
    failing any pipeline run — later, and less obviously.

## Attribution

The fixtures are extracts of third-party datasets under licences requiring
credit and a statement of modification. `fixtures/ATTRIBUTION.md` carries both
for every extract in this repository, the smoke test's own GeoJSON fixtures
included, and must be updated whenever one is added or replaced.

Sources currently redistributed: 3DBAG, LoD2 Land Bremen, Stadt Wien's
Generalisiertes Dachmodell, Brno's 3D model budov, Statistik Austria
municipal boundaries, CBS postcode areas, ČSÚ postcode polygons and
Deutscher Wetterdienst's COSMO-REA6 (all CC BY 4.0); the TABULA typology
(IEE TABULA + EPISCOPE terms of use, attribution required); and
OpenStreetMap via PyLovo (ODbL 1.0).
