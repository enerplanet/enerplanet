---
audience: developer
---

# Test Data

The heat workflow smoke test needs 3D building data, a weather archive and a
PyLovo grid. Producing those from source means downloading tens of gigabytes
and running import pipelines. Instead, small extracts covering one area are
committed to this repository under `fixtures/` and loaded by one command.

## Loading

```bash
make setup      # includes the fixtures
make fixtures   # or load them on their own, at any time
```

`make setup` runs the loader after the service checkouts exist. Run
`make fixtures` on its own when you already have a working checkout, or after
pulling a new fixture.

Then run the smoke test:

```bash
cd enerplanet/backend && ./scripts/smoke/heat_workflow_smoke.sh
```

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

The pylovo restore takes the database name, user and password from that
checkout's `.env.docker`, falling back to `.env.example`, and the host and port
from `enerplanet/backend/.env`. Those files disagree deliberately: pylovo's
`HOST`/`PORT` are compose-internal (`postgres:5432`), while the same instance is
published to the host on `DB_PORT`, which is 5433. Overrides are
`PYLOVO_DB_NAME`, `PYLOVO_DB_HOST`, `PYLOVO_DB_PORT`, `PYLOVO_DB_USER` and
`PYLOVO_DB_PASSWORD`.

## Traps

!!! warning "Run `git lfs pull` first"
    Fixtures are Git LFS objects. A clone without them gives you pointer
    files of a few hundred bytes, which load without error and then fail
    later as unreadable data. `make fixtures` runs `git lfs pull` for you;
    a manual `fixtures/load.sh` does not.

    This is not specific to the fixtures. The smoke test's own
    `loenen_buildings.geojson` is already an LFS object, so a clone without
    `git lfs pull` fails the smoke whether or not you load any fixture.

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
