# Simulation Webservice

The simulation webservice manages energy system calculations for EnerPlanET models. It dispatches jobs to Calliope and PyPSA workers and coordinates technology-specific microservices.

## Architecture

```mermaid
graph TD
    B[EnerPlanET Backend\nAsynq job queue] --> D[Platform Core\nWebservice Dispatcher]
    D --> H[HAProxy :8089\nleast-connections]
    H --> W1[sim-worker-1\nGo + Calliope + PyPSA]
    H --> W2[sim-worker-N\nGo + Calliope + PyPSA]
    W1 --> T[Tech Microservices]
    W2 --> T
    T --> PV[PV Service :8082\nPySAM + pvlib]
    T --> WI[Wind Service :8083\nPySAM Wind]
    T --> BI[Biomass Service :8084\nPySAM Biopower]
    T --> GE[Geothermal Service :8087]
    W1 --> |POST /callback| B
    W2 --> |POST /callback| B
```

Workers share a Docker volume (`sim_shared_data`) for model input/output files under `data/{model_id}/`.

## Simulation Engines

| Engine | Use Case |
|---|---|
| **Calliope 0.6.10** | Energy system optimisation (primary) |
| **PyPSA** | Power system analysis (optional) |

## API Endpoints

| Endpoint | Description |
|---|---|
| `POST /calliope/run` | Submit a Calliope optimisation job |
| `POST /pypsa/run` | Submit a PyPSA analysis job |
| `GET /calliope/status/{job_id}` | Get job status |
| `POST /csv2json/convert` | Convert CSV results to JSON |
| `POST /charging/simulate` | EV charging optimisation |
| `GET /health` | Service health check |

## Job Lifecycle

```mermaid
sequenceDiagram
    participant B as Backend
    participant D as Dispatcher
    participant W as sim-worker
    participant T as Tech Services

    B->>D: POST /webservice/submit (model config)
    D->>W: Assign job (least loaded worker)
    W->>T: Fetch PV/Wind/Biomass time-series (concurrent)
    T-->>W: Technology profiles
    W->>W: Run Calliope optimisation
    W->>B: POST /api/calculation/callback (results ZIP)
    B->>B: Asynq worker processes ZIP
    B-->>B: Store results in PostgreSQL
```

## Configuration

Workers are controlled by environment variables:

```bash
MAX_CONCURRENT=10           # Simultaneous jobs per worker
CALLIOPE_TIMEOUT=3600       # Job timeout in seconds
SHARED_DATA_PATH=/data      # Shared volume mount point
BACKEND_CALLBACK_URL=http://energy-backend:8000/api/v1/calculation/callback/
```

## Scaling

Add more simulation workers by increasing the replica count in `docker-compose.yml`:

```yaml
services:
  sim-worker:
    image: ${WEBSERVICE_IMAGE}
    deploy:
      replicas: 3
    environment:
      MAX_CONCURRENT: 10
```

HAProxy automatically distributes jobs using least-connections load balancing.
