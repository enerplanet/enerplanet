.DEFAULT_GOAL := help

# Load repository configurations
include repos.conf
export $(shell sed 's/=.*//' repos.conf)

# Colors for output
GREEN  := \033[0;32m
YELLOW := \033[1;33m
CYAN   := \033[0;36m
NC     := \033[0m

FRONT_DIR = enerplanet/frontend
BACK_DIR = enerplanet/backend
SESSION_NAME = enerplanet
# Docker Compose files.
ENV_FILE           := --env-file .env

PLATFORM_COMPOSE   := $(ENV_FILE) -f platform-core/docker-compose.yml -f platform-core/docker-compose.dev.yml
ENERPLANET_COMPOSE := $(ENV_FILE) -f enerplanet/docker-compose.yml -f enerplanet/docker-compose.dev.yml

# Runs a backend binary (/app/migrate, /app/seed) in the app image.
BACKEND_RUN := docker compose $(ENERPLANET_COMPOSE) run --rm --build --no-deps --entrypoint

# Runs a bash script from the repo with curl, jq and the docker CLI, so the host
# needs none of them. Host networking keeps the backend at localhost:8000, the
# domain its session cookie is scoped to. $(1) is the working directory.
SCRIPTS_IMAGE := enerplanet-scripts
# The scripts' optional settings, forwarded only when set in the caller's shell.
SCRIPT_ENV := $(foreach v,SMOKE_SITE KEEP_MODEL POLL_TIMEOUT_S SMOKE_EMAIL SMOKE_PASSWORD SEED_EMAIL SEED_PASSWORD WAIT_S BACKEND_URL TENTACRON_URL TENTACRON_API_KEY,-e $(v))
define run_script
	@printf 'FROM alpine:3.20\nRUN apk add --no-cache bash curl jq docker-cli\n' | docker build -q -t $(SCRIPTS_IMAGE) - >/dev/null
	@docker run --rm --network host $(SCRIPT_ENV) -v "$(CURDIR)":/repo -v /var/run/docker.sock:/var/run/docker.sock -w /repo/$(1) $(SCRIPTS_IMAGE) bash $(2)
endef

.env:
	@cp .env.example .env
	@echo "$(GREEN)Created .env from .env.example$(NC)"

.PHONY: help
help:
	@echo "$(CYAN)EnerPlanET Management$(NC)"
	@echo ""
	@echo "$(YELLOW)SECTION 1: CORE COMMANDS$(NC)"
	@echo "  make setup              Full system installation and configuration"
	@echo "  make update             Pull latest changes and update environment"
	@echo ""
	@echo "$(YELLOW)SECTION 2: ADMIN & DEVELOPER TOOLS$(NC)"
	@echo "  make up                 Start every service: platform, PyLovo, heat stack, app"
	@echo "  make down               Stop the platform services, PyLovo and the app"
	@echo "  make logs               Follow service logs"
	@echo "  make migrate            Run database migrations"
	@echo "  make seed               Seed the database"
	@echo "  make init-keycloak      Re-initialize Keycloak"
	@echo "  make reset-db           Wipe and reset PostgreSQL database"
	@echo "  make pull-repos         Update all sub-repositories"
	@echo "  make fixtures           Load the committed test fixtures into the services"
	@echo "  make fixtures-reload    Drop the fixture databases and load the fixtures afresh"
	@echo "  make example-models     Create the example models (development only, backend running)"
	@echo "  make smoke              Run the heat workflow smoke test against the running stack"
	@echo "  make tentacron-stack         Start the heat stack (tentacron, ignis, city2tabula, weather, buem)"
	@echo "  make city2tabula             Start City2TABULA on the shared network (repos.conf port)"
	@echo "  make weather                 Start weather-serve on the shared network (repos.conf port)"
	@echo "  make sonar              Run SonarQube analysis"

# ==============================================================================
# SECTION 1: CORE COMMANDS
# ==============================================================================

# Fixture files are Git LFS objects; without git lfs pull they are pointer
# text and the loader copies a few hundred bytes that no service can read.
.PHONY: fixtures
fixtures:
	@git lfs pull --include=fixtures
	@./fixtures/load.sh

# pylovo's `make dev` loads its full Bremen dump unless pylovo_db already
# exists, and the loader never overwrites a populated database, so the pylovo
# fixture has to go in before the pylovo target runs.
.PHONY: pylovo-fixture
pylovo-fixture:
	@git lfs pull --include=fixtures/pylovo
	@./fixtures/load.sh pylovo

# Drops every fixture database and loads the committed fixtures afresh; anything
# else built in those databases, such as a full-country PyLovo grid, is lost.
# PyLovo stays down until its fixture is in, for the reason given above.
.PHONY: fixtures-reload
fixtures-reload:
	@git lfs pull --include=fixtures
	@$(MAKE) -C dependencies/enerplanet-pylovo down
	@for c in nl de at cz; do docker exec city2tabula-db psql -U postgres -qc "drop database if exists city2tabula_$$c with (force)"; done
	@docker exec postgres psql -U postgres -qc 'drop database if exists pylovo_db with (force)'
	@FORCE=1 ./fixtures/load.sh
	@$(MAKE) pylovo
	@docker restart city2tabula >/dev/null

# Needs the backend running. The script itself refuses outside APP_ENV=development.
.PHONY: example-models
example-models:
	@git lfs pull --include=fixtures/models
	$(call run_script,,fixtures/example_models.sh)

.PHONY: smoke
smoke:
	$(call run_script,enerplanet/backend,scripts/smoke/heat_workflow_smoke.sh)

.PHONY: setup
setup: git-credential-cache setup-repos env-setup pull-images up-db db-create up-keycloak init-keycloak up-services migrate seed pylovo-fixture pylovo tentacron-stack fixtures up example-models
	@echo "$(GREEN)Setup complete! Open http://localhost:8000 and sign in as admin@example.de / 12345678$(NC)"


.PHONY: dev-bg list-bg clean-bg clean-docker

# 1. Start both in the background
dev-bg:
	@echo "Starting Enerplanet Services in the background..."
	@tmux has-session -t $(SESSION_NAME) 2>/dev/null && \
		(echo "Error: Session '$(SESSION_NAME)' is already running. Run 'make clean-bg' first.") || \
		(tmux new-session -d -s $(SESSION_NAME) -n frontend "cd $(FRONT_DIR) && npm run dev" && \
		 tmux new-window -t $(SESSION_NAME) -n backend "cd $(BACK_DIR) && go run cmd/main.go" && \
		 echo "Services started successfully!" && \
		 echo "-------------------------------------------------------" && \
		 echo "Access Frontend:  http://localhost:3000" && \
		 echo "User:             admin@example.de" && \
		 echo "Password:         12345678" && \
		 echo "-------------------------------------------------------" && \
		 echo "Run 'make list-bg' to see status or 'make clean-bg' to stop.")
	@$(MAKE) example-models

# 2. Show active background sessions
list-bg:
	@echo "Checking active Enerplanet sessions..."
	@tmux list-windows -t $(SESSION_NAME) 2>/dev/null || echo "No active sessions found."

# 3. Clear/Kill the background sessions
clean-bg:
	@echo "Stopping all Enerplanet background services..."
	@tmux kill-session -t $(SESSION_NAME) 2>/dev/null && echo "Sessions cleared." || echo "Nothing to stop."

# 4. Total Docker Wipe
clean-docker:
	@echo "Warning: This will delete ALL Docker data (images, volumes, cache)..."
	docker system prune -af --volumes
	@echo "Docker system cleaned."


.PHONY: update
update: git-credential-cache setup-repos migrate webservice pylovo
	git pull
	@echo "$(GREEN)Update complete!$(NC)"

# ==============================================================================
# SECTION 2: ADMIN & DEVELOPER TOOLS
# ==============================================================================

.PHONY: up
# PyLovo stops and starts with the platform Postgres: its pooled connections do
# not survive a Postgres restart, and each worker fails a request before
# reconnecting.
up: .env
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d
	@$(MAKE) pylovo
	@$(MAKE) tentacron-stack
	@docker compose $(ENERPLANET_COMPOSE) up -d --build energy-backend
	@echo "$(GREEN)All services started.$(NC)"

.PHONY: down
down: .env
	@docker compose $(ENERPLANET_COMPOSE) down
	@$(MAKE) -C dependencies/enerplanet-pylovo down
	@docker compose $(PLATFORM_COMPOSE) down
	@echo "$(GREEN)Platform, PyLovo and app stopped; the heat stack keeps running.$(NC)"

.PHONY: logs
logs: .env
	@docker compose $(PLATFORM_COMPOSE) logs -f

.PHONY: migrate
migrate: .env
	@echo "$(CYAN)Running migrations...$(NC)"
	@$(BACKEND_RUN) /app/migrate energy-backend

.PHONY: seed
seed: .env
	@echo "$(CYAN)Seeding database...$(NC)"
	@$(BACKEND_RUN) /app/seed energy-backend

.PHONY: init-keycloak
init-keycloak: .env
	@docker compose $(PLATFORM_COMPOSE) up keycloak-init


.PHONY: up-keycloak
up-keycloak: .env
	@echo "$(CYAN)Starting Keycloak...$(NC)"
	@docker compose $(PLATFORM_COMPOSE) up -d keycloak
	@echo "Waiting for Keycloak to be healthy..."
	@sleep 15
	@echo "$(GREEN)Keycloak started.$(NC)"
	@echo ""

.PHONY: reset-db
reset-db: .env
	@docker compose $(PLATFORM_COMPOSE) stop postgres
	@docker compose $(PLATFORM_COMPOSE) rm -f -v postgres
	@$(MAKE) start-postgres
	@$(MAKE) db-create
	@$(MAKE) migrate
	@$(MAKE) seed

.PHONY: pull-repos
pull-repos: setup-repos

.PHONY: sonar
sonar:
	@./bin/sonar-scanner/bin/sonar-scanner

# ==============================================================================
# INTERNAL HELPER TARGETS (Used by Section 1 & 2)
# ==============================================================================

.PHONY: git-credential-cache
git-credential-cache:
	@if [ -z "$$(git config credential.helper)" ]; then \
		echo "Setting local git credential cache (timeout=120s)..."; \
		git config credential.helper 'cache --timeout=120'; \
	fi

# pinned_checkout DIR REPO REF: clones REPO at release tag REF. An existing
# checkout on a pin (detached HEAD) moves to REF; one on a branch is left
# alone, since it may be a developer's own work.
define pinned_checkout
	@if [ ! -d dependencies/$(1) ]; then git clone -q --branch $(3) $(2) dependencies/$(1); \
	elif git -C dependencies/$(1) symbolic-ref -q HEAD >/dev/null; then echo "dependencies/$(1) is on a branch, left alone (pin: $(3))"; \
	else git -C dependencies/$(1) fetch -q --tags && git -C dependencies/$(1) checkout -q $(3); fi
endef

.PHONY: setup-repos
setup-repos:
	@echo "$(CYAN)Updating repositories...$(NC)"
	git submodule update --init
	@# Pinned to PYLOVO_REF (see repos.conf). An existing checkout is left alone:
	@# it may be a developer's own branch.
	@[ -d dependencies/enerplanet-pylovo ] || (git clone $(PYLOVO_REPO) dependencies/enerplanet-pylovo && cd dependencies/enerplanet-pylovo && git checkout -q $(PYLOVO_REF) && git lfs pull)
	@[ -d dependencies/$(OPENTECHDB_DIR) ] && (cd dependencies/$(OPENTECHDB_DIR) && git pull && git lfs pull) || git clone $(OPENTECHDB_REPO) dependencies/$(OPENTECHDB_DIR) && cd dependencies/$(OPENTECHDB_DIR) && git lfs pull
	$(call pinned_checkout,$(IGNIS_DIR),$(IGNIS_REPO),$(IGNIS_REF))
	$(call pinned_checkout,$(BUEM_DIR),$(BUEM_REPO),$(BUEM_REF))
	@[ -d dependencies/$(MEME_DIR) ] && (cd dependencies/$(MEME_DIR) && git pull) || git clone $(MEME_REPO) dependencies/$(MEME_DIR)
	@# Pinned to TENTACRON_REF (see repos.conf). An existing checkout is left alone:
	@# it may be a developer's own branch.
	@[ -d dependencies/$(TENTACRON_DIR) ] || (git clone $(TENTACRON_REPO) dependencies/$(TENTACRON_DIR) && git -C dependencies/$(TENTACRON_DIR) checkout -q $(TENTACRON_REF))
	$(call pinned_checkout,$(CITY2TABULA_DIR),$(CITY2TABULA_REPO),$(CITY2TABULA_REF))
	$(call pinned_checkout,$(WEATHER_DIR),$(WEATHER_REPO),$(WEATHER_REF))

.PHONY: env-setup
env-setup:
	@# Root .env: supplies REDIS_PASSWORD and the other variables the compose
	@# files interpolate. Must exist before any docker compose target runs.
	@[ -f .env ] || cp .env.example .env
	@[ -f platform-core/auth-service/.env ] || cp platform-core/auth-service/.env.example platform-core/auth-service/.env
	@[ -f platform-core/webservice/.env ] || cp platform-core/webservice/.env.example platform-core/webservice/.env
	@[ -f enerplanet/backend/.env ] || cp enerplanet/backend/.env.example enerplanet/backend/.env
	@[ -f enerplanet/frontend/.env ] || cp enerplanet/frontend/.env.example enerplanet/frontend/.env

.PHONY: install
install:
	@echo "$(CYAN)Installing dependencies...$(NC)"
	@cd libs/i18n && npm install && npm run build
	@cd libs/ui && npm install && npm run build
	@cd libs/forms && npm install && npm run build
	@cd libs/auth && npm install && npm run build
	@cd enerplanet/frontend && npm install
	@cd enerplanet/backend && go mod tidy
	@cd infrastructure/platform && go mod tidy
	@cd infrastructure/common && go mod tidy
	@cd platform-core/auth-service && go mod tidy
	@cd platform-core/webservice && go mod tidy

.PHONY: pull-images
pull-images: .env
	@docker pull postgres:15-alpine
	@docker pull redis:7-alpine
	@docker compose $(PLATFORM_COMPOSE) pull --ignore-buildable postgres redis keycloak

.PHONY: up-db
up-db: .env
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d postgres redis
	@sleep 5

.PHONY: start-postgres
start-postgres: .env
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d postgres
	@sleep 5

.PHONY: db-create
db-create:
	@docker exec postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'spatialai'" | grep -q 1 || \
		docker exec postgres psql -U postgres -c "CREATE DATABASE spatialai"

.PHONY: up-services
up-services: .env
	@docker compose $(PLATFORM_COMPOSE) up -d --build auth-service webservice

.PHONY: webservice
# Cloned here rather than in setup-repos: only the Calliope/PyPSA simulation
# needs it, and its 6 GB of LFS data would otherwise land on every checkout.
webservice:
	@[ -d dependencies/simulation-engine ] || (git clone $(SIMENGINE_REPO) dependencies/simulation-engine && cd dependencies/simulation-engine && git lfs pull)
	@cd dependencies/simulation-engine && make build && make up-min

# pylovo's `make dev` returns before the API answers, so this waits for it.
.PHONY: pylovo
pylovo:
	@cd dependencies/enerplanet-pylovo && test -s .env.docker || cp .env.example .env.docker && make dev
	@for i in $$(seq 60); do docker exec pylovo-api-dev python -c "import urllib.request; urllib.request.urlopen('http://localhost:8086/health')" >/dev/null 2>&1 && exit 0; sleep 2; done; \
		echo "pylovo-api-dev did not answer /health within 120s, see 'docker logs pylovo-api-dev'"; exit 1


.PHONY: tentacron-stack
# meme is left out until its translator and parser packages are released; it
# serves only the simulation step. `make meme` starts it on its own.
tentacron-stack: tentacron-network ignis city2tabula weather buem tentacron
	@echo "$(GREEN)TentaCron stack up. city2tabula/weather/ignis/buem/tentacron are reachable on network 'tentacron-net'$(NC)"

.PHONY: tentacron-network
# ignis and city2tabula declare tentacron-net in their compose files, and
# Compose refuses a same-named network whose com.docker.compose.network
# label differs from the key, so the label is set here to match.
tentacron-network:
	@docker network create --label com.docker.compose.network=tentacron-net tentacron-net 2>/dev/null || true

.PHONY: tentacron
tentacron: tentacron-network
	@cd dependencies/$(TENTACRON_DIR)/environment && make build ENV=dev
	@cd dependencies/$(TENTACRON_DIR)/environment && HOST_PORT=$(TENTACRON_PORT) docker compose --env-file .env.dev -f docker-compose.yml up -d tentacron
	@docker network connect tentacron-net tentacron-env-tentacron-1 2>/dev/null || true
	@echo "$(GREEN)TentaCron up on http://localhost:$(TENTACRON_PORT), attached to 'tentacron-net'$(NC)"

.PHONY: ignis
ignis: tentacron-network
	@cd dependencies/$(IGNIS_DIR)/environment/http && HOST_PORT=$(IGNIS_PORT) IGNIS_IMAGE_TAG=$(IGNIS_IMAGE_TAG) docker compose -f docker-compose.prod.yml up -d
	@echo "$(GREEN)Ignis up on http://localhost:$(IGNIS_PORT), on 'tentacron-net'$(NC)"

.PHONY: buem
buem: tentacron-network
	@cd dependencies/$(BUEM_DIR)/environment/http && HOST_PORT=$(BUEM_PORT) BUEM_GATEWAY_IMAGE_TAG=$(BUEM_GATEWAY_IMAGE_TAG) BUEM_MODEL_IMAGE_TAG=$(BUEM_MODEL_IMAGE_TAG) docker compose -f docker-compose.yml up -d
	@echo "$(GREEN)BuEM up on http://localhost:$(BUEM_PORT), on 'tentacron-net'$(NC)"

.PHONY: meme
meme: tentacron-network
	@cd dependencies/$(MEME_DIR)/environment && HOST_PORT=$(MEME_PORT) docker compose --env-file .env.dev -f docker-compose.yml up -d --build api
	@docker network connect tentacron-net meme-env-api-1 2>/dev/null || true
	@echo "$(GREEN)MEME up on http://localhost:$(MEME_PORT), on 'tentacron-net'$(NC)"

# weather and city2tabula pull rather than build: both publish an image, and
# building them locally costs the conda environment and the Go/JDK/citydb
# toolchain respectively for no gain. meme still builds, having no image.
.PHONY: weather
weather: tentacron-network
	@# Docker Engine creates a missing bind-mount source as root, and the
	@# fixture loader, run as the user, then cannot copy the weather cuts into it.
	@mkdir -p dependencies/$(WEATHER_DIR)/data
	@cd dependencies/$(WEATHER_DIR) && set -a && . $(CURDIR)/dependencies/$(TENTACRON_DIR)/environment/.env.dev && set +a && unset COMPOSE_PROJECT_NAME PORT HOST_PORT CONFIG IMAGE_TAG RELEASE_IMAGE && WEATHER_API_KEYS="$$WEATHER_API_KEY" HOST_PORT=$(WEATHER_PORT) WEATHER_IMAGE=ghcr.io/enerplanet/weather:$(WEATHER_IMAGE_TAG) docker compose -f infrastructure/container/docker-compose.serve.yml up -d --pull always
	@echo "$(GREEN)weather-serve up on http://localhost:$(WEATHER_PORT), on 'tentacron-net'$(NC)"

# On-request runs link new buildings to PyLovo over postgres_fdw, which
# connects from city2tabula-db, so that container joins spatialhub-net to reach
# the platform Postgres holding pylovo_db by name.
PYLOVO_FDW_HOST ?= postgres
PYLOVO_FDW_PORT ?= 5432
PYLOVO_FDW_DBNAME ?= pylovo_db
PYLOVO_FDW_USER ?= postgres
PYLOVO_FDW_PASSWORD ?= postgres

.PHONY: city2tabula
city2tabula: tentacron-network ignis
	@cd dependencies/$(CITY2TABULA_DIR)/environment/http && HOST_PORT=$(CITY2TABULA_PORT) C2T_IMAGE_TAG=$(CITY2TABULA_IMAGE_TAG) PYLOVO_FDW_HOST=$(PYLOVO_FDW_HOST) PYLOVO_FDW_PORT=$(PYLOVO_FDW_PORT) PYLOVO_FDW_DBNAME=$(PYLOVO_FDW_DBNAME) PYLOVO_FDW_USER=$(PYLOVO_FDW_USER) PYLOVO_FDW_PASSWORD=$(PYLOVO_FDW_PASSWORD) docker compose --env-file docker.env -f docker-compose.yml up -d --pull always city2tabula
	@docker inspect -f '{{json .NetworkSettings.Networks}}' city2tabula-db | grep -q '"spatialhub-net"' || docker network connect spatialhub-net city2tabula-db
	@echo "$(GREEN)city2tabula up on http://localhost:$(CITY2TABULA_PORT), on 'tentacron-net'$(NC)"

.PHONY: opentech-db
opentech-db: .opentech-db-setup
	@cd dependencies/$(OPENTECHDB_DIR) && .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8004

.PHONY: .opentech-db-setup
.opentech-db-setup:
	@cd dependencies/$(OPENTECHDB_DIR) && \
		[ -f .env ] || cp .env.example .env; \
		[ -d .venv ] || (python3 -m venv .venv && .venv/bin/pip install --quiet --upgrade pip && .venv/bin/pip install --quiet -r requirements.txt)
