#!/usr/bin/env bash
#
# deploy-heat-stack.sh — deploy the EnerPlanET heat stack and PyLovo beside an
# existing installation, with every name and published port namespaced under a
# prefix, so nothing on the host is touched, overwritten or collided with.
#
# Not standalone: it must be run from a clone of enerplanet, because that clone
# is what supplies fixtures/ (the committed test data) and is where the service
# checkouts go — the same dependencies/ layout `make setup-repos` creates. It
# reads the Makefile not at all; the pins come from that clone's repos.conf,
# and a variable already set in the environment wins over it. It needs only
# git, git-lfs and Docker Compose 2.24+ (for the `!reset` / `!override` tags
# used to strip ports and rename things).
#
#   scripts/deploy-heat-stack.sh --prefix sim2 up
#   scripts/deploy-heat-stack.sh --prefix sim2 render    # generate + validate only
#   scripts/deploy-heat-stack.sh --prefix sim2 fixtures  # (re)load the fixture sets
#   scripts/deploy-heat-stack.sh --prefix sim2 status
#   scripts/deploy-heat-stack.sh --prefix sim2 down
#
# Fixtures are taken from the checkout the script lives in: it runs
# `git lfs pull --include=fixtures` there and then hands that tree to
# fixtures/load.sh, which looks for the service checkouts as
# <repo>/dependencies/<dir>. If your clone already has them pulled and loaded,
# --no-fixtures skips the whole step.
#
# What it deploys
#   tentacron, meme, buem-gateway (+buem-model), ignis, city2tabula (+db),
#   weather, pv-service, and PyLovo (single API + its own postgres + redis).
#   The enerplanet platform (postgres, redis, keycloak, auth-service, the app)
#   is NOT part of this stack.
#
# How the prefix is applied
#   The dependency repos hardcode container names, network names and project
#   names, which a compose project name alone cannot reach. So this script
#   writes a generated override file per service and passes it with `-f`:
#     * container_name            -> <prefix>-<original>
#     * compose project name      -> <prefix>-<original>       (via -p)
#     * shared network tentacron-net -> <prefix>-tentacron-net (name: override)
#     * the platform's spatialhub-net -> <prefix>-pylovo-net   (external: !reset)
#     * every published port      -> removed, except TentaCron and PyLovo
#   The upstream compose files are never edited.
#
# Why cross-service names need no rewriting
#   The heat services address each other by fixed names (meme-env-api-1,
#   ignis-http, buem-gateway-http, weather-serve, city2tabula, pv-service,
#   pylovo-api-dev). Those resolve on the network, and our stack owns private
#   networks (<prefix>-tentacron-net, <prefix>-pylovo-net), so they cannot
#   clash with the same names on any other stack's network. TentaCron's
#   config.yaml is therefore used byte-for-byte as upstream ships it; the two
#   names that are container names rather than service names (meme-env-api-1,
#   pylovo-api-dev) are re-added as network aliases in the overrides.
#
set -euo pipefail

# Fixtures come from the enerplanet checkout this script lives in, not from a
# clone of our own; --no-fixtures skips pulling and loading them entirely.

# TentaCron presents this to weather-serve; weather-serve accepts it.
WEATHER_API_KEY=${WEATHER_API_KEY:-dev-weather-key}

# ── Defaults ──────────────────────────────────────────────────────────────────
PREFIX=""
REPO=""
WORKDIR=""
FIXTURES_DIR=""
TENTACRON_HOST_PORT=""
PYLOVO_HOST_PORT=""
DO_FIXTURES=1
DRY_RUN=0
DOWN_VOLUMES=0
COMMAND="up"

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'
RED=$'\033[0;31m'; NC=$'\033[0m'

