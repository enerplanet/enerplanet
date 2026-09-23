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
	@echo "  make up                 Start all services (Core + App)"
	@echo "  make down               Stop all services"
	@echo "  make logs               Follow service logs"
	@echo "  make migrate            Run database migrations"
	@echo "  make seed               Seed the database"
	@echo "  make init-keycloak      Re-initialize Keycloak"
	@echo "  make reset-db           Wipe and reset PostgreSQL database"
	@echo "  make pull-repos         Update all sub-repositories"
	@echo "  make fixtures           Load the committed test fixtures into the services"
	@echo "  make tentacron               Start the tentacron stack (tentacron, ignis, buem, meme)"
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
	@git lfs pull --include=fixtures 2>/dev/null || true
	@./fixtures/load.sh

.PHONY: setup
setup: git-credential-cache setup-repos env-setup install pull-images up-db db-create up-keycloak init-keycloak up-services migrate seed pylovo tentacron-stack fixtures
	@echo "$(GREEN)Setup complete! Access your application at http://localhost:3000$(NC)"


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
update: git-credential-cache setup-repos install migrate webservice pylovo
	git pull
	@echo "$(GREEN)Update complete!$(NC)"

# ==============================================================================
# SECTION 2: ADMIN & DEVELOPER TOOLS
# ==============================================================================

.PHONY: up
up: .env
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d
	@docker compose $(ENERPLANET_COMPOSE) up -d --build
	@echo "$(GREEN)All services started.$(NC)"

.PHONY: down
down: .env
	@docker compose $(ENERPLANET_COMPOSE) down
	@docker compose $(PLATFORM_COMPOSE) down
	@echo "$(GREEN)All services stopped.$(NC)"

.PHONY: logs
logs: .env
	@docker compose $(PLATFORM_COMPOSE) logs -f

.PHONY: migrate
migrate:
	@echo "$(CYAN)Running migrations...$(NC)"
	@cd enerplanet/backend && go run cmd/migrate/migration.go

