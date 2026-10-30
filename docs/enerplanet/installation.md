---
audience: developer
---

# Installation

```bash
git lfs install
git clone https://github.com/enerplanet/enerplanet.git
cd enerplanet
make setup
```

Open <http://localhost:8000> and sign in as `admin@example.de` / `12345678`.
The map opens with two example models, one in Bremen and one in Loenen, whose
buildings all have 3D data.

The root `Makefile` is the only entry point. Every command on this page is a
`make` target; ports and pinned versions live in `repos.conf`.

## Two ways to run

| Mode | Start | Backend and frontend | Use it for |
|---|---|---|---|
| Container | `make setup` once, then `make up` | One container, `energy-backend`, serves the built frontend on <http://localhost:8000> | Checking the stack as a server runs it |
| Development | `make dev` | Backend on the host on port 8000, Vite on <http://localhost:3000> with hot reload, in one tmux window | Changing backend or frontend code |

Both modes use the same Docker services and data. `make dev` stops the
`energy-backend` container, because both use port 8000; `make up` starts it
again.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Git LFS | 3.x | `git lfs version` |
| GNU Make | any | `make --version` |
| Docker Engine, or Docker Desktop | Compose plugin 2.24 or newer | `docker compose version` |
| Go, Node.js, tmux | Go 1.26, Node.js 22 | development mode only |

The user running `make` must be able to run `docker` without `sudo`.