log()  { printf '%s==>%s %s\n' "$CYAN" "$NC" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%swarn%s %s\n' "$YELLOW" "$NC" "$*" >&2; }
die()  { printf '%serr %s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

usage() {
  awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"
  cat <<'USAGE'

Options:
  --prefix NAME          name every container, network and volume (required)
  --repo DIR             the enerplanet checkout to use
                         (default: the one this script lives in)
  --workdir DIR          where the generated override files go
                         (default <repo>/.local/heat-stack/NAME)
  --tentacron-port N     host port for TentaCron (default 8400)
  --pylovo-port N        host port for PyLovo    (default 8186)
  --no-fixtures          do not git-lfs pull or load the fixtures
  --fixtures-dir DIR     read the fixture data from DIR instead of <repo>/fixtures
  --weather-api-key K    key TentaCron presents to weather-serve
                         (default dev-weather-key, matching TentaCron's .env.dev)
  --volumes              `down` also removes this stack's volumes
  --dry-run              print the plan, change nothing
  -h, --help             this text

Commands: up (default) | render | fixtures | status | down
USAGE
}

# ── Arguments ─────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)         PREFIX="${2:?--prefix needs a value}"; shift 2 ;;
    --repo)           REPO="${2:?--repo needs a value}"; shift 2 ;;
    --workdir)        WORKDIR="${2:?--workdir needs a value}"; shift 2 ;;
    --tentacron-port) TENTACRON_HOST_PORT="${2:?}"; shift 2 ;;
    --pylovo-port)    PYLOVO_HOST_PORT="${2:?}"; shift 2 ;;
    --weather-api-key) WEATHER_API_KEY="${2:?}"; shift 2 ;;
    --no-fixtures)    DO_FIXTURES=0; shift ;;
    --fixtures-dir)   FIXTURES_DIR="${2:?--fixtures-dir needs a value}"; shift 2 ;;
    --volumes)        DOWN_VOLUMES=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    up|render|fixtures|status|down) COMMAND="$1"; shift ;;
    -*)               die "unknown option '$1' (try --help)" ;;
    *)                die "unknown command '$1' (try --help)" ;;
  esac
done

[ -n "$PREFIX" ] || die "--prefix is required (try --help)"
[[ "$PREFIX" =~ ^[a-z0-9][a-z0-9-]*$ ]] \
  || die "--prefix must be lowercase letters, digits and dashes, starting with a letter or digit"

# The enerplanet checkout this script lives in, unless --repo names another.
# It supplies fixtures/ and repos.conf, and holds dependencies/ — the same
# layout `make setup-repos` creates, which is what fixtures/load.sh expects.
SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="${REPO:-$(cd "$SELF_DIR/.." && pwd)}"
[ -d "$REPO_ROOT" ] || die "--repo $REPO_ROOT is not a directory"
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"

# The pins: every _REPO, _DIR, _REF, _PORT and image tag, from repos.conf, the
# single record of what the platform runs.
REPOS_CONF="$REPO_ROOT/repos.conf"
[ -f "$REPOS_CONF" ] || die "$REPO_ROOT has no repos.conf — is it an enerplanet checkout? Use --repo DIR"
while IFS='=' read -r key value; do
  if [[ $key =~ ^[A-Z0-9_]+$ ]] && [ -z "${!key:-}" ]; then export "$key=$value"; fi
done < "$REPOS_CONF"
for var in TENTACRON_REPO TENTACRON_DIR TENTACRON_REF TENTACRON_PORT \
           MEME_REPO MEME_DIR MEME_REF \
           BUEM_REPO BUEM_DIR BUEM_REF BUEM_GATEWAY_IMAGE_TAG BUEM_MODEL_IMAGE_TAG \
           IGNIS_REPO IGNIS_DIR IGNIS_REF IGNIS_IMAGE_TAG \
           CITY2TABULA_REPO CITY2TABULA_DIR CITY2TABULA_REF CITY2TABULA_IMAGE_TAG \
           WEATHER_REPO WEATHER_DIR WEATHER_REF WEATHER_IMAGE_TAG \
           PV_SERVICE_REPO PV_SERVICE_DIR PV_SERVICE_REF \
           PYLOVO_REPO PYLOVO_DIR PYLOVO_REF; do
  [ -n "${!var:-}" ] || die "$REPOS_CONF sets no $var"
done

DEPS_DIR="$REPO_ROOT/dependencies"  # every service checkout lives here
LOAD_SH="$REPO_ROOT/fixtures/load.sh"

