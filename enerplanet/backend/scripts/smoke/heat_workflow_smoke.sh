#!/usr/bin/env bash
# Live smoke test for the heat / 3D-data workflow, run against a deployed
# stack without the frontend: backend -> TentaCron -> ignis, City2TABULA,
# weather-serve, buem-gateway. Re-run after any release to confirm the
# services still work together end to end.
#
# Usage:
#   scripts/smoke/heat_workflow_smoke.sh
#
# Environment (all optional):
#   BACKEND_URL         default http://localhost:8000
#   TENTACRON_URL       default http://localhost:8092
#   TENTACRON_API_KEY   read from ./.env when unset; TentaCron target listing
#                       is skipped without it
#   SMOKE_EMAIL / SMOKE_PASSWORD   dev login, default admin@example.de / 12345678
#   POLL_TIMEOUT_S      per-poll-loop timeout, default 900
#   KEEP_MODEL=1        leave the smoke model in place instead of deleting it
#
# Requires bash, curl and jq. Creating the model resolves its country
# through nominatim.openstreetmap.org on a cache miss, so the backend needs
# outbound internet the first time a given area is used.
#
# Exit code is 0 only when every step passes.

set -u -o pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
TENTACRON_URL="${TENTACRON_URL:-http://localhost:8092}"
SMOKE_EMAIL="${SMOKE_EMAIL:-admin@example.de}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-12345678}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-900}"
KEEP_MODEL="${KEEP_MODEL:-0}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$HERE/loenen_buildings.geojson"
if [ -z "${TENTACRON_API_KEY:-}" ] && [ -f "$HERE/../../.env" ]; then
  TENTACRON_API_KEY="$(sed -n 's/^TENTACRON_API_KEY=//p' "$HERE/../../.env" | tr -d '"' )"
fi

# Loenen (NL) area: the fixture buildings all lie inside this polygon and
# have PyLovo-linked 3D data in City2TABULA (match_type 1).
LOENEN_POLYGON='{"type":"Polygon","coordinates":[[[6.0180,52.0978],[6.0356,52.0978],[6.0356,52.1079],[6.0180,52.1079],[6.0180,52.0978]]]}'
LOENEN_BBOX='{"xmin":6.0180,"ymin":52.0978,"xmax":6.0356,"ymax":52.1079}'

COOKIES="$(mktemp)"
MODEL_ID=""
FAILED=0
trap cleanup EXIT

pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=$((FAILED + 1)); }
warn() { printf 'WARN  %s\n' "$*"; }

# request METHOD PATH [JSON_BODY] -> prints the body, sets HTTP_CODE.
# Sends the session cookie jar and, on writes, the CSRF token cookie's value
# in the header the auth service expects (double-submit pattern).
request() {
  local method="$1" path="$2" body="${3:-}"
  local csrf
  csrf="$(awk '$6=="csrf_token"{print $7}' "$COOKIES" 2>/dev/null | tail -n1)"
  local args=(-s -b "$COOKIES" -c "$COOKIES" -X "$method" -H "Accept: application/json" -w '\n%{http_code}')
  [ -n "$csrf" ] && args+=(-H "X-CSRF-Token: $csrf")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  local out
  out="$(curl "${args[@]}" "$BACKEND_URL$path")"
  HTTP_CODE="${out##*$'\n'}"
  printf '%s' "${out%$'\n'*}"
}

# poll_until DESCRIPTION JQ_DONE_FILTER METHOD PATH -> prints the last body.
# Repeats the request until the jq filter is true or POLL_TIMEOUT_S passes.
poll_until() {
  local what="$1" done_filter="$2" method="$3" path="$4"
  local deadline=$((SECONDS + POLL_TIMEOUT_S)) body
  while :; do
    body="$(request "$method" "$path")"
    if [ "$HTTP_CODE" = "200" ] && printf '%s' "$body" | jq -e "$done_filter" >/dev/null 2>&1; then
      printf '%s' "$body"; return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf '%s' "$body"; return 1
    fi
    sleep 5
  done
}

cleanup() {
  if [ -n "$MODEL_ID" ] && [ "$KEEP_MODEL" != "1" ]; then
    request DELETE "/api/models/$MODEL_ID" >/dev/null
    [ "$HTTP_CODE" = "200" ] && echo "info  deleted smoke model $MODEL_ID" || warn "could not delete smoke model $MODEL_ID (HTTP $HTTP_CODE)"
  fi
  rm -f "$COOKIES"
}

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "FAIL  $tool is required"; exit 1; }
done
[ -f "$FIXTURE" ] || { echo "FAIL  fixture not found: $FIXTURE"; exit 1; }

echo "== heat workflow smoke: $BACKEND_URL =="

# ---- 1. auth -------------------------------------------------------------
request GET /api/csrf-token >/dev/null
body="$(request POST /api/login "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$body" | jq -e '.success == true' >/dev/null && grep -q session_id "$COOKIES"; then
  pass "1. login as $SMOKE_EMAIL (session cookie set)"