.PHONY: seed
seed:
	@echo "$(CYAN)Seeding database...$(NC)"
	@cd enerplanet/backend && go run cmd/seed/*.go

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

.PHONY: setup-repos
setup-repos:
	@echo "$(CYAN)Updating repositories...$(NC)"
	git submodule update --init
	@[ -d dependencies/simulation-engine ] && (cd dependencies/simulation-engine && git pull && git lfs pull) || git clone $(SIMENGINE_REPO) dependencies/simulation-engine && cd dependencies/simulation-engine && git lfs pull
	@[ -d dependencies/enerplanet-pylovo ] && (cd dependencies/enerplanet-pylovo && git pull && git lfs pull) || git clone $(PYLOVO_REPO) dependencies/enerplanet-pylovo && cd dependencies/enerplanet-pylovo && git lfs pull
	@[ -d dependencies/$(OPENTECHDB_DIR) ] && (cd dependencies/$(OPENTECHDB_DIR) && git pull && git lfs pull) || git clone $(OPENTECHDB_REPO) dependencies/$(OPENTECHDB_DIR) && cd dependencies/$(OPENTECHDB_DIR) && git lfs pull
	@[ -d dependencies/$(IGNIS_DIR) ] && (cd dependencies/$(IGNIS_DIR) && git pull) || git clone $(IGNIS_REPO) dependencies/$(IGNIS_DIR)
	@[ -d dependencies/$(BUEM_DIR) ] && (cd dependencies/$(BUEM_DIR) && git pull) || git clone $(BUEM_REPO) dependencies/$(BUEM_DIR)
	@[ -d dependencies/$(MEME_DIR) ] && (cd dependencies/$(MEME_DIR) && git pull) || git clone $(MEME_REPO) dependencies/$(MEME_DIR)
	@[ -d dependencies/$(TENTACRON_DIR) ] && (cd dependencies/$(TENTACRON_DIR) && git pull) || git clone $(TENTACRON_REPO) dependencies/$(TENTACRON_DIR)
	@[ -d dependencies/$(CITY2TABULA_DIR) ] && (cd dependencies/$(CITY2TABULA_DIR) && git pull) || git clone $(CITY2TABULA_REPO) dependencies/$(CITY2TABULA_DIR)
	@[ -d dependencies/$(WEATHER_DIR) ] && (cd dependencies/$(WEATHER_DIR) && git pull) || git clone $(WEATHER_REPO) dependencies/$(WEATHER_DIR)

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
webservice:
	@cd dependencies/simulation-engine && make build && make up-min

.PHONY: pylovo
pylovo:
	@cd dependencies/enerplanet-pylovo && test -f .env.docker || cp .env.example .env.docker && make dev


.PHONY: tentacron-stack
tentacron-stack: tentacron-network ignis city2tabula weather buem meme tentacron
	@echo "$(GREEN)TentaCron stack up. city2tabula/weather/ignis/buem/meme/tentacron are reachable on network 'tentacron-net'$(NC)"

.PHONY: tentacron-network
tentacron-network:
	@docker network create tentacron-net 2>/dev/null || true

.PHONY: tentacron
tentacron: tentacron-network
	@cd dependencies/$(TENTACRON_DIR)/environment && make build ENV=dev
	@cd dependencies/$(TENTACRON_DIR)/environment && HOST_PORT=$(TENTACRON_PORT) docker compose --env-file .env.dev -f docker-compose.yml up -d tentacron
	@docker network connect tentacron-net tentacron-env-tentacron-1 2>/dev/null || true
	@echo "$(GREEN)TentaCron up on http://localhost:$(TENTACRON_PORT), attached to 'tentacron-net'$(NC)"

.PHONY: ignis
ignis: tentacron-network
	@cd dependencies/$(IGNIS_DIR)/environment/http && HOST_PORT=$(IGNIS_PORT) docker compose -f docker-compose.prod.yml up -d
	@cd dependencies/$(IGNIS_DIR)/environment/http && [ -f .ignis-seeded ] || { HOST_PORT=$(IGNIS_PORT) docker compose -f docker-compose.prod.yml --profile seed run --rm ignis-build-db >/dev/null 2>&1 || true; touch .ignis-seeded; }
	@docker network connect tentacron-net ignis-app 2>/dev/null || true
	@echo "$(GREEN)Ignis up on http://localhost:$(IGNIS_PORT), on 'tentacron-net'$(NC)"

.PHONY: buem
buem: tentacron-network
	@cd dependencies/$(BUEM_DIR)/environment/http && HOST_PORT=$(BUEM_PORT) docker compose -f docker-compose.yml up -d
	@docker network connect tentacron-net buem-gateway 2>/dev/null || true
	@docker network connect tentacron-net buem-model 2>/dev/null || true
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
	@cd dependencies/$(WEATHER_DIR) && set -a && . ../TentaCron/environment/.env.dev && set +a && unset COMPOSE_PROJECT_NAME PORT HOST_PORT CONFIG IMAGE_TAG RELEASE_IMAGE && WEATHER_API_KEYS="$$WEATHER_API_KEY" WEATHER_API_PORT=$(WEATHER_PORT) docker compose -f infrastructure/container/docker-compose.serve.yml up -d --pull always
	@docker network connect tentacron-net weather-serve 2>/dev/null || true
	@echo "$(GREEN)weather-serve up on http://localhost:$(WEATHER_PORT), on 'tentacron-net'$(NC)"

.PHONY: city2tabula
city2tabula: tentacron-network ignis
	@cd dependencies/$(CITY2TABULA_DIR)/environment/http && C2T_SERVER_HOST_PORT=$(CITY2TABULA_PORT) docker compose --env-file docker.env -f docker-compose.yml up -d --pull always city2tabula-server
	@docker network connect tentacron-net city2tabula-server 2>/dev/null || true
	@echo "$(GREEN)city2tabula up on http://localhost:$(CITY2TABULA_PORT), on 'tentacron-net'$(NC)"

.PHONY: opentech-db
opentech-db: .opentech-db-setup
	@cd dependencies/$(OPENTECHDB_DIR) && .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8004

.PHONY: .opentech-db-setup
.opentech-db-setup:
	@cd dependencies/$(OPENTECHDB_DIR) && \
		[ -f .env ] || cp .env.example .env; \
		[ -d .venv ] || (python3 -m venv .venv && .venv/bin/pip install --quiet --upgrade pip && .venv/bin/pip install --quiet -r requirements.txt)
