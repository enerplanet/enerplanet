# Build trace — enerplanet runtime-config image (2026-10-22)

Goal: build `Dockerfile.ci` (backend + embedded frontend, now env-agnostic via
`/config.js`) and boot it as `energy-backend` for testing.

## Result

**Working.** The image builds and the container boots healthy; `/config.js`
serves the runtime config. The two failures below were transient npm registry
network errors inside the build container, not code issues — a plain
`docker build` retry succeeded on the first try after they occurred.

## What was tried

### 1. Compose build + up (failed: npm network)

```bash
# Remove the old pipeline-deployed container first
docker compose --env-file .env -f enerplanet/docker-compose.yml \
  -f enerplanet/docker-compose.dev.yml rm -sf energy-backend

# Build + start from current source
docker compose --env-file .env -f enerplanet/docker-compose.yml \
  -f enerplanet/docker-compose.dev.yml up -d --build energy-backend
```

Failed twice, both at `[febuilder 19/24] RUN npm install --legacy-peer-deps`
after ~230-280 s, with:

```
npm error network In most cases you are behind a proxy or have bad network settings.
failed to solve: process "/bin/sh -c npm install --legacy-peer-deps" did not complete successfully: exit code: 1
```

Host network was fine during the failures (`curl https://registry.npmjs.org/`
→ 200), and a throwaway container had registry access too
(`docker run --rm node:20-alpine wget https://registry.npmjs.org/` → OK).
Conclusion: intermittent npm fetch failure from inside the BuildKit build
container (DNS/resolve or registry flake), not a Dockerfile defect.

### 2. Plain docker build retry (worked)

```bash
cd /home/blackwolf/Projects/github/enerplanet
DOCKER_BUILDKIT=1 docker build --progress=plain \
  -f Dockerfile.ci -t enerplanet:test-runtimeconfig .   # exit 0
```

Full log was captured to `/tmp/enerploy-build.log` (kept verbose so the
failure point would be visible on a re-fail). The build passed every stage
including both `npm install` (libs + frontend) and the Coati venv bake.

### 3. Boot the new image

```bash
docker tag enerplanet:test-runtimeconfig enerplanet:latest
docker compose --env-file .env -f enerplanet/docker-compose.yml \
  -f enerplanet/docker-compose.dev.yml up -d --no-build energy-backend
```

Container: `energy-backend` Up (healthy), image `enerplanet:latest`
(916 MB, built from current source).

## Verification (live)

```bash
curl -sS http://localhost:8000/config.js
# window.__ENERPLANET_CONFIG__ = {"api":{"baseUrl":"/api"},...,
#   "sso":{"clientId":"spatialhub","enabled":false,...}}   <- SSO off: APP_ENV=development

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8000/health   # 200

curl -sS http://localhost:8000/ | grep -o 'src="/config.js"'           # present
```

Config fallbacks confirmed working in the dev stack: no `FRONTEND_*` vars are
set in `backend/.env`, so the runtime config derives Keycloak URL/redirect
from `APP_URL=http://host.docker.internal:8000`, realm/client from
`KEYCLOAK_REALM`/`KEYCLOAK_CLIENT_ID`, and SSO is off because
`APP_ENV=development`. Exactly the radarr-style "deployer supplies the env"
model.

## If the npm failure reappears

- It is transient; retry the build once or twice before investigating.
- To see the exact fetch error: `docker build --progress=plain ...` and grep
  the log for the real `npm error` line (the failed stage's first error is
  above the generic "behind a proxy" boilerplate).
- Host-registry reachability is not the same thing as build-container
  reachability; check both before blaming Dockerfile.
- If it becomes persistent: pin `--network=host` on the febuilder stage or set
  an npm mirror via `ARG` in `Dockerfile.ci`.
