#!/usr/bin/env bash
# Loads the committed test fixtures into the services that read them, so a
# fresh clone runs the heat workflow smoke without downloading any source
# archive or running an import pipeline.
#
# Usage:
#   fixtures/load.sh          # load what is missing, leave what is present
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
  done < <(cd "$src" && find . -type f -printf '%P\n')
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
# <DB_NAME>_<country>, and connects with the settings in its own checkout's
# environment/docker.env. Reading them from there rather than hardcoding keeps
# this correct when that file changes; override any of them in the environment
# to point at a different instance.
load_city2tabula() {
  local src="$HERE/city2tabula/city2tabula_loenen.sql.gz"
  [ -f "$src" ] || return 0
  local envfile="$ROOT/dependencies/$CITY2TABULA_DIR/environment/docker.env"
  if [ ! -f "$envfile" ]; then
    fail "city2tabula: $envfile not found, run 'make setup-repos' first"
    return 0
  fi
  command -v psql >/dev/null || { fail "city2tabula: psql is required to restore the fixture"; return 0; }

  local c2t_db c2t_host c2t_port c2t_user
  c2t_db="$(sed -n 's/^DB_NAME=//p' "$envfile" | tr -d '"' | awk '{print $1}')"
  c2t_host="$(sed -n 's/^DB_HOST=//p' "$envfile" | tr -d '"' | awk '{print $1}')"
  c2t_port="$(sed -n 's/^DB_PORT=//p' "$envfile" | tr -d '"' | awk '{print $1}')"
  c2t_user="$(sed -n 's/^DB_USER=//p' "$envfile" | tr -d '"' | awk '{print $1}')"
  # host.docker.internal is how the container reaches the host; from a host
  # shell the same instance is localhost.
  [ "$c2t_host" = "host.docker.internal" ] && c2t_host=localhost
  c2t_host="${C2T_DB_HOST:-$c2t_host}"
  c2t_port="${C2T_DB_PORT:-$c2t_port}"
  c2t_user="${C2T_DB_USER:-$c2t_user}"
  export PGPASSWORD="${C2T_DB_PASSWORD:-$(sed -n 's/^DB_PASSWORD=//p' "$envfile" | tr -d '"' | awk '{print $1}')}"

  # The fixture is Dutch, and the server appends the country to DB_NAME.
  local target="${C2T_DB_NAME:-${c2t_db}}_nl"
  local psql_base=(psql -h "$c2t_host" -p "$c2t_port" -U "$c2t_user" -v ON_ERROR_STOP=1)

  if ! "${psql_base[@]}" -d postgres -tAc "select 1" >/dev/null 2>&1; then
    fail "city2tabula: cannot reach postgres at $c2t_host:$c2t_port as $c2t_user"
    return 0
  fi
  if "${psql_base[@]}" -d postgres -tAc "select 1 from pg_database where datname='$target'" 2>/dev/null | grep -q 1; then
    if [ "$FORCE" != "1" ]; then
      skip "city2tabula: database $target already exists on $c2t_host:$c2t_port, FORCE=1 is refused here (drop it yourself first)"
      return 0
    fi
    fail "city2tabula: $target exists; FORCE does not drop databases, drop it yourself and re-run"
    return 0
  fi
  if ! "${psql_base[@]}" -d postgres -c "create database \"$target\"" >/dev/null 2>&1; then
    fail "city2tabula: could not create database $target"
    return 0
  fi
  if zcat "$src" | "${psql_base[@]}" -d "$target" >/dev/null; then
    ok "city2tabula: restored into $target on $c2t_host:$c2t_port"
  else
    fail "city2tabula: restore into $target failed, the database was left in place for inspection"
  fi
}

# The pylovo fixture carries its own schema, so it restores into a database
# that need only exist. Connection settings come from the checkout's
# .env.docker, falling back to .env.example.
load_pylovo() {
  local src="$HERE/pylovo/pylovo_loenen_fixture.sql.gz"
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
  command -v psql >/dev/null || { fail "pylovo: psql is required to restore the fixture"; return 0; }

  local db host port user
  db="$(sed -n 's/^DBNAME=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  host="$(sed -n 's/^HOST=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  port="$(sed -n 's/^PORT=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  user="$(sed -n 's/^DBUSER=//p' "$envfile" | tr -d \" | awk '{print $1}')"
  # HOST is a compose service name; from a host shell the same server is local.
  case "$host" in postgres|host.docker.internal|pylovo-db) host=localhost ;; esac
  db="${PYLOVO_DB_NAME:-$db}"
  host="${PYLOVO_DB_HOST:-$host}"
  port="${PYLOVO_DB_PORT:-$port}"
  user="${PYLOVO_DB_USER:-$user}"
  export PGPASSWORD="${PYLOVO_DB_PASSWORD:-$(sed -n 's/^PASSWORD=//p' "$envfile" | tr -d \" | awk '{print $1}')}"

  local psql_base=(psql -h "$host" -p "$port" -U "$user" -v ON_ERROR_STOP=1)
  if ! "${psql_base[@]}" -d postgres -tAc "select 1" >/dev/null 2>&1; then
    fail "pylovo: cannot reach postgres at $host:$port as $user"
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
  if zcat "$src" | "${psql_base[@]}" -d "$db" >/dev/null; then
    ok "pylovo: restored into $db on $host:$port"
  else
    fail "pylovo: restore into $db failed"
  fi
}

echo "== loading fixtures from $HERE =="
load_weather
load_city2tabula
load_pylovo
echo "== $LOADED loaded, $SKIPPED skipped, $FAILED failed =="
[ "$FAILED" -eq 0 ]
