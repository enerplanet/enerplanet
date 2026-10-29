#!/usr/bin/env bash
# Creates the example models under fixtures/models/ for the dev admin, so a
# fresh setup opens with one model per fixture region instead of an empty list.
#
# Usage:
#   fixtures/example_models.sh    # create what is missing, leave what is present
#
# Development only: refuses unless enerplanet/backend/.env sets
# APP_ENV=development explicitly. The backend's own default for an unset
# APP_ENV is also development, so an unset value is not taken as consent.
#
# Models go through POST /api/models rather than into the database, so the
# backend resolves the country, places them in the default workspace and queues
# the same jobs a model saved from the frontend gets. The backend must be
# running; this waits for it. Each file is the body the frontend POSTs, captured
# from a model saved in the frontend against the committed fixtures.
#
# Environment (all optional):
#   BACKEND_URL                   default http://localhost:8000
#   SEED_EMAIL / SEED_PASSWORD    default admin@example.de / 12345678 (cmd/seed)
#   WAIT_S                        how long to wait for the backend, default 180

set -u -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
SEED_EMAIL="${SEED_EMAIL:-admin@example.de}"
SEED_PASSWORD="${SEED_PASSWORD:-12345678}"
WAIT_S="${WAIT_S:-180}"
CREATED=0
SKIPPED=0
FAILED=0

ok()   { printf 'OK    %s\n' "$*"; CREATED=$((CREATED + 1)); }
skip() { printf 'SKIP  %s\n' "$*"; SKIPPED=$((SKIPPED + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=$((FAILED + 1)); }

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "FAIL  $tool is required"; exit 1; }
done

app_env="$(sed -n 's/^APP_ENV=//p' "$ROOT/enerplanet/backend/.env" 2>/dev/null | tr -d '"' | awk '{print $1}')"
if [ "$app_env" != "development" ]; then
  echo "SKIP  example models: APP_ENV is '${app_env:-unset}' in enerplanet/backend/.env, not 'development'"
  exit 0
fi

COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

# api METHOD PATH [JSON_BODY] -> prints the body, sets HTTP_CODE. Writes carry
# the CSRF cookie's value in the header the auth service expects.
api() {
  local method="$1" path="$2" body="${3:-}" csrf out
  csrf="$(awk '$6=="csrf_token"{print $7}' "$COOKIES" | tail -n1)"
  local args=(-s -b "$COOKIES" -c "$COOKIES" -X "$method" -w '\n%{http_code}')
  [ -n "$csrf" ] && args+=(-H "X-CSRF-Token: $csrf")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-binary "$body")
  out="$(curl "${args[@]}" "$BACKEND_URL$path")"
  HTTP_CODE="${out##*$'\n'}"
  printf '%s' "${out%$'\n'*}"
}

deadline=$((SECONDS + WAIT_S))
until curl -s -o /dev/null -c "$COOKIES" "$BACKEND_URL/api/csrf-token"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "FAIL  example models: backend not reachable at $BACKEND_URL after ${WAIT_S}s; start it, then run 'make example-models'"
    exit 1
  fi
  sleep 3
done

api POST /api/login "$(jq -cn --arg e "$SEED_EMAIL" --arg p "$SEED_PASSWORD" '{email: $e, password: $p}')" >/dev/null
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL  example models: login as $SEED_EMAIL answered HTTP $HTTP_CODE"
  exit 1
fi

workspace_id="$(api GET /api/workspaces/default | jq -r '.data.id // empty')"
if [ -z "$workspace_id" ]; then
  echo "FAIL  example models: no default workspace for $SEED_EMAIL (HTTP $HTTP_CODE)"
  exit 1
fi

echo "== creating example models from $HERE/models =="
for file in "$HERE"/models/*.json; do
  title="$(jq -r '.title' "$file")"
  existing="$(api GET "/api/models?search=$(jq -rn --arg t "$title" '$t|@uri')" \
    | jq --arg t "$title" '[.data[]? | select(.title == $t)] | length')"
  if [ "${existing:-0}" -gt 0 ]; then
    skip "$title already exists"
    continue
  fi
  body="$(jq -c --argjson ws "$workspace_id" '. + {workspace_id: $ws}' "$file")"
  response="$(api POST /api/models "$body")"
  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    ok "$title: model $(printf '%s' "$response" | jq -r '.data.id')"
  else
    fail "$title: HTTP $HTTP_CODE ${response:0:200}"
  fi
done
echo "== $CREATED created, $SKIPPED skipped, $FAILED failed =="
[ "$FAILED" -eq 0 ]