# The generated override files. .local/ is already gitignored.
WORKDIR="${WORKDIR:-$REPO_ROOT/.local/heat-stack/$PREFIX}"
mkdir -p "$(dirname "$WORKDIR")"
WORKDIR="$(cd "$(dirname "$WORKDIR")" && pwd)/$(basename "$WORKDIR")"
OVR_DIR="$WORKDIR/overrides"
PORTS_FILE="$WORKDIR/ports.env"

NET_HEAT="${PREFIX}-tentacron-net"
NET_PYLOVO="${PREFIX}-pylovo-net"

# ── Preflight ─────────────────────────────────────────────────────────────────
preflight() {
  command -v docker >/dev/null || die "docker not found"
  docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
  docker compose version >/dev/null 2>&1 || die "the 'docker compose' plugin (v2) is required"

  local v
  v="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  if [ -n "$v" ]; then
    local major minor
    major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
    if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
      die "Docker Compose $v is too old: the override files use '!reset' and '!override', which need 2.24 or newer"
    fi
  fi

  command -v git >/dev/null || die "git not found"

  if [ "$DO_FIXTURES" = 1 ]; then
    [ -f "$LOAD_SH" ] || die "$REPO_ROOT has no fixtures/load.sh — is it an enerplanet checkout? Use --repo DIR, or --no-fixtures"
    command -v gzip >/dev/null || die "gzip not found (the fixture dumps are gzipped)"
    if ! git lfs version >/dev/null 2>&1; then
      warn "git-lfs not found; the fixtures are LFS objects and will stay as pointer files"
    fi
  fi
}

# port_in_use PORT — true when anything on the host, Docker included, already
# listens on it.
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$p\$" && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "(^|,| )[^ ]*:$p->" && return 0
  (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && return 0
  return 1
}

# stop_published_containers — a redeploy of a prefix that is still running
# would see its own containers holding the wanted host ports and drift one
# port up on every `up`. Stop the two containers that publish to the host, so
# the scan that follows re-selects the original ports instead. Only the two
# published services matter: every other service of the stack is private.
stop_published_containers() {
  local name
  for name in "${PREFIX}-tentacron-env-tentacron-1" "${PREFIX}-pylovo-api-dev"; do
    if docker ps --format '{{.Names}}' | grep -qx "$name"; then
      log "stopping running $name (frees its host ports for re-selection)"
      docker stop "$name" || warn "could not stop $name; its ports may be scanned as busy"
    fi
  done
}

# pick_port WANTED LABEL — sets PICKED_PORT to WANTED when free, else to the
# next free port above it. It writes a variable rather than printing, so that
# the failure path can still abort the whole script from inside the function.
PICKED_PORT=""
pick_port() {
  local wanted="$1" label="$2" p="$1" i=0
  while port_in_use "$p"; do
    i=$((i + 1))
    [ "$i" -le 100 ] || die "no free port found for $label within 100 above $wanted"
    p=$((p + 1))
  done
  if [ "$p" != "$wanted" ]; then
    warn "$label: host port $wanted is already in use, using $p instead"
  fi
  PICKED_PORT="$p"
}

# The two ports this stack publishes. Everything else is private, so these are
# the only host ports it can collide on; both are moved to the next free one
# when the wanted port is taken by something that is not this stack (a
# redeploy of this prefix has its own containers stopped beforehand, so its
# original ports re-select instead of drifting).
resolve_ports() {
  pick_port "${TENTACRON_HOST_PORT:-$TENTACRON_PORT}" tentacron
  TENTACRON_HOST_PORT="$PICKED_PORT"
  pick_port "${PYLOVO_HOST_PORT:-8186}" pylovo
  PYLOVO_HOST_PORT="$PICKED_PORT"
}

# ── Repositories ──────────────────────────────────────────────────────────────
# checkout DIR REPO REF — clone at REF, or move an existing checkout onto it.
checkout() {
  local dir="$1" repo="$2" ref="$3" path="$DEPS_DIR/$1"
  if [ -d "$path/.git" ]; then
    if [ "$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)" != "HEAD" ]; then
      warn "$path is on a branch; leaving it alone (pin: $ref)"
      return 0
    fi
    git -C "$path" fetch -q --tags origin
    git -C "$path" checkout -q "$ref"
    ok "updated $dir -> $ref"
  else
    log "cloning $dir at $ref"
    git clone -q "$repo" "$path"
    git -C "$path" checkout -q "$ref"
    ok "cloned $dir -> $ref"
  fi
}

