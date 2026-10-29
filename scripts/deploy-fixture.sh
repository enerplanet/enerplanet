#!/usr/bin/env bash
#
# deploy-fixture.sh: load one version of the EnerPlanET test data (3D
# buildings, building attributes, weather and PyLovo grids) into a heat stack
# running under the same prefix.
#
#   scripts/deploy-fixture.sh --prefix sim2 /path/to/enerplanet-test-data/v2
#
# The folder holds any of 3d/<country>/<provider>/, attributes/<country>/<provider>/,
# weather/<provider>/<country>/output/ and pylovo/<name>.sql.gz. Files are added
# to what is there; the PyLovo dump replaces the stack's PyLovo database as a
# whole.
# scripts/deploy-fixture.md describes the layout and how to add a region.
#
set -euo pipefail

PREFIX=""
FIXTURE_DIR=""
WORKDIR=""

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'
RED=$'\033[0;31m'; NC=$'\033[0m'

log()  { printf '%s==>%s %s\n' "$CYAN" "$NC" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%swarn%s %s\n' "$YELLOW" "$NC" "$*" >&2; }
die()  { printf '%serr %s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

usage() {
  awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"
  cat <<'USAGE'

Usage: deploy-fixture.sh --prefix NAME [--workdir DIR] FIXTURE_DIR

Options:
  --prefix NAME     the prefix the stack was deployed under (required)
  --workdir DIR     where fixture.env records the loaded version
                    (default <repo>/.local/heat-stack/NAME, as deploy-heat-stack.sh)
  -h, --help        this text
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)  PREFIX="${2:?--prefix needs a value}"; shift 2 ;;
    --workdir) WORKDIR="${2:?--workdir needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*)        die "unknown option '$1' (try --help)" ;;
    *)         [ -z "$FIXTURE_DIR" ] || die "only one fixture folder, got '$FIXTURE_DIR' and '$1'"
               FIXTURE_DIR="$1"; shift ;;
  esac
done

[ -n "$PREFIX" ] || die "--prefix is required (try --help)"
[ -n "$FIXTURE_DIR" ] || die "no fixture folder given (try --help)"
[ -d "$FIXTURE_DIR" ] || die "fixture folder $FIXTURE_DIR does not exist"
FIXTURE_DIR="$(cd "$FIXTURE_DIR" && pwd)"

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
WORKDIR="${WORKDIR:-$SELF_DIR/../.local/heat-stack/$PREFIX}"

C2T="$PREFIX-city2tabula"
C2T_DB="$PREFIX-city2tabula-db"
PYLOVO_DB="$PREFIX-pylovo-postgres"
WEATHER="$PREFIX-weather-serve"

# Must match isoByCountry in city2tabula's internal/config/country.go: the
# server names each country's database <DB_NAME>_<code>.
COUNTRIES="austria:at belgium:be bulgaria:bg cyprus:cy czechia:cz denmark:dk
  france:fr germany:de greece:gr hungary:hu ireland:ie italy:it netherlands:nl
  norway:no poland:pl serbia:rs slovenia:si spain:es sweden:se united_kingdom:gb"

code_of() {
  local pair
  for pair in $COUNTRIES; do
    if [ "${pair%%:*}" = "$1" ]; then echo "${pair#*:}"; return 0; fi
  done
  return 1
}

country_of() {
  local pair
  for pair in $COUNTRIES; do
    if [ "${pair#*:}" = "$1" ]; then echo "${pair%%:*}"; return 0; fi
  done
  return 1
}

require_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ] \
    || die "container $1 is not running; deploy the heat stack under prefix '$PREFIX' first"
}

# mount_source CONTAINER PATH: the host directory bind-mounted at PATH.
mount_source() {
  local src
  src="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}" "$1")"
  [ -n "$src" ] || die "$1 has no bind mount at $2"
  echo "$src"
}

# copy_new SRC DEST: copies each file under SRC that DEST lacks. A file that
# exists with different content is reported and kept, because City2TABULA
# skips files it has already imported and would not pick up the change.
copy_new() {
  local src="$1" dest="$2" rel copied=0 denied
  # Docker creates a missing bind-mount source owned by root.
  denied="$(find "$dest" -type d ! -writable -print -quit)"
  [ -z "$denied" ] || die "$denied is not writable by $(id -un) (owner $(stat -c %U "$denied")); run: sudo chown -R $(id -un): $dest"
  while IFS= read -r rel; do
    if [ ! -e "$dest/$rel" ]; then
      mkdir -p "$(dirname "$dest/$rel")"
      cp "$src/$rel" "$dest/$rel"
      copied=$((copied + 1))
    elif ! cmp -s "$src/$rel" "$dest/$rel"; then
      warn "$dest/$rel differs from the fixture copy; kept the existing file"
    fi
  done < <(cd "$src" && find . -type f | sed 's|^\./||')
  ok "${src#"$FIXTURE_DIR"/}: $copied new file(s) in $dest"
}

c2t_psql() {
  docker exec -i -e PGPASSWORD="$C2T_DB_PASSWORD" "$C2T_DB" \
    psql -U "$C2T_DB_USER" -v ON_ERROR_STOP=1 -qtA "$@"
}

c2t_cli() {
  local country="$1"; shift
  docker exec -e COUNTRY="$country" "$C2T" ./c2t "$@"
}

