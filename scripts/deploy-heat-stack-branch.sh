#!/usr/bin/env bash
#
# deploy-heat-stack-branch.sh: build the EnerPlanET heat stack and PyLovo from
# the tip of each service's repos.conf _BRANCH and run it beside an existing
# installation, with every container, network and published port namespaced
# under a prefix. Test data is loaded by scripts/deploy-fixture.sh.
#
# Each service is checked out into dependencies/<_DIR> and started with
#   docker compose -f <_COMPOSE> [--env-file <_ENV_FILE>] -f <override> up <_SERVICES>
# where the override is generated here to apply the prefix. A variable already
# set in the environment wins over repos.conf, e.g. CITY2TABULA_BRANCH=feat/x.
# Needs git, git-lfs, make and Docker Compose 2.24+ (for `!reset`/`!override`).
#
#   scripts/deploy-heat-stack-branch.sh --prefix sim2 up
#   scripts/deploy-heat-stack-branch.sh --prefix sim2 status
#   scripts/deploy-heat-stack-branch.sh --prefix sim2 down [--volumes]
#
# Options:
#   --prefix NAME          name every container, network and volume (required)
#   --tentacron-port N     host port for TentaCron (default 8400, or next free)
#   --pylovo-port N        host port for PyLovo    (default 8186, or next free)
#   --weather-api-key K    key TentaCron presents to weather-serve
#   --volumes              `down` also removes this stack's volumes
#
# The heat services address each other by network aliases each repository
# declares (ignis, weather, meme, ...). This stack owns private networks, so
# those names cannot clash with another stack's.
#
set -euo pipefail

PREFIX=""
TENTACRON_HOST_PORT=""
PYLOVO_HOST_PORT=""
WEATHER_API_KEY=${WEATHER_API_KEY:-dev-weather-key}  # matches TentaCron's .env.dev
DOWN_VOLUMES=0
COMMAND="up"

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'warn %s\n' "$*" >&2; }
die()  { printf 'err  %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)          PREFIX="${2:?--prefix needs a value}"; shift 2 ;;
    --tentacron-port)  TENTACRON_HOST_PORT="${2:?}"; shift 2 ;;
    --pylovo-port)     PYLOVO_HOST_PORT="${2:?}"; shift 2 ;;
    --weather-api-key) WEATHER_API_KEY="${2:?}"; shift 2 ;;
    --volumes)         DOWN_VOLUMES=1; shift ;;
    -h|--help)         awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "$0"; exit 0 ;;
    up|status|down)    COMMAND="$1"; shift ;;
    *)                 die "unknown argument '$1' (try --help)" ;;
  esac
done

[[ "$PREFIX" =~ ^[a-z0-9][a-z0-9-]*$ ]] \
  || die "--prefix '$PREFIX' must be lowercase letters, digits and dashes"

REPO_ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DEPS_DIR="$REPO_ROOT/dependencies"
WORKDIR="$REPO_ROOT/.local/heat-stack/$PREFIX"  # deploy-fixture.sh reads it too
OVR_DIR="$WORKDIR/overrides"
NET_HEAT="$PREFIX-tentacron-net"
NET_PYLOVO="$PREFIX-pylovo-net"

while IFS='=' read -r key value; do
  if [[ $key =~ ^[A-Z0-9_]+$ ]] && [ -z "${!key:-}" ]; then export "$key=$value"; fi
done < "$REPO_ROOT/repos.conf"

# repos.conf key and compose project name (the repository's), in start order:
# PyLovo first because city2tabula's db links to its database via postgres_fdw.
SERVICES=(
  "PYLOVO       pylovo"
  "IGNIS        ignis"
  "CITY2TABULA  city2tabula"
  "WEATHER      weather"
  "BUEM         buem-gateway"
  "MEME         meme"
  "PV_SERVICE   pysam-pv"
  "TENTACRON    tentacron"
)

for entry in "${SERVICES[@]}" "BUEM_MODEL -"; do
  read -r svc _ <<<"$entry"
  for suffix in REPO DIR BRANCH; do
    var="${svc}_$suffix"
    [ -n "${!var:-}" ] || die "repos.conf sets no $var"
  done
done

# Branch builds are tagged per prefix so they never replace a release image.
for var in BUEM_GATEWAY_IMAGE_TAG BUEM_MODEL_IMAGE_TAG IGNIS_IMAGE_TAG \
           CITY2TABULA_IMAGE_TAG WEATHER_IMAGE_TAG C2T_IMAGE_TAG; do
  export "$var=$PREFIX-branch"
done
export WEATHER_API_KEYS="$WEATHER_API_KEY"
export WEATHER_IMAGE="ghcr.io/enerplanet/weather:$WEATHER_IMAGE_TAG"
export RELEASE_IMAGE="ghcr.io/enerplanet/tentacron:$PREFIX-branch"
export WEATHER_DATA_DIR_HOST="$DEPS_DIR/$WEATHER_DIR/data"

# port_free PORT: nothing on the host, Docker included, listens on it.
port_free() {
  ! ss -Hltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" \
    && ! docker ps --format '{{.Ports}}' | grep -qE "(^|,| )[^ ]*:$1->"
}

# pick_port WANTED LABEL: prints WANTED, or the next free port above it.
pick_port() {
  local p="$1"
  until port_free "$p"; do
    p=$((p + 1))
    [ "$p" -le $(($1 + 100)) ] || die "no free port for $2 within 100 above $1"
  done
  [ "$p" = "$1" ] || warn "$2: host port $1 is in use, using $p"
  echo "$p"
}