clone_repos() {
  mkdir -p "$DEPS_DIR"
  checkout "$TENTACRON_DIR"      "$TENTACRON_REPO"      "$TENTACRON_REF"
  checkout "$MEME_DIR"           "$MEME_REPO"           "$MEME_REF"
  checkout "$BUEM_DIR"           "$BUEM_REPO"           "$BUEM_REF"
  checkout "$IGNIS_DIR"          "$IGNIS_REPO"          "$IGNIS_REF"
  checkout "$CITY2TABULA_DIR"    "$CITY2TABULA_REPO"    "$CITY2TABULA_REF"
  checkout "$WEATHER_DIR"        "$WEATHER_REPO"        "$WEATHER_REF"
  checkout "$PV_SERVICE_DIR"     "$PV_SERVICE_REPO"     "$PV_SERVICE_REF"
  checkout "$PYLOVO_DIR"         "$PYLOVO_REPO"         "$PYLOVO_REF"
}

# The fixtures come from the enerplanet checkout this script runs in; there is
# no clone of our own. `git lfs pull` there fills in the committed fixture
# objects, and load_fixtures then hands that same tree to fixtures/load.sh,
# whose ROOT is this checkout and which finds the service checkouts under
# <ROOT>/dependencies.
pull_fixtures() {
  log "pulling fixture objects into $REPO_ROOT (git lfs)"
  git -C "$REPO_ROOT" lfs install --local >/dev/null 2>&1 || true
  if git -C "$REPO_ROOT" lfs pull --include=fixtures; then
    ok "fixtures ready under $REPO_ROOT/fixtures"
  else
    warn "git lfs pull failed; fixtures may still be pointer files"
  fi
}

# ── Generated override files ──────────────────────────────────────────────────
write_overrides() {
  mkdir -p "$OVR_DIR"

  # ignis: the db and the one-shot build-db stay on the project's own network;
  # only the app joins the heat network, and it keeps its declared alias.
  cat > "$OVR_DIR/ignis.yml" <<EOF
services:
  ignis:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # buem: the gateway keeps its declared alias; the model container is reached
  # by service name only and stays private.
  cat > "$OVR_DIR/buem.yml" <<EOF
services:
  buem-gateway:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # city2tabula: all three containers are renamed. The db also joins the PyLovo
  # network, because postgres_fdw connects out of it, and it must reach THIS
  # stack's pylovo-postgres and never the host's.
  cat > "$OVR_DIR/city2tabula.yml" <<EOF
services:
  city2tabula-cli:
    container_name: $PREFIX-city2tabula-cli
  city2tabula-db:
    container_name: $PREFIX-city2tabula-db
    networks:
      default:
      spatialhub-net:
  city2tabula:
    container_name: $PREFIX-city2tabula
    ports: !reset []
    environment:
      PYLOVO_FDW_HOST: $PREFIX-pylovo-postgres
      PYLOVO_FDW_PORT: "5432"
      PYLOVO_FDW_DBNAME: pylovo_db
      PYLOVO_FDW_USER: postgres
      PYLOVO_FDW_PASSWORD: postgres
networks:
  tentacron-net:
    name: $NET_HEAT
  spatialhub-net:
    name: $NET_PYLOVO
EOF

  # weather: the serve container is renamed; its declared alias on the heat
  # network is untouched, so TentaCron's 'weather-serve' and 'weather' both
  # resolve. WEATHER_DATA_DIR_HOST keeps the fixture tree inside the checkout.
  cat > "$OVR_DIR/weather.yml" <<EOF
services:
  weather-serve:
    container_name: $PREFIX-weather-serve
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # meme: no container_name upstream, so the project name does the renaming and
  # the container lands on <prefix>-meme-env-api-1. TentaCron addresses it by
  # that same name, which is why the alias is repeated here.
  cat > "$OVR_DIR/meme.yml" <<EOF
services:
  api:
    ports: !reset []
    networks:
      default:
      tentacron-net:
        aliases:
          - meme-env-api-1
          - meme
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # pv-service: renamed container, private only.
  cat > "$OVR_DIR/pv-service.yml" <<EOF
services:
  pv-service:
    container_name: $PREFIX-pv-service
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # tentacron: the only heat service published. It joins both private networks;
  # spatialhub-net is declared external upstream (it expects the platform to
  # have created it), so it is reset here and becomes this stack's own.
  cat > "$OVR_DIR/tentacron.yml" <<EOF
services:
  tentacron:
    ports: !override ["$TENTACRON_HOST_PORT:8080"]
  tentacron-release:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
  spatialhub-net:
    name: $NET_PYLOVO
    external: !reset
EOF

  # PyLovo: upstream's dev file has a single API and borrows the platform's
  # postgres and redis. Neither exists here, so this stack's own are appended.
  # All three sit on the same private network, which is also the one
  # city2tabula-db joins for postgres_fdw. HOST=postgres and REDIS_HOST=redis
  # then resolve to the services below: the host's pylovo-postgres and its
  # pylovo_db are on a different network and are not reachable from here.
  cat > "$OVR_DIR/pylovo.yml" <<EOF
services:
  pylovo-api:
    container_name: $PREFIX-pylovo-api-dev
    ports: !override ["$PYLOVO_HOST_PORT:8086"]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      spatialhub-net:
        aliases:
          - pylovo-api-dev
          - pylovo
  postgres:
    image: pgrouting/pgrouting:17-3.5-3.7.3
    container_name: $PREFIX-pylovo-postgres
    shm_size: 8g
    environment:
      POSTGRES_DB: pylovo_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pylovo-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d pylovo_db"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - spatialhub-net
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    container_name: $PREFIX-pylovo-redis
    command: redis-server --maxmemory 1gb --maxmemory-policy allkeys-lru
    networks:
      - spatialhub-net
    restart: unless-stopped
networks:
  spatialhub-net:
    name: $NET_PYLOVO
    external: !reset
volumes:
  pylovo-pgdata:
EOF

  ok "override files written to $OVR_DIR"
}

