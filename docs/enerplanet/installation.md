# Installation

## System Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 20.04 / Windows 10 (WSL2) / macOS 12 | Ubuntu 22.04 LTS |
| RAM | 8 GB | 16 GB |
| Storage | 20 GB | 50 GB |
| CPU | 4 cores | 8 cores |

## Prerequisites

=== "Ubuntu / Debian"

    ```bash
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y git curl wget make

    # Docker
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER && newgrp docker

    # Node.js 22
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs

    # Go 1.24
    wget https://go.dev/dl/go1.24.0.linux-amd64.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc && source ~/.bashrc
    ```

=== "Windows (WSL2)"

    1. Open PowerShell as Administrator and run `wsl --install`
    2. Restart, then open an Ubuntu terminal
    3. Follow the Ubuntu instructions above
    4. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the WSL2 backend enabled

## Clone and Setup

```bash
git clone https://github.com/THD-Spatial/enerplanet.git
cd enerplanet
make setup
```

The `make setup` command runs these steps automatically:

1. Clone platform-core, libs, and infrastructure sub-repositories
2. Create `.env` files from `.env.example` templates
3. Install npm and Go dependencies
4. Pull Docker images (PostgreSQL, Redis, Keycloak)
5. Start PostgreSQL and Redis
6. Create the `spatialai` database
7. Start Keycloak and configure the `spatialhub` realm
8. Start auth-service and webservice
9. Run database migrations and seed initial data

!!! note
    When prompted for credentials, enter your repository access credentials. They are cached for 2 minutes.

## Start the Application

After setup completes, start the backend and frontend in separate terminals:

```bash
# Terminal 1 — Backend
cd enerplanet/backend
go run cmd/main.go
# Listening on http://127.0.0.1:8000

# Terminal 2 — Frontend
cd enerplanet/frontend
npm run dev
# Listening on http://localhost:3000
```

### Default Credentials

!!! warning "Development only"
    These credentials are seeded by `make setup` for local development. **Change both before any non-local deployment.**

```
Email:    admin@example.com
Password: 12345678
```

## Service URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Keycloak Admin | http://localhost:8080 |

## PyLovo Setup

PyLovo runs as a separate Docker service. See the [PyLovo Quickstart](../pylovo/quickstart.md) for setup instructions.

## Makefile Reference

```bash
make setup              # Full first-time setup
make up                 # Start all platform services
make down               # Stop all platform services
make up-enerplanet      # Start backend + frontend containers
make down-enerplanet    # Stop backend + frontend containers
make migrate            # Run database migrations
make seed               # Seed initial data
make install            # Reinstall npm + Go dependencies
make logs               # View platform logs
```

## Environment Configuration

**`enerplanet/backend/.env`**

```bash
APP_NAME=Enerplanet
APP_ENV=development
APP_PORT=8000
DB_HOST=localhost
DB_PORT=5433
DB_DATABASE=spatialai
DB_USERNAME=postgres
DB_PASSWORD=postgres
REDIS_HOST=localhost
REDIS_PORT=6379
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=spatialhub
KEYCLOAK_CLIENT_ID=spatialhub
KEYCLOAK_CLIENT_SECRET=
AUTH_SERVICE_URL=http://localhost:8001
WEBSERVICE_SERVICE_URL=http://localhost:8082
PYLOVO_SERVICE_URL=http://localhost:8086
```

**`enerplanet/frontend/.env`**

```bash
VITE_API_URL=http://localhost:8000/api
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=spatialhub
VITE_KEYCLOAK_CLIENT_ID=spatialhub
```

## Troubleshooting

**Docker permission denied**
```bash
sudo usermod -aG docker $USER && newgrp docker
```

**Port already in use**
```bash
lsof -i :8000          # Find the process
kill -9 <PID>          # Stop it
```

**Database connection failed**
```bash
docker ps | grep postgres
docker logs postgres --tail 50
make stop-postgres && make start-postgres
```

**npm install errors**
```bash
npm cache clean --force
rm -rf node_modules && npm install
```