# checkout DIR REPO BRANCH: clone, or move a detached checkout, to the tip of
# origin/BRANCH. A checkout on a local branch may hold work and is left alone.
checkout() {
  local path="$DEPS_DIR/$1" ref="origin/$3"
  if [ ! -d "$path/.git" ]; then
    # Detached at once: a clone left on its default branch by a failed
    # checkout below would otherwise pass for local work on the next run.
    git clone -q "$2" "$path"
    git -C "$path" checkout -q --detach
  elif [ "$(git -C "$path" rev-parse --abbrev-ref HEAD)" != "HEAD" ]; then
    warn "$path is on a local branch; building it as it is (wanted $ref)"
    return 0
  else
    git -C "$path" fetch -q --tags origin
  fi
  git -C "$path" checkout -q "$ref" || die "cannot check out $ref in $path"
  git -C "$path" lfs pull || die "git lfs pull failed in $path"
  log "$1 at $ref ($(git -C "$path" rev-parse --short HEAD))"
}

# compose SVC PROJECT ARGS...: docker compose for one service, from its checkout.
compose() {
  local svc="$1" project="$2"; shift 2
  local dir="${svc}_DIR" file="${svc}_COMPOSE" env="${svc}_ENV_FILE" ovr="${svc,,}"
  local -a args=(-p "$PREFIX-$project" -f "${!file:?repos.conf sets no $file}")
  if [ -n "${!env:-}" ]; then args+=(--env-file "${!env}"); fi
  args+=(-f "$OVR_DIR/${ovr//_/-}.yml")
  (cd "$DEPS_DIR/${!dir}" && docker compose "${args[@]}" "$@")
}

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

  # buem-gateway's compose only pulls the model; build it from enerplanet/buem.
  cat > "$OVR_DIR/buem.yml" <<EOF
services:
  model:
    build:
      context: $DEPS_DIR/$BUEM_MODEL_DIR
      dockerfile: infrastructure/container/Dockerfile
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

  cat > "$OVR_DIR/meme.yml" <<EOF
services:
  api:
    ports: !reset []
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
}

cmd_up() {
  TENTACRON_HOST_PORT="$(pick_port "${TENTACRON_HOST_PORT:-$TENTACRON_PORT}" tentacron)"
  PYLOVO_HOST_PORT="$(pick_port "${PYLOVO_HOST_PORT:-8186}" pylovo)"
  write_overrides

  mkdir -p "$DEPS_DIR"
  checkout "$BUEM_MODEL_DIR" "$BUEM_MODEL_REPO" "$BUEM_MODEL_BRANCH"
  local entry svc project repo dir branch services
  for entry in "${SERVICES[@]}"; do
    read -r svc _ <<<"$entry"
    repo="${svc}_REPO"; dir="${svc}_DIR"; branch="${svc}_BRANCH"
    checkout "${!dir}" "${!repo}" "${!branch}"
  done

  # PyLovo's dev compose reads .env.docker. Upstream's `make dev` would also
  # load the platform's database, which this stack does not have.
  [ -s "$DEPS_DIR/$PYLOVO_DIR/.env.docker" ] \
    || cp "$DEPS_DIR/$PYLOVO_DIR/.env.example" "$DEPS_DIR/$PYLOVO_DIR/.env.docker"
  # Bind-mount sources Docker would otherwise create owned by root, which
  # deploy-fixture.sh then cannot copy into.
  mkdir -p "$WEATHER_DATA_DIR_HOST" "$DEPS_DIR/$CITY2TABULA_DIR/data/lod2" \
    "$DEPS_DIR/$CITY2TABULA_DIR/data/lod3" "$DEPS_DIR/$CITY2TABULA_DIR/data/attributes"

  for entry in "${SERVICES[@]}"; do
    read -r svc project <<<"$entry"
    services="${svc}_SERVICES"
    log "up $svc"
    compose "$svc" "$project" up -d --build ${!services:-}
  done

  printf 'PREFIX=%s\nTENTACRON_HOST_PORT=%s\nPYLOVO_HOST_PORT=%s\n' \
    "$PREFIX" "$TENTACRON_HOST_PORT" "$PYLOVO_HOST_PORT" > "$WORKDIR/ports.env"
  cat <<EOF

Heat stack up under prefix '$PREFIX'
  TentaCron  http://localhost:$TENTACRON_HOST_PORT
  PyLovo     http://localhost:$PYLOVO_HOST_PORT
  networks   $NET_HEAT, $NET_PYLOVO

Load test data: scripts/deploy-fixture.sh --prefix $PREFIX /path/to/enerplanet-test-data/vN
Tear down:      $0 --prefix $PREFIX down
EOF
}

cmd_down() {
  [ -d "$OVR_DIR" ] || die "no deployment for prefix '$PREFIX' in $WORKDIR"
  local -a vol=()
  if [ "$DOWN_VOLUMES" = 1 ]; then vol=(--volumes); fi
  local i svc project dir
  for ((i = ${#SERVICES[@]} - 1; i >= 0; i--)); do
    read -r svc project <<<"${SERVICES[i]}"
    dir="${svc}_DIR"
    [ -d "$DEPS_DIR/${!dir}" ] || continue
    log "down $svc"
    compose "$svc" "$project" down "${vol[@]}" || warn "$svc did not come down cleanly"
  done
}

cmd_status() {
  docker ps -a --filter "name=^$PREFIX-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  docker network ls --filter "name=^$PREFIX-" --format 'table {{.Name}}'
  # fixture.env is written by scripts/deploy-fixture.sh.
  cat "$WORKDIR/ports.env" "$WORKDIR/fixture.env" 2>/dev/null || true
}

case "$COMMAND" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  status) cmd_status ;;
esac
