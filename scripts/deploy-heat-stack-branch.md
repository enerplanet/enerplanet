---
audience: developer
---

# `deploy-heat-stack-branch.sh`

Builds the EnerPlanET heat stack and PyLovo from the tip of each service's
branch in `repos.conf` and deploys it under a prefix, beside whatever already
runs on the host. Every image is built from source; nothing is pulled from
GHCR. Test data is loaded separately with
[`deploy-fixture.sh`](deploy-fixture.md).

```bash
scripts/deploy-heat-stack-branch.sh --prefix sim2 up
scripts/deploy-fixture.sh --prefix sim2 /path/to/enerplanet-test-data/v2
```

Run it from a clone of enerplanet. The service checkouts go in that clone's
`dependencies/`, and the branches come from its `repos.conf`.

## Commands

| Command | What it does |
|---|---|
| `up` (default) | Writes the override files, checks out every service at its branch tip, builds every image, starts the stack |
| `status` | Lists the prefix's containers, networks, port assignment and the loaded test data version |
| `down` | Stops and removes the prefix's containers and networks; `--volumes` also drops its databases |

A first `up` builds every image, PyLovo's alone about 21 GB, so it takes a
long time and tens of GB of disk. Later runs reuse Docker's build cache.

## Branches

Each service is checked out at `origin/<_BRANCH>` from `repos.conf` and
started from its checkout with:

```bash
docker compose -f <_COMPOSE> [--env-file <_ENV_FILE>] -f <prefix override> up -d --build [<_SERVICES>]
```

| Key | Meaning |
|---|---|
| `<SERVICE>_COMPOSE` | Compose file that builds the service, relative to its checkout |
| `<SERVICE>_ENV_FILE` | Env file passed to compose, relative to its checkout. Optional |
| `<SERVICE>_SERVICES` | The one compose service to start, when not all of them. Optional |

buem-model has no compose key: it is built from the `BUEM_MODEL_*` checkout
through buem-gateway's compose file. TentaCron's image is built with
`make build ENV=dev` in its `environment/` before compose starts it. PyLovo
gets its own postgres and redis from the prefix override.

A variable set in the environment wins over `repos.conf`, so one service can
be built from another branch for a single run:

```bash
CITY2TABULA_BRANCH=feat/my-change scripts/deploy-heat-stack-branch.sh --prefix sim2 up
```

Built images are tagged `<prefix>-branch` (for example
`ghcr.io/thd-spatial-ai/city2tabula-server:sim2-branch`). The tag exists only
on the host; it never replaces a release image of the same name.

## Checkouts

Checkouts live in `dependencies/`, shared with `make setup-repos` and
`deploy-heat-stack.sh`.

| Checkout state | What the script does |
|---|---|
| Absent | Clones it and detaches at `origin/<branch>` |
| Detached (a pin or an earlier branch deploy) | Fetches and moves it to `origin/<branch>` |
| On a local branch | Leaves it alone and warns; that checkout is built as it is |

Every checkout gets `git lfs pull`: ignis and City2TABULA build their TABULA
data into the image.

## Rolling back

[`deploy-heat-stack.sh`](deploy-heat-stack.md) deploys the pinned releases
from GHCR with the same prefix, workdir and checkouts. To return a prefix to
the pins:

```bash
scripts/deploy-heat-stack.sh --prefix sim2 --no-fixtures up
```

It moves the detached checkouts back to their `_REF`, pulls the release
images and recreates the containers. Databases and loaded test data stay in
their volumes. `--no-fixtures` keeps it from restoring the repository's own
fixtures over them. A database a branch build migrated to a newer schema may
not be readable by the older release; then `down --volumes` and load the test
data again.

## Options

| Option | Meaning |
|---|---|
| `--prefix NAME` | Required. Namespaces every container, network and volume. Lowercase letters, digits and dashes |
| `--tentacron-port N` | Host port for TentaCron. Default `8400`, or the next free port |
| `--pylovo-port N` | Host port for PyLovo. Default `8186`, or the next free port |
| `--weather-api-key K` | Key TentaCron presents to weather-serve. Default `dev-weather-key` |
| `--volumes` | `down` also removes the prefix's volumes |

The generated override files go in `.local/heat-stack/<prefix>/overrides`.

How the prefix renames containers, networks and ports, and how to reach the
private services, is described in
[`deploy-heat-stack.md`](deploy-heat-stack.md#how-the-prefix-is-applied); this
script applies it the same way.

## Requirements

| Tool | Notes |
|---|---|
| Git and Git LFS | The script stops if `git lfs` is missing |
| Docker Engine with Compose 2.24 or newer | The override files use `!reset` and `!override` |
| `make` | TentaCron's image is built with `make build` |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `repos.conf sets no BUEM_MODEL_REPO` (or another `_BRANCH` or `_COMPOSE` key) | The clone's `repos.conf` predates this script | Pull the current `dev` |
| `<path> is on a local branch; leaving it alone` | That checkout holds local work | Build it as it is, or detach it: `git -C <path> checkout --detach` |
| `git lfs pull failed in <path>` | No LFS access or no network | Fix access and re-run; the build would lack data files |
| A build fails | The branch tip does not build | Fix the branch, or set `<SERVICE>_BRANCH` to one that builds |
| Port warning `host port 8400 is in use, using 8401` | The default port is taken | Pin it with `--tentacron-port` or `--pylovo-port` |
