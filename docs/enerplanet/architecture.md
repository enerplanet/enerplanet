# System Architecture

## Data Flow

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant F as Frontend :3000
    participant N as Nginx
    participant B as Backend :8000
    participant K as Keycloak :8080
    participant P as PyLovo :8086
    participant S as Simulation Engine :8089
    participant DB as PostgreSQL

    U->>F: Open application
    F->>N: Login redirect
    N->>K: OIDC authorization code flow
    K-->>N: Access token + session cookie
    N-->>F: Authenticated

    U->>F: Draw region polygon
    F->>N: POST /api/pylovo/generate
    N->>B: Forward request
    B->>P: Generate grid for polygon
    P->>DB: Query OSM buildings + roads (pylovo_db)
    P-->>B: GeoJSON grid topology
    B-->>F: Grid layers

    U->>F: Configure simulation model
    F->>B: POST /api/models
    B->>DB: Save model
    B->>S: Dispatch simulation job (via Redis/Asynq)
    S-->>B: POST /api/callback (results ZIP)
    B->>DB: Store results
    B-->>F: SSE notification → results ready
```

## Backend Structure

The Go backend (`enerplanet/backend/`) follows a layered architecture:

```
backend/
├── cmd/main.go              # Entry point
├── internal/
│   ├── handlers/            # HTTP handlers (Gin)
│   ├── services/            # Business logic
│   ├── repositories/        # Database access (GORM)
│   ├── models/              # Domain models
│   ├── middleware/          # Auth, rate-limiting, CORS
│   └── workers/             # Asynq background workers
├── migrations/              # SQL migration files
└── config/                  # Configuration loading
```

Key patterns:
- **Asynq workers** handle long-running tasks (simulation callbacks, notification dispatch) asynchronously via Redis
- **SSE** (Server-Sent Events) pushes real-time status updates to the frontend without polling
- **GORM** with PostgreSQL handles all relational data; PostGIS functions are used directly via raw queries for spatial operations

## Frontend Structure

The React frontend (`enerplanet/frontend/`) is a Vite SPA:

```
frontend/
├── src/
│   ├── components/
│   │   ├── map/             # OpenLayers + MapLibre GL JS map views
│   │   ├── configurator/    # Region selection, building dialog
│   │   ├── simulation/      # Model builder, results viewer
│   │   └── ui/              # Shared UI components
│   ├── services/            # API client functions
│   ├── stores/              # Zustand state slices
│   ├── hooks/               # TanStack Query hooks
│   └── i18n/                # Translation files (8 languages)
└── public/
```

## Database Schema (Key Tables)

```mermaid
erDiagram
    users {
        uuid id PK
        string email
        string keycloak_id
        string access_level
        int model_limit
    }
    workspaces {
        uuid id PK
        string keycloak_group_id
        uuid owner_id FK
    }
    models {
        uuid id PK
        uuid workspace_id FK
        string status
        jsonb configuration
        timestamp created_at
    }
    simulation_results {
        uuid id PK
        uuid model_id FK
        jsonb summary
        string results_path
    }
    users ||--o{ workspaces : owns
    workspaces ||--o{ models : contains
    models ||--o| simulation_results : produces
```

The `pylovo_db` database (separate from `spatialai`) holds all grid-related tables: `buildings_result`, `postcode`, `grid_result`, `country`, `state`, `transformer`, etc.

## Simulation Pipeline

```mermaid
graph LR
    A[User triggers model run] --> B[Backend enqueues job\nvia Asynq / Redis]
    B --> C[Platform Core\nwebservice dispatcher]
    C --> D[HAProxy :8089\nleast-connections]
    D --> E1[sim-worker-1\nCalliope / PyPSA]
    D --> E2[sim-worker-N\nCalliope / PyPSA]
    E1 --> F[Tech microservices\nPV / Wind / Biomass / Geothermal]
    E2 --> F
    E1 --> G[POST /callback\nResults ZIP]
    E2 --> G
    G --> B2[Backend Asynq worker\nProcess results]
    B2 --> H[PostgreSQL\nStore results]
    H --> I[SSE → Frontend\nNotification]
```

Workers are stateless and horizontally scalable. Concurrency per worker is configurable (`MAX_CONCURRENT`).
