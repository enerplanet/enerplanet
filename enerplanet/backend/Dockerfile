# Multi-stage build for Go backend
FROM golang:1.24-alpine AS gobuilder

WORKDIR /app
ENV GOTOOLCHAIN=auto

# Install build deps
RUN apk add --no-cache build-base ca-certificates git

# Copy shared modules first (required by go.mod replace directives)
COPY common /common
COPY platform /platform

# Cache modules
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source
COPY backend/. .

# Build binaries (server + migration tool)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/bin/server ./cmd/main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/bin/migrate ./cmd/migrate/migration.go

# Build frontend (React + Vite)
FROM node:20-alpine AS febuilder
WORKDIR /src
COPY frontend/package*.json ./

RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps
COPY frontend .
RUN npm run build

# Runtime image - Ubuntu instead of distroless
FROM ubuntu:22.04

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binaries (server + migrate)
COPY --from=gobuilder /app/bin/server /app/server
COPY --from=gobuilder /app/bin/migrate /app/migrate

# Copy frontend dist
COPY --from=febuilder /src/dist /app/www

# Copy migrations
COPY --from=gobuilder /app/migrations /app/migrations

# Copy .env fallback (overridden at runtime by docker-compose env_file)
COPY backend/.env.example /app/.env

# Copy entrypoint script
COPY backend/entrypoint.sh /app/entrypoint.sh

# Create non-root user and set up storage
RUN useradd -r -s /bin/sh appuser && \
    mkdir -p /app/storage/data && \
    chmod +x /app/server /app/migrate /app/entrypoint.sh && \
    chown -R appuser:appuser /app

# Expose port
EXPOSE 8000

# Environment
ENV APP_HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/app/server", "--health-check"]

# Entrypoint runs as root to fix permissions, then drops to appuser
ENTRYPOINT ["/app/entrypoint.sh"]