else
  fail "1. login as $SMOKE_EMAIL: HTTP $HTTP_CODE ${body:0:200}"
  echo "aborting: nothing else can run without a session"
  exit 1
fi

# ---- 2. TentaCron --------------------------------------------------------
body="$(curl -s -w '\n%{http_code}' "$TENTACRON_URL/readyz")"; code="${body##*$'\n'}"
if [ "$code" = "200" ]; then pass "2a. TentaCron $TENTACRON_URL/readyz"; else fail "2a. TentaCron readyz: HTTP $code"; fi
if [ -n "${TENTACRON_API_KEY:-}" ]; then
  body="$(curl -s -w '\n%{http_code}' -H "X-API-Key: $TENTACRON_API_KEY" "$TENTACRON_URL/v1/targets")"; code="${body##*$'\n'}"
  n="$(printf '%s' "${body%$'\n'*}" | jq -r '.items | length' 2>/dev/null || echo 0)"
  if [ "$code" = "200" ] && [ "${n:-0}" -gt 0 ]; then pass "2b. TentaCron targets configured: $n"; else fail "2b. TentaCron targets: HTTP $code, count ${n:-?}"; fi
else
  warn "2b. TENTACRON_API_KEY not set, skipping target listing"
fi

# ---- 3. ignis proxies ----------------------------------------------------
body="$(request GET /api/v2/ignis/fields)"
n="$(printf '%s' "$body" | jq -r '.data.data | length' 2>/dev/null || echo 0)"
if [ "$HTTP_CODE" = "200" ] && [ "${n:-0}" -gt 0 ]; then pass "3a. GET /v2/ignis/fields ($n fields)"; else fail "3a. GET /v2/ignis/fields: HTTP $HTTP_CODE ${body:0:200}"; fi
body="$(request GET /api/v2/ignis/variants/DE)"
n="$(printf '%s' "$body" | jq -r '.data.data | length' 2>/dev/null || echo 0)"
if [ "$HTTP_CODE" = "200" ] && [ "${n:-0}" -gt 0 ]; then pass "3b. GET /v2/ignis/variants/DE ($n variants)"; else fail "3b. GET /v2/ignis/variants/DE: HTTP $HTTP_CODE ${body:0:200}"; fi

# ---- 4. heat-demand resolve (ignis path) ---------------------------------
body="$(request POST /api/v1/heat-demand/resolve \
  '{"osm_id":"smoke-bremen-1","f_class":"detached","country":"germany","construction_year":1975,"floor_area_m2":120}')"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$body" | jq -e '.source == "ignis" and .tabula_variant_code != null and .heating_demand_kwh_a > 0' >/dev/null; then
  pass "4. POST /v1/heat-demand/resolve -> source ignis, $(printf '%s' "$body" | jq -r '.tabula_variant_code'), $(printf '%s' "$body" | jq -r '.heating_demand_kwh_a') kWh/a"
else
  fail "4. POST /v1/heat-demand/resolve: HTTP $HTTP_CODE ${body:0:300}"
fi

# ---- 5. City2TABULA enrich -----------------------------------------------
osm_ids_json="$(jq -c '[.features[].properties.osm_id]' "$FIXTURE")"
osm_ids_csv="$(jq -r '[.features[].properties.osm_id] | join(",")' "$FIXTURE")"
body="$(request POST /api/v1/city2tabula/enrich "{\"country\":\"netherlands\",\"bbox\":$LOENEN_BBOX,\"osm_ids\":$osm_ids_json}")"
case "$HTTP_CODE" in
  200) ;;
  202)
    run_id="$(printf '%s' "$body" | jq -r '.run_id')"
    echo "info  enrich triggered City2TABULA run $run_id, polling"
    body="$(poll_until "enrich run" '.status == "completed"' GET "/api/v1/city2tabula/enrich/$run_id?country=netherlands&osm_ids=$osm_ids_csv")" \
      || fail "5. enrich run $run_id did not complete within ${POLL_TIMEOUT_S}s: ${body:0:200}"
    ;;
  *) fail "5. POST /v1/city2tabula/enrich: HTTP $HTTP_CODE ${body:0:300}" ;;
esac
resolved="$(printf '%s' "$body" | jq -r '.resolved // 0')"
with_code="$(printf '%s' "$body" | jq -r '[.data[] | select(.tabula_variant_code != null)] | length')"
with_year="$(printf '%s' "$body" | jq -r '[.data[] | select(.default_construction_year != null)] | length')"
if [ "${resolved:-0}" -gt 0 ] && [ "$with_code" = "$resolved" ] && [ "$with_year" = "$resolved" ]; then
  pass "5. enrich: $resolved/$(jq '.features|length' "$FIXTURE") buildings resolved, all with tabula_variant_code + default_construction_year"
else
  fail "5. enrich: resolved=$resolved with_variant_code=$with_code with_default_year=$with_year (status $(printf '%s' "$body" | jq -r '.status'))"
fi

