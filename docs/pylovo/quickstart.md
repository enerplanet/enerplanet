# Quickstart

PyLovo runs in Docker and requires an external PostgreSQL container with PostGIS and pgRouting.

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- Git with Git LFS
- A running PostgreSQL container named `postgres` with PostGIS/pgRouting (provided by the EnerPlanET `platform-core` stack)

## Setup

```bash
git clone https://github.com/THD-Spatial/pylovo.git
cd pylovo

git lfs install
git lfs pull          # Pulls raw_data.7z (~500 MB)

make setup            # Pull LFS, create DB, build image, start services
```

`make setup` runs these steps:
1. `git lfs pull` — fetch raw geospatial data
2. `docker exec postgres psql ...` — create `pylovo_db` with PostGIS + pgRouting
3. `docker compose build` — build the PyLovo image (extracts `raw_data.7z`)
4. `docker compose up -d` — start nginx, redis, and three API workers

**Verify:**
```bash
make status           # All containers should show "Up"
curl http://localhost:8086/health
```

## Environment Configuration

Create a `.env` file in the pylovo root:

```bash
DBNAME=pylovo_db
USER=postgres
PASSWORD=postgres
HOST=host.docker.internal
PORT=5433
API_HOST=0.0.0.0
API_PORT=8086
```

## Generating Grids

### Full Pipeline (Recommended)

```bash
make process COUNTRY=netherlands STATE=flevoland WORKERS=10
```

This runs three steps in sequence:
1. **datapipeline** — Download OSM buildings, roads, and transformer locations
2. **constructor** — Load data into PostgreSQL
3. **grid** — Generate synthetic low-voltage grids (parallelised across postcodes)

### Individual Steps

```bash
make datapipeline COUNTRY=germany STATE=hamburg
make constructor  COUNTRY=germany STATE=hamburg
make grid         COUNTRY=germany STATE=hamburg WORKERS=10
```

### Example: Netherlands (Flevoland — smallest province, good for testing)

```bash
make prepare-netherlands      # Download CBS boundary data (~2 min, one-time)
make datapipeline COUNTRY=netherlands STATE=flevoland
make constructor  COUNTRY=netherlands STATE=flevoland
make grid         COUNTRY=netherlands STATE=flevoland WORKERS=10
```

Expected total duration: ~45–60 minutes.

## Country Data Preparation

Germany's postcode boundaries are included. Other countries require a one-time download:

```bash
make prepare-netherlands      # Downloads CBS population data (requires kwb.zip — see note)
make prepare-austria          # Downloads GADM districts automatically
make prepare-country COUNTRY=spain
make prepare-country COUNTRY=czech_republic
```

!!! note "Netherlands CBS Data"
    Download *Kerncijfers wijken en buurten 2022* (Excel/ZIP) manually from [CBS Open Data](https://www.cbs.nl) and place `kwb.zip` in `raw_data/netherlands/downloads/` before running `make prepare-netherlands`.

## Available German States

`berlin`, `hamburg`, `bayern`, `nordrhein_westfalen`, `sachsen`, `thueringen`, `hessen`, `niedersachsen`, `bremen`, `saarland`, `rheinland_pfalz`, `sachsen_anhalt`, `schleswig_holstein`, `mecklenburg_vorpommern`, `brandeburg`, `baden_wuerttemberg`

## Makefile Command Reference

| Command | Description |
|---|---|
| `make setup` | Full setup (LFS + DB + build + start) |
| `make up` / `make down` | Start / stop containers |
| `make restart` | Restart containers |
| `make logs` | View container logs |
| `make status` | Show container status |
| `make shell` | Open shell in container |
| `make process COUNTRY=X STATE=Y WORKERS=N` | Full pipeline |
| `make datapipeline COUNTRY=X STATE=Y` | OSM data download |
| `make constructor COUNTRY=X STATE=Y` | Database construction |
| `make grid COUNTRY=X STATE=Y WORKERS=N` | Grid generation |
| `make rebuild` | Force rebuild without cache |

## Troubleshooting

**PostgreSQL checkpoint warnings during import**

Increase WAL size to reduce checkpoint frequency:
```bash
docker exec postgres psql -U postgres -c "ALTER SYSTEM SET max_wal_size = '4GB';"
docker exec postgres psql -U postgres -c "ALTER SYSTEM SET checkpoint_completion_target = '0.9';"
docker exec postgres psql -U postgres -c "SELECT pg_reload_conf();"
```

**LFS files missing**
```bash
git lfs pull --include="*.7z"
```

**Database connection failed** — replace credentials with the values from your `.env`:
```bash
docker exec pylovo-api-1 python -c "
import psycopg2
conn = psycopg2.connect(host='host.docker.internal', port=5433,
    dbname='pylovo_db', user='<DB_USER>', password='<DB_PASSWORD>')
print('Connected'); conn.close()"
```
