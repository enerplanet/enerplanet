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
The map opens with two example models, one in Loenen and one in Bremen.

## Prerequisites

Everything runs in Docker. The host needs only these:

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Git LFS | 3.x | `git lfs version` |
| GNU Make | any | `make --version` |
| Docker Engine | any recent | `docker version` |
| Docker Compose plugin | 2.24 or newer | `docker compose version` |

The user running `make` must be able to run `docker` without `sudo`.

| Resource | Minimum |
|---|---|
| OS | Linux (amd64). Windows works through WSL2 with Docker Desktop. |
| RAM | 8 GB, 16 GB recommended |
| Free disk | 35 GB, see [Storage footprint](disk-footprint.md) |

!!! warning "Install Git LFS before cloning"
    The test fixtures are Git LFS objects. Without Git LFS a clone holds
    pointer files of a few hundred bytes, and `make setup` stops at the first
    fixture step with a `git lfs` error.

!!! note "Docker Desktop needs host networking turned on"
    The backend container and the helper scripts use host networking. Docker
    Desktop supports it from 4.34, under Settings, Resources, Network, "Enable
    host networking". Docker Engine on Linux needs nothing.

## What `make setup` does

`make setup` takes 10 to 30 minutes on the first run, most of it image
downloads and builds. It can be re-run: each step skips what already exists,
so after a failure fix the cause and run `make setup` again.

1. Clones the submodules and the service checkouts under `dependencies/`.
2. Creates every `.env` from its `.env.example`.
3. Starts PostgreSQL, Redis, Keycloak, auth-service and webservice.
4. Builds the app image and runs the database migrations and seed in it.
5. Loads the PyLovo fixture, then starts PyLovo.
6. Starts the heat services: TentaCron, ignis, City2TABULA, weather and BuEM.
7. Loads the weather and City2TABULA fixtures.
8. Starts the app on port 8000 and creates the example models.

The last lines of a successful run are:

```
== 2 created, 0 skipped, 0 failed ==
Setup complete! Open http://localhost:8000 and sign in as admin@example.de / 12345678
```

## Check the installation

```bash
make smoke
```

This runs the heat workflow end to end against the running stack and ends with
`== done: 0 failure(s) ==`. It takes one to two minutes.

## Everyday commands

| Command | Does |
|---|---|
| `make up` | Start every service, rebuilding the app image if the code changed; also the command after a reboot |
| `make down` | Stop the platform services, PyLovo and the app; the heat services keep running |
| `make logs` | Follow the platform service logs |
| `docker logs -f energy-backend` | Follow the app logs |
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
| App (frontend and API) | <http://localhost:8000> |
| Keycloak admin | <http://localhost:8080/keycloak> |
| TentaCron | <http://localhost:8400> |
| PyLovo | <http://localhost:8086> |

!!! warning "Development credentials"
    `admin@example.de` / `12345678` is seeded for local development only.
    Change it before any non-local deployment.

## Developing with hot reload

`make setup` runs the app from a production build, so a code change needs
`make up` to rebuild it. For live reload, run the backend and frontend on the
host instead. This needs Go 1.24, Node.js 22 and tmux on the host.

```bash
make install                  # npm and Go dependencies
docker stop energy-backend    # frees port 8000
make dev-bg                   # backend on :8000, Vite on :3000, in tmux
```

The frontend is then on <http://localhost:3000>. `make clean-bg` stops both;
`make up` starts the container again.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied while trying to connect to the Docker daemon socket` | The user is not in the `docker` group | `sudo usermod -aG docker $USER`, then log out and in again |
| `Bind for 0.0.0.0:5433 failed: port is already allocated`, or the same for another port | Another process or an older stack holds the port | Stop it; `docker ps` lists containers by port |
| `git: 'lfs' is not a git command` | Git LFS is not installed | Install it, run `git lfs install`, then `make setup` again |
| `FAIL  city2tabula: container city2tabula-db is not running` | City2TABULA was not started | `make city2tabula`, then `make fixtures` |
