.DEFAULT_GOAL := help

# Load repository configurations
include repos.conf
export $(shell sed 's/=.*//' repos.conf)

# Colors for output
GREEN  := \033[0;32m
YELLOW := \033[1;33m
CYAN   := \033[0;36m
NC     := \033[0m

# Docker Compose files
PLATFORM_COMPOSE   := -f platform-core/docker-compose.yml -f platform-core/docker-compose.dev.yml
ENERPLANET_COMPOSE := -f enerplanet/docker-compose.yml -f enerplanet/docker-compose.dev.yml

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
	@echo "  make sonar              Run SonarQube analysis"

# ==============================================================================
# SECTION 1: CORE COMMANDS
# ==============================================================================

.PHONY: setup
setup: git-credential-cache setup-repos env-setup install pull-images up-db db-create up-keycloak init-keycloak up-services migrate seed webservice pylovo
	@echo "$(GREEN)Setup complete! Access your application at http://localhost:3000$(NC)"

.PHONY: update
update: git-credential-cache setup-repos install migrate webservice pylovo
	git pull
	@echo "$(GREEN)Update complete!$(NC)"

# ==============================================================================
# SECTION 2: ADMIN & DEVELOPER TOOLS
# ==============================================================================

.PHONY: up
up:
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d
	@docker compose $(ENERPLANET_COMPOSE) up -d --build
	@echo "$(GREEN)All services started.$(NC)"

.PHONY: down
down:
	@docker compose $(ENERPLANET_COMPOSE) down
	@docker compose $(PLATFORM_COMPOSE) down
	@echo "$(GREEN)All services stopped.$(NC)"

.PHONY: logs
logs:
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
init-keycloak:
	@docker compose $(PLATFORM_COMPOSE) up keycloak-init


.PHONY: up-keycloak
up-keycloak:
	@echo "$(CYAN)Starting Keycloak...$(NC)"
	@docker compose $(PLATFORM_COMPOSE) up -d keycloak
	@echo "Waiting for Keycloak to be healthy..."
	@sleep 15
	@echo "$(GREEN)Keycloak started.$(NC)"
	@echo ""

.PHONY: reset-db
reset-db:
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
	@git config --global credential.helper 'cache --timeout=120'

.PHONY: setup-repos
setup-repos:
	@echo "$(CYAN)Updating repositories...$(NC)"
	git submodules update --init
	@[ -d dependencies/simulation-engine ] && (cd dependencies/simulation-engine && git pull) || git clone $(SIMENGINE_REPO) dependencies/simulation-engine
	@[ -d dependencies/pylovo2enerplanet ] && (cd dependencies/pylovo2enerplanet && git pull) || git clone $(PYLOVO_REPO) dependencies/pylovo2enerplanet

.PHONY: env-setup
env-setup:
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
pull-images:
	@docker pull postgres:15-alpine
	@docker pull redis:7-alpine
	@docker compose $(PLATFORM_COMPOSE) pull --ignore-buildable postgres redis keycloak

.PHONY: up-db
up-db:
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d postgres redis
	@sleep 5

.PHONY: start-postgres
start-postgres:
	@docker network create spatialhub-net 2>/dev/null || true
	@docker compose $(PLATFORM_COMPOSE) up -d postgres
	@sleep 5

.PHONY: db-create
db-create:
	@docker exec postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'spatialai'" | grep -q 1 || \
		docker exec postgres psql -U postgres -c "CREATE DATABASE spatialai"

.PHONY: up-services
up-services:
	@docker compose $(PLATFORM_COMPOSE) up -d --build auth-service webservice

.PHONY: webservice
webservice:
	@cd dependencies/simulation-engine && make build && make up-min

.PHONY: pylovo
pylovo:
	@cd dependencies/pylovo2enerplanet && make dev
