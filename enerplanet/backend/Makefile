# Backend-specific Makefile
# For orchestration, use the root Makefile instead

.PHONY: vendor
vendor: ## Go mod tidy and vendor
	go mod tidy && go mod vendor

.PHONY: run
run: ## Run backend server locally
	go run cmd/main.go

.PHONY: migrate
migrate: ## Run database migrations locally
	go run cmd/migrate/migration.go

.PHONY: build
build: ## Build backend binary
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o build/app cmd/main.go

.PHONY: test
test: ## Run tests
	go test ./... -v

.PHONY: lint
lint: ## Run linter (requires golangci-lint)
	golangci-lint run || echo "golangci-lint not installed"

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf build/ vendor/