# ── Deploy ────────────────────────────────────────────────────────────────────
tentacron_dir="$DEPS_DIR/$TENTACRON_DIR"
meme_dir="$DEPS_DIR/$MEME_DIR"
buem_dir="$DEPS_DIR/$BUEM_DIR"
ignis_dir="$DEPS_DIR/$IGNIS_DIR"
c2t_dir="$DEPS_DIR/$CITY2TABULA_DIR"
weather_dir="$DEPS_DIR/$WEATHER_DIR"
pv_dir="$DEPS_DIR/$PV_SERVICE_DIR"
pylovo_dir="$DEPS_DIR/$PYLOVO_DIR"

# PyLovo first: city2tabula's postgres_fdw links out to its database, and the
# heat network has to exist before the services that join it come up.
# PyLovo's dev compose reads .env.docker; upstream's `make dev` copies it from
# .env.example and would then run load-full-db against the platform's postgres,
# which does not exist here. The copy is done, the loader is not.
pylovo_env() {
  if [ ! -s "$pylovo_dir/.env.docker" ]; then
    cp "$pylovo_dir/.env.example" "$pylovo_dir/.env.docker"
    ok "created $PYLOVO_DIR/.env.docker from .env.example"
  fi
}

up_pylovo() {
  log "PyLovo (api + postgres + redis)"
  pylovo_env
  (
    cd "$pylovo_dir"
    docker compose -p "$PREFIX-pylovo" \
      -f docker-compose.dev.yml -f "$OVR_DIR/pylovo.yml" up -d --build
  )
}

up_ignis() {
  log "ignis"
  (
    cd "$ignis_dir/environment/http"
    export IGNIS_IMAGE_TAG
    docker compose -p "$PREFIX-ignis-http" \
      -f docker-compose.prod.yml -f "$OVR_DIR/ignis.yml" pull
    docker compose -p "$PREFIX-ignis-http" \
      -f docker-compose.prod.yml -f "$OVR_DIR/ignis.yml" up -d
  )
}

