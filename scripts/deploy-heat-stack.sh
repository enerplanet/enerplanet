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
#   Each service runs from its repos.conf _COMPOSE file (and _ENV_FILE) plus an
#   override generated here and passed with `-f`:
#     * compose project name      -> <prefix>-<repository>     (via -p)
#     * shared network tentacron-net -> <prefix>-tentacron-net (name: override)
#     * the platform's spatialhub-net -> <prefix>-pylovo-net   (external: !reset)
#     * every published port      -> removed, except TentaCron and PyLovo
#   Containers are therefore named <prefix>-<repository>-<service>-1. The
#   upstream compose files are never edited.
#
# The heat services address each other by network aliases each repository
# declares (ignis, weather, meme, ...). This stack owns private networks, so
# those names cannot clash with another stack's.
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
  --pylovo-port N        host port for PyLovo    (default 8187)
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

# Every _REPO, _DIR, _BRANCH, _PORT and image tag, from repos.conf, the
# single record of what the platform runs.
REPOS_CONF="$REPO_ROOT/repos.conf"
[ -f "$REPOS_CONF" ] || die "$REPO_ROOT has no repos.conf — is it an enerplanet checkout? Use --repo DIR"
while IFS='=' read -r key value; do
  if [[ $key =~ ^[A-Z0-9_]+$ ]] && [ -z "${!key:-}" ]; then export "$key=$value"; fi
done < "$REPOS_CONF"
for var in TENTACRON_REPO TENTACRON_DIR TENTACRON_BRANCH TENTACRON_PORT \
           MEME_REPO MEME_DIR MEME_BRANCH \
           BUEM_REPO BUEM_DIR BUEM_BRANCH BUEM_IMAGE_TAG BUEM_MODEL_IMAGE_TAG \
           IGNIS_REPO IGNIS_DIR IGNIS_BRANCH IGNIS_IMAGE_TAG \
           CITY2TABULA_REPO CITY2TABULA_DIR CITY2TABULA_BRANCH CITY2TABULA_IMAGE_TAG \
           WEATHER_REPO WEATHER_DIR WEATHER_BRANCH WEATHER_IMAGE_TAG \
           PV_SERVICE_REPO PV_SERVICE_DIR PV_SERVICE_BRANCH PV_SERVICE_IMAGE_TAG \
           PYLOVO_REPO PYLOVO_DIR PYLOVO_BRANCH; do
  [ -n "${!var:-}" ] || die "$REPOS_CONF sets no $var"
done
# The release images each compose file reads, under the names it reads them.
export BUEM_GATEWAY_IMAGE_TAG="$BUEM_IMAGE_TAG" BUEM_MODEL_IMAGE_TAG IGNIS_IMAGE_TAG
export C2T_IMAGE_TAG="$CITY2TABULA_IMAGE_TAG"
export WEATHER_IMAGE="ghcr.io/enerplanet/weather:$WEATHER_IMAGE_TAG"
export WEATHER_API_KEYS="$WEATHER_API_KEY"
# Services without a published release are built; the per-prefix tag keeps the
# local build from replacing a pulled release image of the same name.
export RELEASE_IMAGE="ghcr.io/enerplanet/tentacron:$PREFIX-build"

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
# would see its own containers holding the reserved host ports and stop. Stop
# the two containers that publish to the host, so the port check that follows
# finds them free. Only the two
# published services matter: every other service of the stack is private.
stop_published_containers() {
  local name
  for name in "${PREFIX}-tentacron-api-1" "${PREFIX}-pylovo-api-1"; do
    if docker ps --format '{{.Names}}' | grep -qx "$name"; then
      log "stopping running $name (frees its host ports for re-selection)"
      docker stop "$name" || warn "could not stop $name; its ports may be scanned as busy"
    fi
  done
}

# The two ports this stack publishes; every other service is reachable only by
# name on the stack's networks. Production reserves 8400 and 8187 for them, so
# a taken port aborts instead of moving (a redeploy stops its own containers
# first, so it gets its ports back).
resolve_ports() {
  TENTACRON_HOST_PORT="${TENTACRON_HOST_PORT:-$TENTACRON_PORT}"
  PYLOVO_HOST_PORT="${PYLOVO_HOST_PORT:-8187}"
  require_port "$TENTACRON_HOST_PORT" tentacron --tentacron-port
  require_port "$PYLOVO_HOST_PORT" pylovo --pylovo-port
}

# require_port PORT LABEL FLAG: abort when PORT is already taken.
require_port() {
  if port_in_use "$1"; then
    die "$2: host port $1 is already in use; stop what holds it, or pass $3 N"
  fi
}

