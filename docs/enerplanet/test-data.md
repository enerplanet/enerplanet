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

Budget about 8 GB of disk for a fresh checkout before any container starts.
`make setup-repos` clones every dependency, and two of them carry large LFS
histories: simulation-engine is 6 GB and enerplanet-pylovo 1.6 GB. The fixtures
themselves are 3 MB.

## Loading

First time, from a fresh clone:

```bash
docker network create building-simulation_default   # see the note below
make setup                                          # includes the fixtures
```

`make setup` runs the loader after the service checkouts exist. On a checkout
that already works, or after pulling a new fixture, load them on their own
instead:

```bash
make fixtures
```

!!! warning "Create that network first, or `make setup` stops part-way"
    City2TABULA's compose declares the network `building-simulation_default`
    as external, and nothing creates it: ignis used to, under its old compose
    project name, and no longer does. Without it `docker compose up` exits 1
    with `network building-simulation_default declared as external, but could
    not be found`, and `make setup` stops at that target without reaching the
    fixtures step.

    Creating it by hand is a temporary measure until City2TABULA drops the
    dependency. It is safe: an `external` network is used as found, so the
    empty label set a hand-made network carries is not checked.

Then run the smoke test:

```bash
cd enerplanet/backend && ./scripts/smoke/heat_workflow_smoke.sh
```

It should report `0 failure(s)`. If it fails at step 2a with `HTTP 000`,
TentaCron is not on the port `repos.conf` allocates it; see the note on
existing `.env` files under Connection settings.

## What is loaded

The distributed fixtures cover Loenen, Netherlands, the default smoke site.
The City2TABULA and PyLovo fixtures cover the same ground: the box 6.0162
52.0988 to 6.0384 52.1130, which is the extent of the four low-voltage grids
PyLovo ships, so every building with a grid behind it also has 3D data.

The second smoke site, Bremen, exercises a different 3D dataset in a different
CRS against the same single PyLovo database. Only its TABULA cut is
distributed; the building fixture is not (see the warning below).

PyLovo stores its geometry in EPSG:3035 and City2TABULA in a country-specific
CRS, EPSG:28992 for the Netherlands and EPSG:25832 for Germany. Neither is reprojected at load time, because the join between them
is precomputed in `building_link`. It matters only to someone re-running the
link step, which these fixtures cannot do.

| Fixture | Size | Populates | Lands in |
|---|---|---|---|
| `city2tabula/city2tabula_loenen.sql.gz` | 1.1 MB | 617 buildings, 11,210 surfaces, 617 links (488 matched), 47 TABULA variants | a new `<DB_NAME>_nl` database |
| `city2tabula/tabula_nl.sql.gz` | 9 kB | 135 Dutch TABULA archetype rows | the `tabula` schema of `<DB_NAME>_nl` |
| `city2tabula/tabula_de.sql.gz` | 18 kB | 232 German TABULA archetype rows | the `tabula` schema of `<DB_NAME>_de` |
| `weather/…/COSMO_REA6_2018_annual_all_attrs.nc` | 1.9 MB | full-year hourly weather, 3×3 cells, 13 variables | the weather checkout's `data/` |
| `pylovo/pylovo_loenen_fixture.sql.gz` | 230 KB | 4 grids, 249 buildings, 479 lines, 4 transformers, plus their inputs and reference tables | the existing pylovo database |

The pylovo fixture is data only and assumes the pylovo schema already exists,
which pylovo's own table constructor creates. The loader says so rather than
emitting an INSERT failure per table.

The City2TABULA fixture serves data; it cannot rebuild it. The raw CityGML
import schemas are excluded, so feature extraction cannot be re-run from it.
The TABULA cuts are separate because classification reads `tabula.tabula`: a
building cut without one answers reads but fails any pipeline run with
`relation "tabula.tabula" does not exist`.

!!! warning "The German fixture is not in this repository"
    `city2tabula_bremen.sql.gz` is gitignored. It derives from Bremen's LoD2
    model, whose licence the provider has not stated, so redistribution is
    blocked until that is confirmed. See `fixtures/ATTRIBUTION.md`.

    The loader handles both countries. With the file absent it loads the Dutch
    fixture and skips the German one without failing, so `SMOKE_SITE=bremen`
    needs a locally built cut.

The loader never overwrites. A file already in place is skipped, and an
existing database is left alone rather than replaced — a developer who has
built the real archives locally would otherwise lose them to a test cut.

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

## Connection settings

The City2TABULA restore runs `psql` inside the `city2tabula-db` container,
because that database publishes no host port and is the one
`city2tabula-server` reads. The defaults mirror the compose file's own, so the
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

!!! warning "City2TABULA will not start without `CITYDB_TOOL_PATH`"
    Its startup check requires the variable to be non-empty, even when only
    serving data. It is not read unless you run the extraction pipeline, and
    nothing checks that the path exists, so any value satisfies it:

    ```bash
    CITYDB_TOOL_PATH=unused
    ```

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

Sources currently redistributed: 3DBAG (CC BY 4.0), COSMO-REA6
(Hans-Ertel-Centre for Weather Research, GeoNutzV) and OpenStreetMap via
PyLovo (ODbL 1.0).
