#!/usr/bin/env bash
# Local development: Docker services, then the backend and frontend on the host
# in one tmux window, then a health check of every service.
#
#   scripts/dev.sh up       start everything and attach (default)
#   scripts/dev.sh health   check every service once more
#   scripts/dev.sh stop     stop the backend and frontend; containers keep running
#
# WAIT_S (default 180) bounds how long `up` and `health` wait for services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION=enerplanet
WAIT_S="${WAIT_S:-180}"

# Heat-stack ports come from repos.conf, as the Makefile's targets use them.
# Platform ports are fixed in the platform-core and pylovo compose files.
# shellcheck source=../repos.conf
source "$ROOT/repos.conf"

# name|kind|target, where kind is http (URL answers 2xx/3xx) or tcp (host:port accepts).
# Order is start order: the heat services before TentaCron, which routes to them,
# and TentaCron before the backend, which reaches them only through it.
CORE_SERVICES=(
  "postgres|tcp|localhost:5433"
  "redis|tcp|localhost:6379"
  "keycloak|http|http://localhost:8080/keycloak/realms/spatialhub/.well-known/openid-configuration"
)
DOCKER_SERVICES=(
  "${CORE_SERVICES[@]}"
  "auth-service|http|http://localhost:${AUTH_SERVICE_PORT}/api/health"
  "pylovo|http|http://localhost:${PYLOVO_PORT}/health"
  "ignis|http|http://localhost:${IGNIS_PORT}/ignis/health"
  "city2tabula|http|http://localhost:${CITY2TABULA_PORT}/api/v1/health"
  "weather-serve|http|http://localhost:${WEATHER_PORT}/v1/weather/health"
  "buem-gateway|http|http://localhost:${BUEM_PORT}/buem/health"
  "meme|http|http://localhost:${MEME_PORT}/healthz"
  "tentacron|http|http://localhost:${TENTACRON_PORT}/readyz"
)
SERVICES=(
  "${DOCKER_SERVICES[@]}"
  "backend|http|http://localhost:8000/api/health"
  "frontend|http|http://localhost:3000/"
)

die() { echo "error: $*" >&2; exit 1; }

# probe KIND TARGET succeeds when the service answers.
probe() {
  case "$1" in
    http) curl -fs -o /dev/null --max-time 3 "$2" ;;
    tcp)  timeout 3 bash -c "</dev/tcp/${2%:*}/${2##*:}" 2>/dev/null ;;
    *)    die "unknown probe kind '$1'" ;;
  esac
}

# wait_for SERVICE... polls until every service answers or WAIT_S runs out,
# prints one line per service, and returns non-zero if any never answered.
wait_for() {
  local deadline=$((SECONDS + WAIT_S)) pending=("$@") still entry name kind target
  while ((${#pending[@]})) && ((SECONDS < deadline)); do
    still=()
    for entry in "${pending[@]}"; do
      IFS='|' read -r name kind target <<<"$entry"
      if probe "$kind" "$target"; then
        printf '  \033[0;32mOK\033[0m    %-14s %s\n' "$name" "$target"
      else
        still+=("$entry")
      fi
    done
    pending=("${still[@]+"${still[@]}"}")
    ((${#pending[@]})) && sleep 3
  done
  for entry in "${pending[@]+"${pending[@]}"}"; do
    IFS='|' read -r name kind target <<<"$entry"
    printf '  \033[0;31mFAIL\033[0m  %-14s %s (no answer after %ss)\n' "$name" "$target" "$WAIT_S"
  done
  ((${#pending[@]} == 0))
}

cmd_health() {
  echo "Checking services (up to ${WAIT_S}s)..."
  if wait_for "${SERVICES[@]}"; then
    echo "All services healthy. Frontend: http://localhost:3000 (admin@example.de / 12345678)"
  else
    echo "Some services are not answering. See the backend and frontend panes, or 'docker ps -a'."
    return 1
  fi
}

attach() {
  [[ -t 1 ]] || { echo "Not a terminal; attach with: tmux attach -t $SESSION"; return; }
  if [[ -n "${TMUX:-}" ]]; then tmux switch-client -t "$SESSION"; else tmux attach -t "$SESSION"; fi
}

cmd_up() {
  command -v tmux >/dev/null || die "tmux is not installed"
  docker info >/dev/null 2>&1 || die "Docker is not reachable; start Docker first"
  local f
  for f in .env platform-core/auth-service/.env platform-core/webservice/.env enerplanet/backend/.env enerplanet/frontend/.env; do
    [[ -f "$ROOT/$f" ]] || die "$f is missing; run 'make env-setup' (or 'make setup' on a first run)"
  done
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' is already running; attaching. Stop it with: scripts/dev.sh stop"
    attach
    return
  fi

  # The backend container binds :8000 on the host network, as the host backend does.
  if [[ -n "$(docker ps -q --filter name='^energy-backend$')" ]]; then
    echo "Stopping the energy-backend container so the host backend can use :8000..."
    docker stop energy-backend >/dev/null
  fi

  make -C "$ROOT" up-deps

  echo "Waiting for the Docker services before starting the backend..."
  if ! wait_for "${DOCKER_SERVICES[@]}"; then
    wait_for "${CORE_SERVICES[@]}" >/dev/null || die "postgres, redis or keycloak is down; the backend cannot start"
    echo "Starting the backend anyway; the services marked FAIL will fail its requests."
  fi

  # Pane 0 backend, pane 1 frontend, pane 2 health check, then a shell.
  # The backend ingests simulation results through the Coati CLI and finds it
  # only through COATI_BIN or PATH (the backend container sets COATI_BIN itself).
  local coati="${COATI_BIN:-$ROOT/submodules/Coati/.venv/bin/coati}"
  [[ -x "$coati" ]] || echo "warning: no Coati CLI at $coati; run 'make coati', or simulation results will not ingest"

  tmux new-session -d -s "$SESSION" -n dev -c "$ROOT/enerplanet/backend"
  tmux send-keys -t "$SESSION:dev.0" "COATI_BIN='$coati' go run cmd/main.go" C-m
  tmux split-window -h -t "$SESSION:dev.0" -c "$ROOT/enerplanet/frontend"
  tmux send-keys -t "$SESSION:dev.1" "npm run dev" C-m
  tmux split-window -v -t "$SESSION:dev.1" -c "$ROOT"
  tmux send-keys -t "$SESSION:dev.2" "scripts/dev.sh health" C-m
  tmux set-option -t "$SESSION" pane-border-status top >/dev/null
  tmux select-pane -t "$SESSION:dev.0" -T backend
  tmux select-pane -t "$SESSION:dev.1" -T frontend
  tmux select-pane -t "$SESSION:dev.2" -T health
  attach
}

cmd_stop() {
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "Backend and frontend stopped." || echo "Nothing to stop."
  echo "Containers keep running; stop them with: make down"
}

case "${1:-up}" in
  up)     cmd_up ;;
  health) cmd_health ;;
  stop)   cmd_stop ;;
  *)      die "usage: $0 [up|health|stop]" ;;
esac