# ── Repositories ──────────────────────────────────────────────────────────────
# checkout DIR REPO BRANCH: clone and detach at the tip of origin/BRANCH, or
# move an existing detached checkout there. A checkout on a local branch may
# be someone's work and is left alone. A fresh clone is detached at once, so a
# failed checkout is retried on the next run rather than taken for local work.
checkout() {
  local dir="$1" repo="$2" ref="origin/$3" path="$DEPS_DIR/$1"
  if [ ! -d "$path/.git" ]; then
    log "cloning $dir"
    git clone -q "$repo" "$path"
    git -C "$path" checkout -q --detach
  elif [ "$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)" != "HEAD" ]; then
    warn "$path is on a local branch; leaving it alone (wanted: $ref)"
    return 0
  else
    git -C "$path" fetch -q --tags origin
  fi
  git -C "$path" checkout -q "$ref" || die "cannot check out $ref in $path"
  ok "$dir -> $ref ($(git -C "$path" rev-parse --short HEAD))"
}

clone_repos() {
  mkdir -p "$DEPS_DIR"
  checkout "$TENTACRON_DIR"      "$TENTACRON_REPO"      "$TENTACRON_BRANCH"
  checkout "$MEME_DIR"           "$MEME_REPO"           "$MEME_BRANCH"
  checkout "$BUEM_DIR"           "$BUEM_REPO"           "$BUEM_BRANCH"
  checkout "$IGNIS_DIR"          "$IGNIS_REPO"          "$IGNIS_BRANCH"
  checkout "$CITY2TABULA_DIR"    "$CITY2TABULA_REPO"    "$CITY2TABULA_BRANCH"
  checkout "$WEATHER_DIR"        "$WEATHER_REPO"        "$WEATHER_BRANCH"
  checkout "$PV_SERVICE_DIR"     "$PV_SERVICE_REPO"     "$PV_SERVICE_BRANCH"
  checkout "$PYLOVO_DIR"         "$PYLOVO_REPO"         "$PYLOVO_BRANCH"
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

  cat > "$OVR_DIR/ignis.yml" <<EOF
services:
  api:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  cat > "$OVR_DIR/buem.yml" <<EOF
services:
  api:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # The db joins the PyLovo network so postgres_fdw reaches this stack's
  # PyLovo postgres, never the host's.
  cat > "$OVR_DIR/city2tabula.yml" <<EOF
services:
  db:
    networks:
      default:
      spatialhub-net:
  api:
    ports: !reset []
    environment:
      PYLOVO_FDW_HOST: postgres
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

  cat > "$OVR_DIR/weather.yml" <<EOF
services:
  api:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # TentaCron calls meme:8080; meme's own compose declares no such alias.
  cat > "$OVR_DIR/meme.yml" <<EOF
services:
  api:
    ports: !reset []
    networks:
      tentacron-net:
        aliases: [meme]
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  cat > "$OVR_DIR/pv-service.yml" <<EOF
services:
  api:
    ports: !reset []
networks:
  tentacron-net:
    name: $NET_HEAT
EOF

  # Upstream declares spatialhub-net external (the platform's); here it is
  # this stack's own.
  cat > "$OVR_DIR/tentacron.yml" <<EOF
services:
  api:
    ports: !override ["$TENTACRON_HOST_PORT:8080"]
networks:
  tentacron-net:
    name: $NET_HEAT
  spatialhub-net:
    name: $NET_PYLOVO
    external: !reset
EOF

  # PyLovo's dev file borrows the platform's postgres and redis; this stack
  # brings its own, on the network city2tabula's db also joins.
  cat > "$OVR_DIR/pylovo.yml" <<EOF
services:
  api:
    ports: !override ["$PYLOVO_HOST_PORT:8086"]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
  postgres:
    image: pgrouting/pgrouting:17-3.5-3.7.3
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
# repos.conf key, compose project name (the repository's) and how its image is
# obtained, in start order: PyLovo first because city2tabula's db links to its
# database via postgres_fdw.
SERVICES=(
  "PYLOVO       pylovo        build"
  "IGNIS        ignis         pull"
  "CITY2TABULA  city2tabula   pull"
  "WEATHER      weather       pull"
  "BUEM         buem-gateway  pull"
  "MEME         meme          build"
  "PV_SERVICE   pysam-pv      pull"
  "TENTACRON    tentacron     build"
)

# compose SVC PROJECT ARGS...: docker compose for one service, from its checkout.
compose() {
  local svc="$1" project="$2"; shift 2
  local dir="${svc}_DIR" file="${svc}_COMPOSE" env="${svc}_ENV_FILE" ovr="${svc,,}"
  local -a args=(-p "$PREFIX-$project" -f "${!file:?repos.conf sets no $file}")
  if [ -n "${!env:-}" ]; then args+=(--env-file "${!env}"); fi
  args+=(-f "$OVR_DIR/${ovr//_/-}.yml")
  (cd "$DEPS_DIR/${!dir}" && docker compose "${args[@]}" "$@")
}

# up_service SVC PROJECT MODE: pull the pinned release image, or build.
# --remove-orphans clears containers of services an older layout named
# differently in the same project.
up_service() {
  local svc="$1" project="$2" mode="$3" services="${1}_SERVICES"
  log "$svc ($mode)"
  if [ "$mode" = pull ]; then
    compose "$svc" "$project" pull ${!services:-}
    compose "$svc" "$project" up -d --no-build --remove-orphans ${!services:-}
  else
    compose "$svc" "$project" up -d --build --remove-orphans ${!services:-}
  fi
}

# PyLovo's dev compose reads .env.docker; upstream's `make dev` copies it from
# .env.example and would then run load-full-db against the platform's postgres,
# which does not exist here. The copy is done, the loader is not.
pylovo_env() {
  local dir="$DEPS_DIR/$PYLOVO_DIR"
  if [ ! -s "$dir/.env.docker" ]; then
    cp "$dir/.env.example" "$dir/.env.docker"
    ok "created $PYLOVO_DIR/.env.docker from .env.example"
  fi
}

# Container names follow compose's <project>-<service>-1.
C2T_DB="$PREFIX-city2tabula-db-1"
PYLOVO_DB="$PREFIX-pylovo-postgres-1"

load_fixtures() {
  log "loading fixtures (weather, city2tabula, pylovo)"
  [ -n "$FIXTURES_DIR" ] && export FIXTURES_DIR
  # load.sh takes the target containers from the environment and its checkouts
  # from <repo root>/dependencies, which is this repo's own layout.
  C2T_DB_CONTAINER="$C2T_DB" PYLOVO_DB_CONTAINER="$PYLOVO_DB" bash "$LOAD_SH" \
    || warn "the fixture loader reported failures; the stack is up but may lack data"
}

# ── Commands ──────────────────────────────────────────────────────────────────
validate_overrides() {
  log "validating the rendered compose files"
  local failed=0 entry svc project
  pylovo_env
  for entry in "${SERVICES[@]}"; do
    read -r svc project _ <<<"$entry"
    compose "$svc" "$project" config -q || { warn "$svc does not render"; failed=1; }
  done
  [ "$failed" = 0 ] || die "at least one compose file failed to validate"
  ok "all ${#SERVICES[@]} compose projects render"
}

cmd_up() {
  [ -d "$DEPS_DIR" ] || die "no checkouts in $DEPS_DIR; run 'render' first or drop --dry-run"
  # A root-owned bind-mount source breaks the fixture loader.
  mkdir -p "$DEPS_DIR/$WEATHER_DIR/data"
  local entry svc project mode
  for entry in "${SERVICES[@]}"; do
    read -r svc project mode <<<"$entry"
    up_service "$svc" "$project" "$mode"
  done
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
  docker exec $C2T_DB psql -U postgres -l
  docker logs -f $PREFIX-tentacron-api-1

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
  if C2T_DB_CONTAINER="$C2T_DB" PYLOVO_DB_CONTAINER="$PYLOVO_DB" \
     bash "$LOAD_SH" weather city2tabula pylovo; then
    ok "all fixture sets are loaded"
  else
    die "at least one fixture set failed to load"
  fi
}

cmd_down() {
  [ -d "$OVR_DIR" ] || die "no deployment for prefix '$PREFIX' in $WORKDIR"
  local -a vol=()
  if [ "$DOWN_VOLUMES" = 1 ]; then vol=(--volumes); fi
  log "stopping prefix '$PREFIX'"
  local i svc project dir
  for ((i = ${#SERVICES[@]} - 1; i >= 0; i--)); do
    read -r svc project _ <<<"${SERVICES[i]}"
    dir="${svc}_DIR"
    [ -d "$DEPS_DIR/${!dir}" ] || continue
    log "  down $svc"
    compose "$svc" "$project" down "${vol[@]+"${vol[@]}"}" || warn "$svc did not come down cleanly"
  done
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