| Resource | Minimum |
|---|---|
| OS | Linux (amd64). Windows works through WSL2 with Docker Desktop. |
| Memory for Docker | 16 GB; Calliope runs of larger models need more (see the warning below) |
| Free disk | 100 GB for a first setup (see [Disk use](#disk-use)) |

!!! warning "Install Git LFS before cloning"
    The test fixtures are Git LFS objects. Without Git LFS a clone holds
    pointer files of a few hundred bytes, and `make setup` stops at the first
    fixture step with a `git lfs` error.

!!! warning "Docker Desktop limits memory to its own VM"
    Docker Desktop runs every container inside a virtual machine whose memory
    is set under Settings, Resources, not by the host's RAM. The default of
    about 8 GB leaves under 5 GB for a Calliope run, which kills models of
    about 80 buildings. `docker info` shows the VM's total memory.

!!! note "Docker Desktop needs host networking turned on"
    The backend container and the helper scripts use host networking. Docker
    Desktop supports it from 4.34, under Settings, Resources, Network, "Enable
    host networking". Docker Engine on Linux needs nothing.

## What runs and why

Every container below has one job. Ports come from `repos.conf`; a dash means
the container is reached only on the internal Docker network.

| Container | Responsibility | Port | Image | Repository |
|---|---|---|---|---|
| `postgres` | Platform database: models, users, results, and the PyLovo database | 5433 | pulled, `pgrouting/pgrouting` | platform-core |
| `redis` | Background job queue and cache for the backend | 6379 | pulled | platform-core |
| `keycloak` | Login and user accounts | 8080 | pulled | platform-core |
| `auth-service` | The platform's login layer in front of Keycloak | 8001 | built locally | platform-core |
| `energy-backend` | EnerPlanET API and the built frontend (container mode only) | 8000 | built locally | enerplanet |
| `pylovo-api-1` | Low-voltage grid generation | 8086 | built locally | enerplanet-pylovo |
| `tentacron-api-1` | Single entry point to the services below: routing, job queue, polling | 8400 | built locally | TentaCron |
| `meme-api-1` | Translates a model into Calliope or PyPSA and runs the solver | 8401 | built locally | meme |
| `buem-gateway-api-1` | BuEM API: validates requests, batches buildings | 8402 | pulled | buem-gateway |
| `buem-gateway-model-1` | BuEM building simulation | - | pulled | buem |
| `ignis-api-1` | TABULA U-values and annual heat demand | 8403 | pulled | ignis |
| `ignis-db-1` | ignis's TABULA database | - | pulled | ignis |
| `city2tabula-api-1` | 3D city data: building envelopes, footprints, links to PyLovo buildings | 8404 | pulled | city2tabula |
| `city2tabula-db-1` | One City2TABULA database per country | - | pulled | city2tabula |
| `weather-api-1` | Hourly weather: P10/P50/P90 scenarios and real years | 8406 | pulled | weather |

The backend reaches every heat service through TentaCron, and PyLovo
directly. A model's BuEM, weather, City2TABULA and ignis calls never go to
those services' own ports.

The platform-core `webservice` container, the dispatcher of the earlier
simulation workers, is not started: neither the backend's start nor a MEME
run needs it.

## What `make setup` does

`make setup` takes 30 to 60 minutes on an empty machine, most of it image
downloads and local builds. It can be re-run: each step skips what already
exists, so after a failure fix the cause and run `make setup` again.

1. Clones the submodules, and the service checkouts under `dependencies/` at
   the versions pinned in `repos.conf`.
2. Creates every `.env` from its `.env.example`.
3. Starts PostgreSQL, Redis, Keycloak and auth-service.
4. Builds the app image and runs the database migrations and seed in it.
5. Loads the PyLovo fixture, then builds and starts PyLovo.
6. Starts the heat services: ignis, City2TABULA, weather, BuEM, MEME, then
   TentaCron.
7. Loads the City2TABULA and weather fixtures.
8. Starts the app container on port 8000 and creates the example models.

The last lines of a successful run are:

```
== 2 created, 0 skipped, 0 failed ==
Setup complete! Open http://localhost:8000 and sign in as admin@example.de / 12345678
```

!!! note "A dependency checkout on a branch is not moved"
    Step 1 moves a checkout under `dependencies/` to its pinned version only
    when it is not on a branch, so that a developer's own work there is kept.
    A checkout on a branch builds from that branch. `git -C dependencies/<name>
    describe --tags` shows what a checkout is on.

## Check the installation

```bash
make health   # every service answers, about 10 seconds
make smoke    # the heat workflow end to end, one to two minutes
```

`make health` prints one line per service and ends with `All services
healthy.` `make smoke` ends with `== done: 0 failure(s) ==`.

## Everyday commands

| Command | Does |
|---|---|
| `make up` | Start every service in container mode, rebuilding the app image if the code changed; also the command after a reboot |
| `make dev` | Start the Docker services, then the backend and frontend on the host in one tmux window, and check every service |
| `scripts/dev.sh stop` | Stop the host backend and frontend; the containers keep running |
| `make down` | Stop the platform services, PyLovo and the app container; the heat services keep running |
| `make health` | Check that every service answers |
| `make logs` | Follow the platform service logs |
| `make migrate` | Run the database migrations |
| `make seed` | Seed the database |
| `make fixtures` | Load any fixture that is missing; never overwrites |
| `make fixtures-reload` | Drop the fixture databases and load the fixtures afresh |
| `make example-models` | Create the example models that are missing |
| `make smoke` | Run the heat workflow smoke test |

The fixtures, the regions they cover and how they are regenerated are described
in [Test Data](test-data.md).

## Service URLs

| Service | URL |
|---|---|
| App, container mode | <http://localhost:8000> |
| Frontend, development mode | <http://localhost:3000> |
| Keycloak admin | <http://localhost:8080/keycloak> |
| TentaCron | <http://localhost:8400> |
| PyLovo | <http://localhost:8086> |

!!! warning "Development credentials"
    `admin@example.de` / `12345678` is seeded for local development only.
    Change it before any non-local deployment.

## Testing a local build of the building configurator

The frontend installs the building configurator package from a release tag in
`enerplanet/frontend/package.json`. To try a local change of the package
without a release:

```bash
cd ../Building-configurator/building-configurator && npm run build:lib
cd -   # back to enerplanet
cd enerplanet/frontend && npm install --no-save <path to building-configurator>
```

Restart Vite with `npm run dev -- --force` so it drops its cached copy of the
package. `--no-save` leaves `package.json` unchanged; once the package change
is released, bump the tag in `package.json` as usual.

## Disk use

Measured after `make setup` on an empty Docker, 2026-10-13:

| What | Size |
|---|---|
| Images | 41 GB, of which the locally built PyLovo image is 21 GB |
| Build cache | 48 GB |
| Volumes (all databases) | 1.3 GB |

The build cache only speeds up rebuilds; `docker builder prune -f` frees it.
Services built locally account for most of both figures.

## Starting from an empty Docker

These commands delete every container, image, volume and build cache on the
machine, including those of other projects. There is no undo.

```bash
scripts/dev.sh stop
docker stop $(docker ps -q)
docker system prune -a --volumes -f
docker volume prune -a -f
docker builder prune -a -f
make setup
```

`docker system prune --volumes` removes only unnamed volumes, hence the
separate `docker volume prune -a`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied while trying to connect to the Docker daemon socket` | The user is not in the `docker` group | `sudo usermod -aG docker $USER`, then log out and in again |
| `Bind for 0.0.0.0:5433 failed: port is already allocated`, or the same for another port | Another process or an older stack holds the port | Stop it; `docker ps` lists containers by port |
| `git: 'lfs' is not a git command` | Git LFS is not installed | Install it, run `git lfs install`, then `make setup` again |
| `go: download go1.26.0 ... unexpected EOF`, or the auth-service build hangs at `go mod download` | The build downloads a Go toolchain and the download failed | Run `make setup` again |
| A simulation fails with `coati binary not found` | The host backend has no `COATI_BIN` | Start it with `make dev`, which sets it; `make coati` installs the Coati CLI |
| A Calliope run ends with `signal: killed` | The solver ran out of Docker memory | Raise Docker Desktop's memory, or use a smaller model |
| `FAIL  city2tabula: container city2tabula-db-1 is not running` | City2TABULA was not started | `make city2tabula`, then `make fixtures` |