# ---- 6. model create -> auto-resolve -> heat profiles --------------------
# One fixture building is sent as a bakery (with an occupant count) to cover
# BuEM's service occupancy path; the Loenen fixture has no real service
# building, so its f_class is overridden here rather than in the fixture.
BAKERY_OSM_ID="$(jq -r '.features[-1].properties.osm_id' "$FIXTURE")"
config="$(jq -c --argjson b "$(jq '.features[-1].properties.f_class = "bakery" | .features[-1].properties.f_classes = "bakery" | .features[-1].properties.capacity = 4' "$FIXTURE")" -n '{buildings: $b, energyVectors: ["electricity"]}')"
payload="$(jq -c -n --argjson coords "$LOENEN_POLYGON" --argjson cfg "$config" \
  '{title: ("heat workflow smoke " + (now|todate)), from_date: "2018-01-01", to_date: "2018-12-31", resolution: 60, coordinates: $coords, config: $cfg}')"
body="$(request POST /api/models "$payload")"
MODEL_ID="$(printf '%s' "$body" | jq -r '.data.id // empty')"
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; } && [ -n "$MODEL_ID" ]; then
  pass "6a. POST /api/models -> model $MODEL_ID (country $(printf '%s' "$body" | jq -r '.data.country'))"
else
  fail "6a. POST /api/models: HTTP $HTTP_CODE ${body:0:300}"
fi
if [ -n "$MODEL_ID" ]; then
  echo "info  waiting for auto-resolve of model $MODEL_ID"
  body="$(poll_until "heat profiles" '.status == "completed"' GET "/api/models/$MODEL_ID/heat-profiles")" \
    || fail "6b. heat profiles for model $MODEL_ID did not complete within ${POLL_TIMEOUT_S}s (status $(printf '%s' "$body" | jq -r '.status'), resolved $(printf '%s' "$body" | jq -r '.resolved')/$(printf '%s' "$body" | jq -r '.total'))"
  total="$(printf '%s' "$body" | jq -r '.total')"; resolved="$(printf '%s' "$body" | jq -r '.resolved')"; failed_n="$(printf '%s' "$body" | jq -r '.failed')"
  core_ok="$(printf '%s' "$body" | jq -r '[.buildings[] | select(.status=="resolved") | select(.heating_kwh_a != null and .cooling_kwh_a != null and .electricity_kwh_a != null)] | length')"
  if [ "${resolved:-0}" -gt 0 ] && [ "$core_ok" = "$resolved" ]; then
    pass "6b. GET /models/$MODEL_ID/heat-profiles -> $resolved/$total resolved with heating/cooling/electricity ($failed_n failed)"
    printf '%s' "$body" | jq -r '.buildings[] | select(.status=="resolved") | "      \(.osm_id)  \(.building_type // "-")  \(.tabula_variant_code // "-")  heat \(.heating_kwh_a) cool \(.cooling_kwh_a) elec \(.electricity_kwh_a) hw \(.hot_water_kwh_a // "-") kitchen \(.kitchen_kwh_a // "-") kWh/a"' | head -n 6
    printf '%s' "$body" | jq -r '.buildings[] | select(.status=="failed") | "      \(.osm_id)  failed: \(.error_message // "-")"' | head -n 6
  else
    fail "6b. heat profiles: resolved=$resolved of $total, with core vectors=$core_ok, failed=$failed_n"
    printf '%s' "$body" | jq -r '.buildings[] | "      \(.osm_id)  \(.status)  \(.error_message // "")"' | head -n 10
  fi
  # service building: modelled with BuEM's service occupancy profile, so
  # heating/electricity are real and hot water is not modelled (0)
  if printf '%s' "$body" | jq -e --arg id "$BAKERY_OSM_ID" '.buildings[] | select(.osm_id==$id) | .status=="resolved" and .building_type=="bakery" and .heating_kwh_a > 0 and .electricity_kwh_a > 0 and .hot_water_kwh_a == 0' >/dev/null; then
    pass "6d. bakery $BAKERY_OSM_ID: building_type bakery, heating and electricity > 0, hot water 0"
  else
    fail "6d. bakery $BAKERY_OSM_ID: $(printf '%s' "$body" | jq -c --arg id "$BAKERY_OSM_ID" '.buildings[] | select(.osm_id==$id) | {status, building_type, heating_kwh_a, electricity_kwh_a, hot_water_kwh_a, error_message}')"
  fi
  # hot water / kitchen arrive with buem-gateway >= 6.1.0; report rather than fail
  hw_ok="$(printf '%s' "$body" | jq -r '[.buildings[] | select(.status=="resolved") | select(.hot_water_kwh_a != null and .kitchen_kwh_a != null)] | length')"
  if [ "${resolved:-0}" -gt 0 ] && [ "$hw_ok" = "$resolved" ]; then
    pass "6c. hot_water/kitchen populated on all $resolved resolved buildings"
  else
    warn "6c. hot_water/kitchen populated on $hw_ok/$resolved resolved buildings (needs buem-gateway >= 6.1.0)"
  fi
fi

# ---- 7. summary ----------------------------------------------------------
echo "== done: $FAILED failure(s) =="
[ "$FAILED" -eq 0 ]
