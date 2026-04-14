# REST API

PyLovo's FastAPI service is available at `http://localhost:8086` by default.

## Authentication

All API endpoints require a valid Keycloak Bearer token (passed from the EnerPlanET backend).

## Grid Generation

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check and version info |
| `/generate-grid` | POST | Generate a grid for a custom polygon |
| `/grid-statistics` | POST | Get statistics for a generated grid |
| `/power-flow` | POST | Run power flow analysis |

### Generate Grid

```bash
POST /generate-grid
Content-Type: application/json

{
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[13.40, 52.52], [13.41, 52.52], [13.41, 52.53], [13.40, 52.53], [13.40, 52.52]]]
  },
  "country": "germany",
  "model_id": "uuid",
  "transformer_size_kva": 400
}
```

## Transformer Management

| Endpoint | Method | Description |
|---|---|---|
| `/add-transformer` | POST | Add a user-placed transformer |
| `/move-transformer` | POST | Move a transformer to a new location |
| `/delete-transformer` | POST | Remove a transformer (regenerates cables) |
| `/assign-building` | POST | Assign one building to a transformer |
| `/assign-buildings-batch` | POST | Assign multiple buildings in one operation |

Transformers are isolated per model using `draft_id` (before saving) or `model_id` (after saving).

## Reference Data

| Endpoint | Method | Description |
|---|---|---|
| `/transformer-sizes` | GET | Available transformer ratings (kVA) |
| `/consumer-categories` | GET | Consumer category definitions |
| `/cable-types` | GET | Cable type catalogue |
| `/equipment-costs` | GET | Equipment cost data |
| `/voltage-settings` | GET | Voltage band limits |

## Energy Estimation

| Endpoint | Method | Description |
|---|---|---|
| `/estimate-energy` | POST | Estimate demand for a single building |
| `/estimate-energy-batch` | POST | Batch energy estimation |
| `/hosting-capacity` | POST | Calculate EV hosting capacity |
| `/add-custom-building` | POST | Add a custom building |
| `/custom-buildings/{user_id}` | GET | Get user's custom buildings |

## Data Pipeline

| Endpoint | Method | Description |
|---|---|---|
| `/pipeline/run` | POST | Start a data pipeline job |
| `/pipeline/status/{job_id}` | GET | Get pipeline job status |
| `/pipeline/regions` | GET | List available regions |
| `/pipeline/history` | GET | Pipeline execution history |
| `/pipeline/states/{country}` | GET | State statistics for a country |
| `/pipeline/states/{country}/{state}` | DELETE | Remove state data |

## Example: Full Grid Workflow

```bash
BASE=http://localhost:8086

# 1. Health check
curl $BASE/health

# 2. Generate a grid for a polygon
curl -X POST $BASE/generate-grid \
  -H "Content-Type: application/json" \
  -d @grid_request.json

# 3. Run power flow
curl -X POST $BASE/power-flow \
  -H "Content-Type: application/json" \
  -d '{"model_id": "<uuid>"}'

# 4. Get grid statistics
curl -X POST $BASE/grid-statistics \
  -H "Content-Type: application/json" \
  -d '{"model_id": "<uuid>"}'
```