up_city2tabula() {
  log "City2TABULA"
  (
    cd "$c2t_dir/environment/http"
    export C2T_IMAGE_TAG="$CITY2TABULA_IMAGE_TAG"
    docker compose -p "$PREFIX-city2tabula" --env-file docker.env \
      -f docker-compose.yml -f "$OVR_DIR/city2tabula.yml" pull city2tabula
    # Named explicitly: city2tabula-cli has no published image and `up` would
    # build its full Go/JDK/citydb toolchain for nothing. city2tabula-db comes
    # up as a depends_on of the service named here.
    docker compose -p "$PREFIX-city2tabula" --env-file docker.env \
      -f docker-compose.yml -f "$OVR_DIR/city2tabula.yml" up -d city2tabula
  )
}

up_weather() {
  log "weather-serve"
  mkdir -p "$weather_dir/data"   # a root-owned bind-mount source breaks the fixture loader
  (
    cd "$weather_dir"
    export WEATHER_API_KEYS="$WEATHER_API_KEY"
    export WEATHER_IMAGE="ghcr.io/enerplanet/weather:$WEATHER_IMAGE_TAG"
    export WEATHER_DATA_DIR_HOST="$weather_dir/data"
    docker compose -p "$PREFIX-weather" \
      -f infrastructure/container/docker-compose.serve.yml -f "$OVR_DIR/weather.yml" \
      up -d --pull always
  )
}

up_buem() {
  log "BuEM (gateway + model)"
  (
    cd "$buem_dir/environment/http"
    export BUEM_GATEWAY_IMAGE_TAG BUEM_MODEL_IMAGE_TAG
    docker compose -p "$PREFIX-buem-gateway-http" \
      -f docker-compose.yml -f "$OVR_DIR/buem.yml" pull
    docker compose -p "$PREFIX-buem-gateway-http" \
      -f docker-compose.yml -f "$OVR_DIR/buem.yml" up -d
  )
}

up_meme() {
  log "MEME (built; no published image)"
  (
    cd "$meme_dir/environment"
    docker compose -p "$PREFIX-meme-env" --env-file .env.dev \
      -f docker-compose.yml -f "$OVR_DIR/meme.yml" up -d --build api
  )
}

up_pv() {
  log "PV service (built; no published image)"
  (
    cd "$pv_dir"
    docker compose -p "$PREFIX-pv-service" \
      -f docker-compose.yml -f "$OVR_DIR/pv-service.yml" up -d --build
  )
}

up_tentacron() {
  log "TentaCron (built; no release carries the EnerPlanET integration)"
  (
    cd "$tentacron_dir/environment"
    make build ENV=dev
    docker compose -p "$PREFIX-tentacron-env" --env-file .env.dev \
      -f docker-compose.yml -f "$OVR_DIR/tentacron.yml" up -d tentacron
  )
}

load_fixtures() {
  log "loading fixtures (weather, city2tabula, pylovo)"
  [ -n "$FIXTURES_DIR" ] && export FIXTURES_DIR
  # load.sh takes the target containers from the environment and its checkouts
  # from <repo root>/dependencies, which is this repo's own layout.
  C2T_DB_CONTAINER="$PREFIX-city2tabula-db" \
  PYLOVO_DB_CONTAINER="$PREFIX-pylovo-postgres" \
    bash "$LOAD_SH" \
    || warn "the fixture loader reported failures; the stack is up but may lack data"
}

