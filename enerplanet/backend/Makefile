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

.PHONY: docs
docs: ## Regenerate the OpenAPI spec from handler annotations (docs/swagger.{json,yaml}, docs/docs.go)
	swag init -g cmd/main.go --parseDependency --parseInternal -o docs || echo "swag not installed: go install github.com/swaggo/swag/cmd/swag@v1.16.6"

.PHONY: docs-check
docs-check: docs ## Fail if the committed OpenAPI spec is out of date
	git diff --exit-code docs/ || (echo "docs/ is stale - run 'make docs' and commit" && exit 1)

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf build/ vendor/