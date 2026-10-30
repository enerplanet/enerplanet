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
| TentaCron | `tentacron-env-tentacron-1` | **built** from the pinned commit | **yes** — the stack's only entry point |
| PyLovo | `pylovo-api-dev`, `pylovo-postgres`, `pylovo-redis` | **built**, plus pulled `pgrouting` / `redis` | **yes** |
| MEME | `meme-env-api-1` | **built** — no published image | no |
| ignis | `ignis-http-ignis-1`, `ignis-http-db-1`, `ignis-http-build-db-1` | pulled, pinned | no |
| BuEM | `buem-gateway-http-buem-gateway-1`, `buem-gateway-http-buem-model-1` | pulled, pinned | no |
| City2TABULA | `city2tabula`, `city2tabula-db` | pulled, pinned | no |
| weather | `weather-serve` | pulled, pinned | no |
| PV service | `pv-service` | **built** — no published image | no |

A first `up` on an empty Docker is the long one — the published images, plus the
locally built PyLovo image (roughly 21 GB) — budget tens of GB. Re-runs skip
what already exists. Installation's [disk-use
measurement](../docs/enerplanet/installation.md#disk-use) is for the whole
platform including this stack.

Everything except TentaCron and PyLovo is reachable only on the stack's private
networks — there are no debugging ports to collide on and none to remember.
TentaCron routes to the others, which is how the real callers reach them.

Only `city2tabula-cli` is left down: it has no published image, and `up` would
otherwise build its full Go/JDK/citydb toolchain for no gain.

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
| `--pylovo-port N` | Host port for PyLovo. Default `8186`. |
| `--no-fixtures` | Do not git-lfs pull or load the fixtures. |
| `--fixtures-dir DIR` | Read the fixture data from `DIR` instead of `<repo>/fixtures`. |
| `--weather-api-key K` | Key TentaCron presents to weather-serve. Default `dev-weather-key`, matching TentaCron's `.env.dev`. |
| `--volumes` | `down` also removes this stack's volumes. |
| `--dry-run` | Print the plan and change nothing. |
| `-h`, `--help` | Full usage text. |

### Ports are chosen for you

Only two ports are published, so they are the only ones that can collide. If
`8400` or `8186` is already taken, the script moves to the next free port and
says so:

```
warn tentacron: host port 8400 is already in use, using 8401 instead
```

Pin them with `--tentacron-port` / `--pylovo-port` when you need a fixed value
the caller has to know, such as `TENTACRON_SERVICE_URL` in a backend's config.

---

## Commands

### `up`

The default. Generates the override files, clones or updates the service
checkouts at their pins, pulls the published images, builds the rest, starts
everything, then loads the fixtures. It ends with:

```
Heat stack up under prefix 'sim2'
  TentaCron   http://localhost:8400     (the stack's only entry point)
  PyLovo      http://localhost:8186
  networks    sim2-tentacron-net, sim2-pylovo-net  (private; no host ports on the other services)
  workdir     /path/to/enerplanet/.local/heat-stack/sim2

Reach the private services through their containers:
  docker exec sim2-city2tabula-db psql -U postgres -l
  docker logs -f sim2-tentacron-env-tentacron-1

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
PYLOVO_HOST_PORT=8186
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
target DB containers (`<prefix>-city2tabula-db`, `<prefix>-pylovo-postgres`)
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

### `down`

Stops and removes this prefix's containers and networks. Add `--volumes` to
drop the databases too. It matches on the prefix, so another stack's containers
and the host's are out of reach.

---

## How the prefix is applied

The dependency repositories hardcode container names, network names and compose
project names, and a compose project name alone cannot reach a hardcoded
`container_name`. So the script writes **one generated override file per
service** into the workdir and passes it with `-f`. The upstream compose files
are never edited.

| What | Becomes |
|---|---|
| `container_name` | `<prefix>-<original>` |
| Compose project name | `<prefix>-<original>` (via `-p`) |
| Shared network `tentacron-net` | `<prefix>-tentacron-net` |
| The platform's `spatialhub-net` | `<prefix>-pylovo-net` (`external: !reset`) |
| Every published port | removed (`ports: !reset []`) |
| TentaCron, PyLovo | the two ports above (`ports: !override […]`) |

`spatialhub-net` is declared `external: true` upstream because it expects the
platform to have created it. It is reset here into this stack's own network, so
the stack comes up on a machine where no platform exists — and TentaCron's
PyLovo targets point at this stack's PyLovo, never the host's.

### Why cross-service names need no rewriting

The heat services address each other by fixed names — `meme-env-api-1`,
`ignis-http`, `buem-gateway-http`, `weather-serve`, `city2tabula`,
`pv-service`, `pylovo-api-dev`. Those resolve **on the network**, and this stack
owns its networks, so they cannot clash with the same names on any other stack.

That means **TentaCron's `config.yaml` is used byte-for-byte as upstream ships
it**, with no divergence to maintain. The two names that are container names
rather than service names (`meme-env-api-1`, `pylovo-api-dev`) are re-added as
network aliases in the overrides, so both sides of each address still agree.

### PyLovo

Upstream's dev compose runs a single API and borrows the platform's postgres and
redis. Neither exists here, so this stack starts its own — same private network
as the API, so `HOST=postgres` and `REDIS_HOST=redis` resolve to them.

`city2tabula-db` joins that same network, because its `postgres_fdw` link
connects out of it; `PYLOVO_FDW_HOST` is pointed at `<prefix>-pylovo-postgres`.
The host's `pylovo-postgres` and its `pylovo_db` are on a different network and
are **not reachable** from this stack.

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
docker logs -f sim2-tentacron-env-tentacron-1
docker exec sim2-city2tabula-db psql -U postgres -l
docker exec sim2-pylovo-postgres psql -U postgres -d pylovo_db -c '\dt'
```

To call a service from the host, either publish it (add a `ports:` line to that
service's override file and re-run) or run the client on the network:

```bash
docker run --rm --network sim2-tentacron-net curlimages/curl \
  http://ignis-http:8080/ignis/health
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
| `city2tabula` on-request runs fail | The country's database fixture was not loaded | Re-run without `--no-fixtures`, or `make fixtures` |
| A simulation fails with `coati binary not found` | Unrelated to this stack — that is the backend's own dependency | See [Installation](../docs/enerplanet/installation.md) |

---

## Verified

Checked against Docker Compose 5.6.1:

- All eight compose projects render, with prefixed container names, no published
  ports except TentaCron and PyLovo, and the two private networks.
- Checkouts clone at the pinned refs; the fixture LFS pull lands real data.
- A held port moves the assignment and warns.
- Cross-project alias resolution works, and the stack genuinely cannot resolve
  the host's `pylovo-postgres`.
- `down` interpolates every file cleanly; `shellcheck -S warning` is clean.

**Not verified:** a full `up` on a clean Docker. It builds the PyLovo, MEME,
TentaCron and PV images and pulls several GB — the long first run described
under [What it deploys](#what-it-deploys).
