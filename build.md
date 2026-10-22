# Building and running the EnerPlanET image

How to build the runtime image (`Dockerfile.ci`: Go backend + embedded React
frontend + Coati venv) and run it as the `energy-backend` container. The image
is environment-agnostic: the frontend reads its config from `/config.js` at
runtime, so one image runs any environment.

## Prerequisites

- Docker with BuildKit (default).
- Root `.env` in the repo root — compose interpolates `REDIS_PASSWORD` and the
  platform vars from it. Run `make setup` once (or copy `.env.example` →
  `.env`) before the first build.
- The submodules checked out (`git submodule update --init --recursive`):
  `platform-core`, `libs`, `infrastructure`, `submodules/Coati` are all
  required by the build context.

## Build

From the repo root (build context **must** be the repo root — `Dockerfile.ci`
copies `infrastructure/`, `libs/`, `submodules/Coati` and `initial-data`):

```bash
docker build --provenance=false --sbom=false \
  -t enerplanet:latest -f Dockerfile.ci .
```

No build args. The frontend config (`/config.js`) is rendered at runtime by
the backend from `FRONTEND_*` env vars — nothing is baked at build time.

For a versioned tag (CI does this on release tags):

```bash
docker build --provenance=false --sbom=false \
  -t ghcr.io/enerplanet/enerplanet:1.2.3 -t ghcr.io/enerplanet/enerplanet:latest \
  -f Dockerfile.ci .
```

## Run (dev stack, via the Makefile)

```bash
# Stop the old container, rebuild the image, start the new one
docker compose --env-file .env -f enerplanet/docker-compose.yml \
  -f enerplanet/docker-compose.dev.yml up -d --build energy-backend
# or simply:
make up        # starts the whole stack
make backend   # rebuilds + restarts only energy-backend
```

`enerplanet/docker-compose.dev.yml` runs the container with host networking
and `env_file: ./backend/.env`, so the backend reaches each service on its
published localhost port.

## Configure an environment (radarr-style)

The image is one artifact; the environment is supplied as container env vars.
Backend reads `FRONTEND_*` for the browser config, falling back to the classic
vars when unset:

| Env var | Default | Purpose |
|---|---|---|
| `FRONTEND_SSO_ENABLED` | `APP_ENV == "production"` | Enable SSO login |
| `FRONTEND_KEYCLOAK_URL` | `<APP_URL>/keycloak` | Keycloak base for the browser |
| `FRONTEND_KEYCLOAK_REALM` | `KEYCLOAK_REALM` (`spatialhub`) | Realm |
| `FRONTEND_KEYCLOAK_CLIENT_ID` | `KEYCLOAK_CLIENT_ID` (`spatialhub`) | Client |
| `FRONTEND_KEYCLOAK_IDP_HINT` | `renvolveit` | SSO idp_hint |
| `FRONTEND_KEYCLOAK_REDIRECT_URI` | `<APP_URL>/app/map` | SSO redirect |
| `FRONTEND_API_BASE_URL` | `/api` | Backend API base for the browser |
| `FRONTEND_CARTO_BASEMAP_API_KEY` | *(empty)* | CARTO basemap key (no fallback) |

So a production-like run only needs the overrides that differ:

```bash
docker run -d --name energy-backend \
  -e APP_URL=https://enerplanet.th-deg.de \
  -e KEYCLOAK_REALM=spatialhub \
  -e KEYCLOAK_CLIENT_ID=spatialhub \
  -e FRONTEND_SSO_ENABLED=true \
  -e FRONTEND_CARTO_BASEMAP_API_KEY=... \
  ghcr.io/enerplanet/enerplanet:1.2.3
```

## Verify

```bash
curl -sS http://localhost:8000/config.js        # window.__ENERPLANET_CONFIG__ = {...}
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8000/health   # 200
curl -sS http://localhost:8000/ | grep -o 'src="/config.js"'             # present
```

## Troubleshooting

- **`npm install` fails with a network error inside the build**: transient
  npm fetch flake from inside the BuildKit container — retry once before
  investigating. Host reachability (`curl https://registry.npmjs.org`) is not
  the same as build-container reachability. See `build-trace.md`.
- **Config looks wrong** (`/config.js` missing keys): the container has no
  `FRONTEND_*` env — check what `APP_URL`/`KEYCLOAK_*` fall back to, and that
  the `.env` actually reached the container (`docker inspect energy-backend
  --format '{{json .Config.Env}}'`).
- **`/config.js` 404s in the browser on a deployed build**: the backend route
  is down — the app still works on build-time defaults, but the environment
  config isn't applied.

## CI

`.github/workflows/docker-publish.yml` builds and pushes this image to GHCR on
a `v*.*.*` tag (semver tags, e.g. `1.2.3`, matching `repos.conf` `*_IMAGE_TAG`
convention). Push the tag to publish:

```bash
git tag v1.2.3 && git push origin v1.2.3
```
