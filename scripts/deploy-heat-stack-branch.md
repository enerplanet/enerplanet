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
scripts/deploy-fixture.sh --prefix sim2 /srv/enerplanet-test-data/v2
```

Run it from a clone of enerplanet. The service checkouts go in that clone's
`dependencies/`, and the branches come from its `repos.conf`.

## Commands

| Command | What it does |
|---|---|
| `up` (default) | Writes the override files, checks out every service at its branch tip, builds every image, starts the stack |
| `render` | Everything `up` does except building and starting; validates all eight compose projects. `--dry-run` stops after writing the override files |
| `status` | Lists the prefix's containers, networks, port assignment and the loaded test data version |
| `down` | Stops and removes the prefix's containers and networks; `--volumes` also drops its databases |

A first `up` builds every image, PyLovo's alone about 21 GB, so it takes a
long time and tens of GB of disk. Later runs reuse Docker's build cache.

## Branches

Each service is checked out at `origin/<_BRANCH>` from `repos.conf` and built
with its repository's http compose file.

| Service | `repos.conf` keys | Compose file |
|---|---|---|
| TentaCron | `TENTACRON_*` | `environment/docker-compose.yml` |
| MEME | `MEME_*` | `environment/docker-compose.yml` |
| buem-gateway | `BUEM_*` | `environment/http/docker-compose.build.yml` |
| buem-model | `BUEM_MODEL_*` | built from `enerplanet/buem`, `infrastructure/container/Dockerfile` |
| ignis | `IGNIS_*` | `environment/http/docker-compose.yml` |
| City2TABULA | `CITY2TABULA_*` | `environment/http/docker-compose.yml`, server only |
| weather | `WEATHER_*` | `infrastructure/container/docker-compose.serve.yml` |
| PV service | `PV_SERVICE_*` | `docker-compose.yml` |
| PyLovo | `PYLOVO_*` | `docker-compose.dev.yml`, plus its own postgres and redis |

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
| `--repo DIR` | The enerplanet checkout to use. Default: the one the script lives in |
| `--workdir DIR` | Where the generated override files go. Default `<repo>/.local/heat-stack/NAME` |
| `--tentacron-port N` | Host port for TentaCron. Default `8400`, or the next free port |
| `--pylovo-port N` | Host port for PyLovo. Default `8186`, or the next free port |
| `--weather-api-key K` | Key TentaCron presents to weather-serve. Default `dev-weather-key` |
| `--volumes` | `down` also removes the prefix's volumes |
| `--dry-run` | Print the plan and change nothing |

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
| `repos.conf sets no BUEM_MODEL_REPO` (or another `_BRANCH` key) | The clone's `repos.conf` predates this script | Pull the current `dev` |
| `<path> is on a local branch; leaving it alone` | That checkout holds local work | Build it as it is, or detach it: `git -C <path> checkout --detach` |
| `git lfs pull failed in <path>` | No LFS access or no network | Fix access and re-run; the build would lack data files |
| A build fails | The branch tip does not build | Fix the branch, or set `<SERVICE>_BRANCH` to one that builds |
| Port warning `using 8401 instead` | The default port is taken | Pin it with `--tentacron-port` or `--pylovo-port` |