# import_country COUNTRY: imports the files City2TABULA has not imported yet,
# creating the country's database on its first import.
import_country() {
  local country="$1" db
  db="${C2T_DB_NAME}_$(code_of "$country")"
  if [ -z "$(c2t_psql -d postgres -c "select 1 from pg_database where datname = '$db'")" ]; then
    log "City2TABULA $country: creating $db"
    c2t_cli "$country" -create-db
  elif [ "$(c2t_psql -d "$db" -c "select to_regnamespace('citydb') is not null and to_regnamespace('lod2') is not null and to_regnamespace('tabula') is not null")" != t ]; then
    die "$db in $C2T_DB holds only a restored repository fixture (deploy-heat-stack.sh without --no-fixtures) and cannot take an import; drop it first"
  else
    log "City2TABULA $country: importing new files into $db"
    c2t_cli "$country" -import-data
  fi
  ok "City2TABULA $country: imported"
}

load_3d() {
  local lod2 attrs dir country
  lod2="$(mount_source "$C2T" /app/data/lod2)"
  attrs="$(mount_source "$C2T" /app/data/attributes)"
  local -A countries=()
  for dir in "$FIXTURE_DIR"/3d/*/ "$FIXTURE_DIR"/attributes/*/; do
    [ -d "$dir" ] || continue
    country="$(basename "$dir")"
    code_of "$country" >/dev/null \
      || die "$dir: $country is not a City2TABULA country; use one of: $(sed 's/:[a-z]*//g' <<<"$COUNTRIES" | xargs)"
    countries["$country"]=1
  done
  if [ -d "$FIXTURE_DIR/3d" ]; then copy_new "$FIXTURE_DIR/3d" "$lod2"; fi
  if [ -d "$FIXTURE_DIR/attributes" ]; then copy_new "$FIXTURE_DIR/attributes" "$attrs"; fi
  for country in "${!countries[@]}"; do import_country "$country"; done
}

# weather-serve looks up <provider>/<country>/output under /data on every
# request, so files copied in are served without a restart.
load_weather() {
  require_running "$WEATHER"
  copy_new "$FIXTURE_DIR/weather" "$(mount_source "$WEATHER" /data)"
}

# load_pylovo DUMP: restores DUMP into a fresh database and swaps it in for
# the stack's PyLovo database only once the restore has succeeded.
load_pylovo() {
  local dump="$1" user pass db load
  user="$(docker exec "$PYLOVO_DB" printenv POSTGRES_USER)"
  pass="$(docker exec "$PYLOVO_DB" printenv POSTGRES_PASSWORD)"
  db="$(docker exec "$PYLOVO_DB" printenv POSTGRES_DB)"
  load="${db}_load"
  pg() { docker exec -i -e PGPASSWORD="$pass" -e PGOPTIONS=--client-min-messages=warning "$PYLOVO_DB" psql -U "$user" -v ON_ERROR_STOP=1 -qtA "$@"; }

  log "PyLovo: restoring $(basename "$dump") into $load"
  pg -d postgres -c "drop database if exists \"$load\""
  pg -d postgres -c "create database \"$load\""
  if ! gzip -dc "$dump" | pg -d "$load" >/dev/null; then
    pg -d postgres -c "drop database \"$load\""
    die "PyLovo: restoring $dump failed; $db was left as it was"
  fi
  pg -d postgres -c "drop database if exists \"$db\" with (force)"
  pg -d postgres -c "alter database \"$load\" rename to \"$db\""
  ok "PyLovo: $db replaced by $(basename "$dump")"
}

# relink_all: re-runs the PyLovo link for every country database that has
# one, since the links name grid buildings of the database just replaced.
relink_all() {
  local db code country
  for db in $(c2t_psql -d postgres -c "select datname from pg_database where datname like '${C2T_DB_NAME}\_%'"); do
    code="${db#"${C2T_DB_NAME}"_}"
    country="$(country_of "$code")" || continue
    [ "$(c2t_psql -d "$db" -c "select to_regclass('city2tabula.building_link') is not null")" = t ] || continue
    log "City2TABULA $country: relinking to the new PyLovo grids"
    c2t_cli "$country" -link-pylovo -relink
  done
}

shopt -s nullglob
dumps=("$FIXTURE_DIR"/pylovo/*.sql.gz)
shopt -u nullglob
[ "${#dumps[@]}" -le 1 ] || die "$FIXTURE_DIR/pylovo holds ${#dumps[@]} dumps; keep exactly one"
[ -d "$FIXTURE_DIR/3d" ] || [ -d "$FIXTURE_DIR/attributes" ] || [ -d "$FIXTURE_DIR/weather" ] \
  || [ "${#dumps[@]}" = 1 ] || die "$FIXTURE_DIR has no 3d/, attributes/, weather/ or pylovo/*.sql.gz"

command -v docker >/dev/null || die "docker not found"
require_running "$C2T"
require_running "$C2T_DB"
require_running "$PYLOVO_DB"

C2T_DB_NAME="$(docker exec "$C2T" printenv DB_NAME)"
C2T_DB_USER="$(docker exec "$C2T" printenv DB_USER)"
C2T_DB_PASSWORD="$(docker exec "$C2T" printenv DB_PASSWORD)"

load_3d
if [ -d "$FIXTURE_DIR/weather" ]; then load_weather; fi
if [ "${#dumps[@]}" = 1 ]; then
  load_pylovo "${dumps[0]}"
  relink_all
fi

mkdir -p "$WORKDIR"
cat > "$WORKDIR/fixture.env" <<EOF
FIXTURE_VERSION=$(basename "$FIXTURE_DIR")
FIXTURE_DIR=$FIXTURE_DIR
LOADED_AT=$(date -Iseconds)
EOF
ok "fixture $(basename "$FIXTURE_DIR") loaded into prefix '$PREFIX'"
