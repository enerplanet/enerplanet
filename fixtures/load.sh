#!/usr/bin/env bash
# Loads the committed test fixtures into the services that read them, so a
# fresh clone runs the heat workflow smoke without downloading any source
# archive or running an import pipeline.
#
# Usage:
#   fixtures/load.sh          # load what is missing, leave what is present
#   fixtures/load.sh pylovo   # only the named sets: weather, city2tabula, pylovo
#   FORCE=1 fixtures/load.sh  # overwrite targets that already exist
#
# Never overwrites by default: a developer who has built the real archives
# locally would otherwise lose hundreds of megabytes to a small test cut.
#
# Services read from dependencies/<repo>, which `make setup-repos` creates.

set -u -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
FORCE="${FORCE:-0}"
LOADED=0
SKIPPED=0
FAILED=0

# repos.conf names each dependency's checkout directory.
# shellcheck source=repos.conf
. "$ROOT/repos.conf"

ok()   { printf 'OK    %s\n' "$*"; LOADED=$((LOADED + 1)); }
skip() { printf 'SKIP  %s\n' "$*"; SKIPPED=$((SKIPPED + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=$((FAILED + 1)); }

# copy_tree SOURCE_DIR DEST_DIR LABEL — copies every file under SOURCE_DIR to
# the same relative path under DEST_DIR. The fixture tree mirrors the layout
# the service expects, so there is no per-file mapping to keep in step.
copy_tree() {
  local src="$1" dest="$2" label="$3" rel from to
  while IFS= read -r rel; do
    from="$src/$rel"
    to="$dest/$rel"
    if [ -e "$to" ] && [ "$FORCE" != "1" ]; then
      skip "$label: $rel already present ($(LC_ALL=C du -h "$to" | cut -f1)), FORCE=1 to replace it"
      continue
    fi
    mkdir -p "$(dirname "$to")"
    if cp "$from" "$to"; then ok "$label: $rel"; else fail "$label: could not copy $rel"; fi
  done < <(cd "$src" && find . -type f | sed 's|^\./||')
}

# weather-serve resolves a point query against netCDF archives under its
# checkout's data/ (WEATHER_DATA_DIR=/data in the container), preferring the
# country-scoped <provider>/<country>/output layout. The Loenen cut is named
# COSMO_REA6_2018_annual_all_attrs.nc because point_query looks that exact
# name up before falling back to per-month files.
load_weather() {
  local src="$HERE/weather" dest="$ROOT/dependencies/$WEATHER_DIR/data"
  [ -d "$src" ] || return 0
  if [ ! -d "$ROOT/dependencies/$WEATHER_DIR" ]; then
    fail "weather: dependencies/$WEATHER_DIR not found, run 'make setup-repos' first"
    return 0
  fi
  copy_tree "$src" "$dest" weather
}

# The City2TABULA server derives its database name per request as
# <DB_NAME>_<country>. Its database is the city2tabula-db container, which
# publishes no host port, so psql runs inside it rather than from the host.
#
# environment/http/docker.env is deliberately NOT the source here: that file
# configures the interactive pipeline service, which points at a host Postgres
# (host.docker.internal) under a different name. Following it restores the
# fixture into a database the server never reads.
#
# One full City2TABULA database per country (the CityDB import, the tabula
# lookup and the city2tabula tables), because the server refuses an on-request
# run on a database that holds only the city2tabula schema.
C2T_DB_CONTAINER="${C2T_DB_CONTAINER:-city2tabula-db}"

c2t_settings() {
  command -v docker >/dev/null || { fail "city2tabula: docker is required to reach $C2T_DB_CONTAINER"; return 1; }
  if ! docker exec "$C2T_DB_CONTAINER" true >/dev/null 2>&1; then
    fail "city2tabula: container $C2T_DB_CONTAINER is not running, start it with 'make city2tabula' first"
    return 1
  fi
  # Defaults match the compose file's own (DB_NAME: ${C2T_DB_NAME:-city2tabula}),
  # so the loader and the server derive the same database from the same inputs.
  C2T_TARGET_NAME="${C2T_DB_NAME:-city2tabula}"
  C2T_TARGET_USER="${C2T_DB_USER:-postgres}"
  export PGPASSWORD="${C2T_DB_PASSWORD:-postgres}"
  return 0
}

c2t_psql() { docker exec -i -e PGPASSWORD="$PGPASSWORD" "$C2T_DB_CONTAINER" psql -U "$C2T_TARGET_USER" -v ON_ERROR_STOP=1 "$@"; }

# restore_c2t COUNTRY FIXTURE
restore_c2t() {
  local country="$1" src="$HERE/city2tabula/$2"
  [ -f "$src" ] || return 0
  local target="${C2T_TARGET_NAME}_${country}"

  if c2t_psql -d postgres -tAc "select 1 from pg_database where datname='$target'" 2>/dev/null | grep -q 1; then
    skip "city2tabula/$country: database $target already exists in $C2T_DB_CONTAINER, drop it yourself to reload"
    return 0
  fi
  if ! c2t_psql -d postgres -c "create database \"$target\"" >/dev/null 2>&1; then
    fail "city2tabula/$country: could not create database $target in $C2T_DB_CONTAINER"
    return 0
  fi
  # The dump creates its own extensions with IF NOT EXISTS; postgis first is
  # the order the fixtures are built and tested in.
  c2t_psql -d "$target" -c "create extension if not exists postgis" >/dev/null 2>&1
  if ! gzip -dc "$src" | c2t_psql -d "$target" >/dev/null 2>&1; then
    fail "city2tabula/$country: restore into $target failed, the database was left in place for inspection"
    return 0
  fi
  ok "city2tabula/$country: restored into $target in $C2T_DB_CONTAINER"
}

# The raw 3D source of each box goes to data/lod2 in the City2TABULA checkout,
# which its compose file mounts into the server at /app/data/lod2. An
# on-request run imports the unprocessed part of a box from there.
load_c2t_sources() {
  local src="$HERE/city2tabula/lod2" checkout="$ROOT/dependencies/$CITY2TABULA_DIR"
  [ -d "$src" ] || return 0
  if [ ! -d "$checkout" ]; then
    fail "city2tabula: dependencies/$CITY2TABULA_DIR not found, run 'make setup-repos' first"
    return 0
  fi
  copy_tree "$src" "$checkout/data/lod2" "city2tabula sources"
}

load_city2tabula() {
  load_c2t_sources
  c2t_settings || return 0
  restore_c2t nl city2tabula_loenen.sql.gz
  restore_c2t de city2tabula_bremen.sql.gz
  restore_c2t at city2tabula_vienna.sql.gz
  restore_c2t cz city2tabula_brno.sql.gz
}

# The pylovo fixture carries its own schema, so it restores into a database
# that need only exist. The database name, user and password come from the
# checkout's .env.docker, falling back to .env.example. pylovo_db lives in the
# platform Postgres container, so psql runs inside it rather than on the host.
PYLOVO_DB_CONTAINER="${PYLOVO_DB_CONTAINER:-postgres}"

load_pylovo() {
  local src="$HERE/pylovo/pylovo_fixture.sql.gz"
  [ -f "$src" ] || return 0
  # repos.conf carries no PYLOVO_DIR: the Makefile clones this one to a fixed
  # path rather than a configured one.
  local dir="$ROOT/dependencies/${PYLOVO_DIR:-enerplanet-pylovo}"
  local envfile="$dir/.env.docker"
  [ -f "$envfile" ] || envfile="$dir/.env.example"
  if [ ! -f "$envfile" ]; then
    fail "pylovo: no .env.docker or .env.example under $dir, run 'make setup-repos' first"
    return 0
  fi
  command -v docker >/dev/null || { fail "pylovo: docker is required to reach $PYLOVO_DB_CONTAINER"; return 0; }
  if ! docker exec "$PYLOVO_DB_CONTAINER" true >/dev/null 2>&1; then
    fail "pylovo: container $PYLOVO_DB_CONTAINER is not running, start it with 'make up-db' first"
    return 0
  fi

  local db user pass
  db="$(sed -n 's/^DBNAME=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  user="$(sed -n 's/^DBUSER=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  pass="$(sed -n 's/^PASSWORD=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  db="${PYLOVO_DB_NAME:-$db}"
  user="${PYLOVO_DB_USER:-$user}"
  pass="${PYLOVO_DB_PASSWORD:-$pass}"

  local psql_base=(docker exec -i -e PGPASSWORD="$pass" "$PYLOVO_DB_CONTAINER" psql -U "$user" -v ON_ERROR_STOP=1)
  if ! "${psql_base[@]}" -d postgres -tAc "select 1" >/dev/null 2>&1; then
    fail "pylovo: cannot connect to postgres in $PYLOVO_DB_CONTAINER as $user"
    return 0
  fi
  # pylovo's own tooling may have created the database already; an empty one
  # is still a target, so the decision is on content rather than existence.
  if ! "${psql_base[@]}" -d postgres -tAc "select 1 from pg_database where datname='$db'" 2>/dev/null | grep -q 1; then
    "${psql_base[@]}" -d postgres -c "create database \"$db\"" >/dev/null 2>&1 \
      || { fail "pylovo: could not create database $db"; return 0; }
  fi
  local existing
  existing="$("${psql_base[@]}" -d "$db" -tAc "select count(*) from grid_result" 2>/dev/null || echo 0)"
  if [ "${existing:-0}" -gt 0 ]; then
    skip "pylovo: $db already holds $existing grid_result rows, leaving it alone"
    return 0
  fi
  if gzip -dc "$src" | "${psql_base[@]}" -d "$db" >/dev/null; then
    ok "pylovo: restored into $db in $PYLOVO_DB_CONTAINER"
  else
    fail "pylovo: restore into $db failed"
  fi
}

echo "== loading fixtures from $HERE =="
for set in ${@:-weather city2tabula pylovo}; do
  case "$set" in
    weather|city2tabula|pylovo) "load_$set" ;;
    *) fail "unknown fixture set: $set" ;;
  esac
done
echo "== $LOADED loaded, $SKIPPED skipped, $FAILED failed =="
[ "$FAILED" -eq 0 ]