# ── Commands ──────────────────────────────────────────────────────────────────
validate_overrides() {
  log "validating the rendered compose files"
  local failed=0
  pylovo_env
  ( cd "$ignis_dir/environment/http" && IGNIS_IMAGE_TAG="$IGNIS_IMAGE_TAG" \
      docker compose -p "$PREFIX-ignis-http" -f docker-compose.prod.yml -f "$OVR_DIR/ignis.yml" config -q ) || failed=1
  ( cd "$buem_dir/environment/http" && BUEM_GATEWAY_IMAGE_TAG="$BUEM_GATEWAY_IMAGE_TAG" BUEM_MODEL_IMAGE_TAG="$BUEM_MODEL_IMAGE_TAG" \
      docker compose -p "$PREFIX-buem-gateway-http" -f docker-compose.yml -f "$OVR_DIR/buem.yml" config -q ) || failed=1
  ( cd "$c2t_dir/environment/http" && C2T_IMAGE_TAG="$CITY2TABULA_IMAGE_TAG" \
      docker compose -p "$PREFIX-city2tabula" --env-file docker.env -f docker-compose.yml -f "$OVR_DIR/city2tabula.yml" config -q ) || failed=1
  ( cd "$weather_dir" && WEATHER_API_KEYS="$WEATHER_API_KEY" WEATHER_IMAGE="ghcr.io/enerplanet/weather:$WEATHER_IMAGE_TAG" \
      docker compose -p "$PREFIX-weather" -f infrastructure/container/docker-compose.serve.yml -f "$OVR_DIR/weather.yml" config -q ) || failed=1
  ( cd "$meme_dir/environment" && docker compose -p "$PREFIX-meme-env" --env-file .env.dev \
      -f docker-compose.yml -f "$OVR_DIR/meme.yml" config -q ) || failed=1
  ( cd "$pv_dir" && docker compose -p "$PREFIX-pv-service" \
      -f docker-compose.yml -f "$OVR_DIR/pv-service.yml" config -q ) || failed=1
  ( cd "$tentacron_dir/environment" && docker compose -p "$PREFIX-tentacron-env" --env-file .env.dev \
      -f docker-compose.yml -f "$OVR_DIR/tentacron.yml" config -q ) || failed=1
  ( cd "$pylovo_dir" && docker compose -p "$PREFIX-pylovo" \
      -f docker-compose.dev.yml -f "$OVR_DIR/pylovo.yml" config -q ) || failed=1
  [ "$failed" = 0 ] || die "at least one compose file failed to validate"
  ok "all eight compose projects render"
}

cmd_up() {
  [ -d "$DEPS_DIR" ] || die "no checkouts in $DEPS_DIR; run 'render' first or drop --dry-run"
  up_pylovo
  up_ignis
  up_city2tabula
  up_weather
  up_buem
  up_meme
  up_pv
  up_tentacron
  if [ "$DO_FIXTURES" = 1 ]; then load_fixtures; fi

  cat > "$PORTS_FILE" <<EOF
PREFIX=$PREFIX
TENTACRON_HOST_PORT=$TENTACRON_HOST_PORT
PYLOVO_HOST_PORT=$PYLOVO_HOST_PORT
NET_HEAT=$NET_HEAT
NET_PYLOVO=$NET_PYLOVO
EOF

  cat <<EOF

$(printf '%s' "$GREEN")Heat stack up under prefix '$PREFIX'$(printf '%s' "$NC")
  TentaCron   http://localhost:$TENTACRON_HOST_PORT     (the stack's only entry point)
  PyLovo      http://localhost:$PYLOVO_HOST_PORT
  networks    $NET_HEAT, $NET_PYLOVO  (private; no host ports on the other services)
  workdir     $WORKDIR

Reach the private services through their containers:
  docker exec $PREFIX-city2tabula-db psql -U postgres -l
  docker logs -f $PREFIX-tentacron-env-tentacron-1

Tear down with: $0 --prefix $PREFIX down
EOF
}

cmd_status() {
  log "containers for prefix '$PREFIX'"
  docker ps -a --filter "name=^$PREFIX-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo
  log "networks"
  docker network ls --filter "name=$PREFIX-" --format 'table {{.Name}}\t{{.Driver}}'
  if [ -f "$PORTS_FILE" ]; then echo; log "ports"; cat "$PORTS_FILE"; fi
  return 0
}

cmd_fixtures() {
  log "loading fixtures (weather, city2tabula, pylovo)"
  [ -n "$FIXTURES_DIR" ] && export FIXTURES_DIR
  # load.sh is idempotent — "load what is missing, leave what is present" —
  # so a clean run over all three sets proves the data is in place, and any
  # gap it finds it reloads.
  if C2T_DB_CONTAINER="$PREFIX-city2tabula-db" \
     PYLOVO_DB_CONTAINER="$PREFIX-pylovo-postgres" \
     bash "$LOAD_SH" weather city2tabula pylovo; then
    ok "all fixture sets are loaded"
  else
    die "at least one fixture set failed to load"
  fi
}

