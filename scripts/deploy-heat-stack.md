# `deploy-heat-stack.sh`

Deploys the EnerPlanET **heat stack** and **PyLovo** as a second, self-contained
stack beside an installation that is already running, with every container name,
network, volume and published port namespaced under a prefix.

Nothing that already exists on the host is touched, overwritten or collided
with. The EnerPlanET platform itself — postgres, redis, keycloak, auth-service,
the app container — is **not** part of this stack.

```bash
scripts/deploy-heat-stack.sh --prefix sim2 up        # deploy
scripts/deploy-heat-stack.sh --prefix sim2 render    # generate + validate, deploy nothing
scripts/deploy-heat-stack.sh --prefix sim2 fixtures  # (re)load the fixture sets
scripts/deploy-heat-stack.sh --prefix sim2 check     # compare the stack with scripts/regions.yaml
scripts/deploy-heat-stack.sh --prefix sim2 status
scripts/deploy-heat-stack.sh --prefix sim2 down
```

The script uses the enerplanet checkout it lives in — no second clone. That is
what supplies the fixtures and where the service checkouts go. See
[Fixtures](#fixtures).

---

## Why it exists

`make tentacron-stack` brings the heat services up with the names their own
repositories hardcode. That is fine on a machine that runs only one EnerPlanET
stack. On a shared server it is not: `pylovo-postgres`, `city2tabula`,
`weather-serve`, `pv-service` and the ports they publish are already taken by
the existing installation.

This script deploys the same services under a prefix instead, so several stacks
can coexist.

---

## What it deploys

| Service | Containers (`<prefix>-…`) | Image | Host port |
|---|---|---|---|
| TentaCron | `tentacron-api-1` | **built** from the `_BRANCH` tip | **yes**, the stack's only entry point |
| PyLovo | `pylovo-api-1`, `pylovo-postgres-1`, `pylovo-redis-1` | **built**, plus pulled `pgrouting` / `redis` | **yes** |
| MEME | `meme-api-1` | **built**, no published image | no |
| ignis | `ignis-api-1`, `ignis-db-1`, `ignis-build-db-1` | pulled, `IGNIS_IMAGE_TAG` | no |
| BuEM | `buem-gateway-api-1`, `buem-gateway-model-1` | pulled, `BUEM_IMAGE_TAG` and `BUEM_MODEL_IMAGE_TAG` | no |
| City2TABULA | `city2tabula-api-1`, `city2tabula-db-1` | pulled, `CITY2TABULA_IMAGE_TAG` | no |
| weather | `weather-api-1` | pulled, `WEATHER_IMAGE_TAG` | no |
| PV service | `pysam-pv-api-1` | pulled, `PV_SERVICE_IMAGE_TAG` | no |

A pulled tag that is not published stops the deploy; there is no fallback to a
build. Built images are tagged `<prefix>-build`, so they never replace a
pulled release image of the same name.

A first `up` on an empty Docker is the long one — the published images, plus the
locally built PyLovo image (roughly 21 GB) — budget tens of GB. Re-runs skip
what already exists. Installation's [disk-use
measurement](../docs/enerplanet/installation.md#disk-use) is for the whole
platform including this stack.

Everything except TentaCron and PyLovo is reachable only on the stack's private
networks — there are no debugging ports to collide on and none to remember.
TentaCron routes to the others, which is how the real callers reach them.

City2TABULA's `cli` service sits behind its own compose profile and is not
started.

---

## Requirements

| Tool | Notes |
|---|---|
| Git | cloning the service checkouts |
| Git LFS | the fixtures are LFS objects |
| `gzip` | the fixture dumps are gzipped |
| Docker Engine or Desktop | `docker compose` **2.24 or newer** |

Compose 2.24+ is a hard requirement, not a preference. The generated override
files use the `!reset` and `!override` tags, which only exist from that version.
The script checks and refuses to run on anything older.

Disk is the real cost: the locally built PyLovo image alone is about 21 GB.
Installation measures a full setup at [41 GB of images and 48 GB of build
cache](../docs/enerplanet/installation.md#disk-use) — that includes this stack.
Docker memory: 16 GB, more for larger models.

---

## Options

| Option | Meaning |
|---|---|
| `--prefix NAME` | **Required.** Namespaces every container, network and volume. Lowercase letters, digits and dashes. |
| `--repo DIR` | The enerplanet checkout to use. Defaults to the one this script lives in. |
| `--workdir DIR` | Where the generated override files go. Defaults to `<repo>/.local/heat-stack/NAME`. |
| `--tentacron-port N` | Host port for TentaCron. Default `8400`. |
| `--pylovo-port N` | Host port for PyLovo. Default `8187`. |
| `--no-fixtures` | Do not git-lfs pull or load the fixtures. |
| `--fixtures-dir DIR` | Read the fixture data from `DIR` instead of `<repo>/fixtures`. |
| `--weather-api-key K` | Key TentaCron presents to weather-serve. Default `dev-weather-key`, matching TentaCron's `.env.dev`. |
| `--volumes` | `down` also removes this stack's volumes. |
| `--dry-run` | Print the plan and change nothing. |
| `-h`, `--help` | Full usage text. |

### Published ports

Only TentaCron (`8400`) and PyLovo (`8187`) publish a host port. Every other
service is reachable only by name on the stack's networks, through TentaCron.
Production reserves both ports for this stack. If either is already taken, the
script stops:

```
err  tentacron: host port 8400 is already in use; stop what holds it, or pass --tentacron-port N
```

Pass `--tentacron-port` / `--pylovo-port` only for a second stack on the same
host, such as a test prefix.

---

## Commands

### `up`

The default. Generates the override files, clones or updates the service
checkouts at their pins, pulls the published images, builds the rest, starts
everything, loads the fixtures, then runs [`check`](#check). It ends with:

```
Heat stack up under prefix 'sim2'
  TentaCron   http://localhost:8400     (the stack's only entry point)
  PyLovo      http://localhost:8187
  networks    sim2-tentacron-net, sim2-pylovo-net  (private; no host ports on the other services)
  workdir     /path/to/enerplanet/.local/heat-stack/sim2

Reach the private services through their containers:
  docker exec sim2-city2tabula-db-1 psql -U postgres -l
  docker logs -f sim2-tentacron-api-1

Tear down with: scripts/deploy-heat-stack.sh --prefix sim2 down
```

### `render`

Does everything `up` does except starting containers, and then validates all
eight compose projects with `docker compose config -q`. Use it to check that the
generated overrides still merge cleanly against a bumped pin:

```
$ scripts/deploy-heat-stack.sh --prefix sim2 render
  ok override files written to …/.local/heat-stack/sim2/overrides
==> cloning TentaCron at cfbc26a2…
  …
==> pulling fixture objects into …/enerplanet (git lfs)
  ok fixtures ready under …/enerplanet/fixtures
==> validating the rendered compose files
  ok all eight compose projects render
```

With `--dry-run` it only writes the override files and stops.

### `status`

Lists this prefix's containers, networks and the port assignment — the same
three `docker` queries you would otherwise run by hand:

```
$ scripts/deploy-heat-stack.sh --prefix sim2 status
==> containers for prefix 'sim2'
NAMES   STATUS   PORTS
…
==> networks
NAME   DRIVER
…
==> ports
PREFIX=sim2
TENTACRON_HOST_PORT=8400
PYLOVO_HOST_PORT=8187
…
```

### `fixtures`

(Re)loads the fixture sets on demand. It runs `fixtures/load.sh weather
city2tabula pylovo` with the loader's default "never overwrite" mode, which
skips whatever is already present and reloads anything that is missing:

```
$ scripts/deploy-heat-stack.sh --prefix sim2 fixtures
==> loading fixtures (weather, city2tabula, pylovo)
== loading fixtures from …/enerplanet/fixtures ==
SKIP  weather: …/COSMO_REA6_2018_annual_all_attrs.nc already present …
== 0 loaded, N skipped, 0 failed ==
  ok all fixture sets are loaded
```

Same thing `up` does at the end — this is the way to re-run only that step. The
target DB containers (`<prefix>-city2tabula-db-1`, `<prefix>-pylovo-postgres-1`)
are taken from the environment, so the data always lands in this prefix's
containers. The command exits non-zero if any fixture fails to load, which is
how you'd find out that a set was never loaded (`load.sh` reports it missing
rather than silently skipping). Use `status` to check which containers are up.

The source of the data defaults to `<repo>/fixtures`; point it elsewhere with
`--fixtures-dir` (e.g. a shared drive or an older fixture cut against a pinned
service tag):

```bash
scripts/deploy-heat-stack.sh --prefix sim2 --fixtures-dir /data/fixtures-pinned fixtures
```

### `check`

Compares the running stack with [`scripts/regions.yaml`](regions.yaml), the
data production must hold, and exits non-zero on any gap. `up` and `fixtures`
run it last.

| Section | Listed as | Fails when |
|---|---|---|
| `pylovo` | region: country, state, postcode to grid count | a postcode is missing from `/boundary/available`, or its state holds fewer grids than its entries add up to |
| `3d` | City2TABULA dataset id | the id is missing from `GET /api/v1/datasets` |
| `weather` | weather-serve point query: provider plus `year` or `scenario` | the query fails at the centre of any state listed under `pylovo` |

A postcode PyLovo holds but the file does not list is printed as a `note`, not
a failure.

```
$ scripts/deploy-heat-stack.sh --prefix sim2 check
==> checking the stack against scripts/regions.yaml
FAIL  pylovo Heeten: postcodes ['8111'] missing in NL overijssel
FAIL  pylovo NL overijssel: 0 grids, regions.yaml lists 30
94 postcodes, 7 3D datasets, 2 weather archives checked; 2 failures
err  the stack is missing data scripts/regions.yaml lists
```

The check runs in a throwaway container, `<prefix>-regions-check`, made from the
PyLovo API image and attached to both private networks. It waits up to five
minutes for a service that is not reachable yet.

!!! warning "Adding or regenerating a region"
    Add a region to `scripts/regions.yaml` in the same change that loads it,
    with the grid counts of the package that was loaded. A regenerated region
    keeps its entry; update the counts to the new package.

### `down`

Stops and removes this prefix's containers and networks. Add `--volumes` to
drop the databases too. It matches on the prefix, so another stack's containers
and the host's are out of reach.

---

## How the prefix is applied

Each service runs from the compose file and env file `repos.conf` names for it
(`_COMPOSE`, `_ENV_FILE`), plus **one generated override file** written into
the workdir and passed with `-f`. The upstream compose files are never edited.

| What | Becomes |
|---|---|
| Compose project name | `<prefix>-<repository>` (via `-p`) |
| Container names | `<prefix>-<repository>-<service>-1` |
| Shared network `tentacron-net` | `<prefix>-tentacron-net` |
| The platform's `spatialhub-net` | `<prefix>-pylovo-net` (`external: !reset`) |
| Every published port | removed (`ports: !reset []`) |
| TentaCron, PyLovo | the two ports above (`ports: !override […]`) |

`spatialhub-net` is declared `external: true` upstream because it expects the
platform to have created it. It is reset here into this stack's own network, so
the stack comes up on a machine where no platform exists, and TentaCron's
PyLovo targets point at this stack's PyLovo, never the host's.

The heat services address each other by the network aliases each repository
declares (`ignis`, `buem-gateway`, `weather`, `city2tabula`, `pysam-pv`,
`pylovo`). This stack owns its networks, so those names cannot clash with
another stack's. MEME declares no alias, so its override adds `meme`.

### PyLovo

Upstream's dev compose runs a single API and borrows the platform's postgres and
redis. Neither exists here, so this stack starts its own, on the same private
network as the API, so `HOST=postgres` and `REDIS_HOST=redis` resolve to them.

City2TABULA's `db` joins that same network, because its `postgres_fdw` link
connects out of it; `PYLOVO_FDW_HOST` is `postgres`. The host's PyLovo database
is on a different network and is **not reachable** from this stack.

---

## Fixtures

The fixtures are the committed test data: City2TABULA 3D data and databases for
Bremen, Brno, Loenen and Vienna, the weather scenarios, and a PyLovo dump.

They come from **the enerplanet checkout this script runs in** — there is no
second clone. The script runs `git lfs pull --include=fixtures` there, then
hands that tree to the repository's own `fixtures/load.sh`, which copies the
weather cuts and City2TABULA LoD2 sources into the service checkouts and
restores the databases. `--no-fixtures` skips the step entirely, for a clone
whose fixtures are already pulled and loaded.

`load.sh` is used as-is. It takes its target containers from the
environment (`C2T_DB_CONTAINER`, `PYLOVO_DB_CONTAINER`), which is how the
fixtures land in this stack's containers rather than the host's, and it resolves
its checkouts as `<repo>/dependencies/<dir>` — the layout the script creates.

`load.sh` prints one line per fixture and a count at the end
(`== N loaded, N skipped, N failed ==`); a non-zero failure count makes the
loader exit non-zero, which the script reports as a warning rather than
aborting — the stack is up, it may just lack data.

---

## Shared with `make setup-repos`

Service checkouts live in `dependencies/` — the same directory, and the same
layout, that `make setup-repos` creates. So this script **shares checkouts with
your normal dev workflow** rather than keeping private ones.

| Checkout state | What the script does |
|---|---|
| Absent | Clones it, checks out the pinned ref |
| On a detached HEAD (a pin) | Fetches, moves it to the pinned ref |
| On a branch | **Leaves it alone** and warns — it may be your own work |

That last row is the same rule `setup-repos` follows, and it means a checkout
sitting on a feature branch is what gets built, not the pin.

## Files it writes

| Path | What |
|---|---|
| `<repo>/dependencies/<service>/` | Service checkouts (gitignored) |
| `<repo>/.local/heat-stack/<prefix>/overrides/*.yml` | Generated compose overrides (gitignored) |
| `<repo>/.local/heat-stack/<prefix>/ports.env` | The resolved port assignment (gitignored) |

Nothing is written outside those, and both directories are already in
`.gitignore`.

---

## Reaching the private services

They publish no host ports. Go through the containers:

```bash
docker logs -f sim2-tentacron-api-1
docker exec sim2-city2tabula-db-1 psql -U postgres -l
docker exec sim2-pylovo-postgres-1 psql -U postgres -d pylovo_db -c '\dt'
```

To call a service from the host, either publish it (add a `ports:` line to that
service's override file and re-run) or run the client on the network:

```bash
docker run --rm --network sim2-tentacron-net curlimages/curl \
  http://ignis:8080/ignis/health
```

---

## Pins

The script reads every `_REPO`, `_DIR`, `_BRANCH`, `_PORT` and image tag from
the clone's `repos.conf`, checks out each service at the tip of its `_BRANCH`
for its compose files, and runs the release image named by its `_IMAGE_TAG`. A
variable already set in the environment wins over the file:

```bash
CITY2TABULA_BRANCH=dev CITY2TABULA_IMAGE_TAG=0.17.0 \
  scripts/deploy-heat-stack.sh --prefix sim2 render
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Docker Compose X is too old` | The `!reset` / `!override` tags need 2.24 | Update the Compose plugin |
| `<repo> has no repos.conf` | Run from outside an enerplanet clone, or `--repo` points elsewhere | `--repo DIR`, or run it in the clone that has one |
| `<repo>/repos.conf sets no <VAR>` | The clone's `repos.conf` lacks a pin the script needs | Pull the current `dev`, or set `<VAR>` in the environment |
| `network <prefix>-pylovo-net … was not created for project` | Expected. A later service joins a network an earlier one created | Nothing — it attaches rather than recreating |
| A checkout you expect at a pin is on a branch | The "left alone" rule above | Move that checkout to the pinned ref yourself |
| A redeploy leaves old containers such as `<prefix>-ignis-http-ignis-1` running | The prefix was deployed before the services moved to their `environment/` compose files, under other project names | Before updating the checkout, run the previous version's `down` for that prefix, then `up` with this one |
| `city2tabula` on-request runs fail | The country's database fixture was not loaded | Re-run without `--no-fixtures`, or `make fixtures` |
| A simulation fails with `coati binary not found` | Unrelated to this stack — that is the backend's own dependency | See [Installation](../docs/enerplanet/installation.md) |

---

## Verified

Checked against Docker Compose 5.6.1:

- All eight compose projects render against the `repos.conf` branch tips, with
  no published ports except TentaCron and PyLovo, the two private networks, and
  every alias TentaCron calls.

**Not verified:** a full `up` on a clean Docker. It builds the PyLovo, MEME,
TentaCron and PV images and pulls several GB — the long first run described
under [What it deploys](#what-it-deploys).