# down_one LABEL DIR BASE OVR PROJECT [compose args...]
# `down` interpolates the compose files too, so the services whose files use
# ${VAR:?} need the same variables and env files `up` gave them.
down_one() {
  local label="$1" dir="$2" base="$3" ovr="$4" project="$5"; shift 5
  if [ ! -d "$dir" ]; then return 0; fi
  log "  down $label"
  ( cd "$dir" && docker compose -p "$project" "$@" -f "$base" -f "$OVR_DIR/$ovr" down "${vol[@]+"${vol[@]}"}" ) \
    || warn "$label did not come down cleanly"
}

cmd_down() {
  local -a vol=()
  if [ "$DOWN_VOLUMES" = 1 ]; then vol=(--volumes); fi
  log "stopping prefix '$PREFIX'"

  down_one tentacron "$tentacron_dir/environment" docker-compose.yml tentacron.yml \
    "$PREFIX-tentacron-env" --env-file .env.dev
  down_one meme "$meme_dir/environment" docker-compose.yml meme.yml \
    "$PREFIX-meme-env" --env-file .env.dev
  down_one pv "$pv_dir" docker-compose.yml pv-service.yml \
    "$PREFIX-pv-service"
  down_one buem "$buem_dir/environment/http" docker-compose.yml buem.yml \
    "$PREFIX-buem-gateway-http"
  down_one city2tabula "$c2t_dir/environment/http" docker-compose.yml city2tabula.yml \
    "$PREFIX-city2tabula" --env-file docker.env
  down_one ignis "$ignis_dir/environment/http" docker-compose.prod.yml ignis.yml \
    "$PREFIX-ignis-http"
  down_one pylovo "$pylovo_dir" docker-compose.dev.yml pylovo.yml \
    "$PREFIX-pylovo"

  # weather's file requires WEATHER_API_KEYS with ${...:?}, so it needs the
  # value in the environment, not a compose flag.
  if [ -d "$weather_dir" ]; then
    log "  down weather"
    ( cd "$weather_dir" \
        && WEATHER_API_KEYS="$WEATHER_API_KEY" \
           WEATHER_IMAGE="ghcr.io/enerplanet/weather:$WEATHER_IMAGE_TAG" \
           docker compose -p "$PREFIX-weather" \
             -f infrastructure/container/docker-compose.serve.yml -f "$OVR_DIR/weather.yml" \
             down "${vol[@]+"${vol[@]}"}" ) \
      || warn "weather did not come down cleanly"
  fi

  if [ "$DOWN_VOLUMES" = 1 ]; then warn "volumes of prefix '$PREFIX' were removed too"; fi
  ok "prefix '$PREFIX' stopped"
}

# ── Run ───────────────────────────────────────────────────────────────────────
case "$COMMAND" in
  render)
    preflight
    resolve_ports
    write_overrides
    if [ "$DRY_RUN" = 1 ]; then
      log "dry run: nothing else touched"
      exit 0
    fi
    clone_repos
    if [ "$DO_FIXTURES" = 1 ]; then pull_fixtures; fi
    validate_overrides
    ;;
  up)
    preflight
    if [ "$DRY_RUN" != 1 ]; then
      stop_published_containers
    fi
    resolve_ports
    if [ "$DRY_RUN" = 1 ]; then
      log "dry run: would deploy prefix '$PREFIX' in $WORKDIR"
      log "  TentaCron on host port $TENTACRON_HOST_PORT, PyLovo on $PYLOVO_HOST_PORT"
      log "  networks $NET_HEAT and $NET_PYLOVO"
      exit 0
    fi
    mkdir -p "$WORKDIR"
    write_overrides
    clone_repos
    if [ "$DO_FIXTURES" = 1 ]; then pull_fixtures; fi
    validate_overrides
    cmd_up
    ;;
  status)   preflight; cmd_status ;;
  fixtures) preflight; cmd_fixtures ;;
  down)     preflight; cmd_down ;;
esac
