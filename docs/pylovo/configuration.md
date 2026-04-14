# Configuration

PyLovo uses YAML configuration files in `config/`.

## config_generation.yaml

### Regional Settings

Specify the research area by postal codes, state, or municipality code:

```yaml
regional:
  # Option 1: list of postal codes
  plz_list:
    - "80331"
    - "80333"

  # Option 2: all postal codes in a German state
  state: "BY"    # Bayern

  # Option 3: municipality code (AGS)
  ags: "09162000"   # Munich
```

### Execution Parameters

```yaml
execution:
  parallel_processing: true
  max_workers: 8
  log_level: INFO
  result_directory: "./results"
  seed: 3329829316      # Deterministic k-means
```

### Consumer Categories

Define building types and their electrical load characteristics:

```yaml
consumer_categories:
  1:
    name: "Commercial"
    load_model: "per_m2"
    specific_demand_kwh_m2: 79
    simultaneity_factor: 0.50

  2:
    name: "Public"
    load_model: "per_m2"
    specific_demand_kwh_m2: 65
    simultaneity_factor: 0.45

  3:
    name: "Residential SFH"
    load_model: "household"
    peak_load: 3.5        # kW
    simultaneity_factor: 0.10
```

Available `load_model` values:
- `per_m2` — annual demand derived from floor area
- `household` — residential logic using Stromspiegel benchmarks

## config_database.yaml

```yaml
database:
  host: host.docker.internal
  port: 5433
  dbname: pylovo_db
  user: postgres
  password: postgres
  pool_size: 10
  max_overflow: 20
```

## config_table_structure.py

Defines the PostgreSQL schema for all PyLovo tables. Key tables:

| Table | Description |
|---|---|
| `buildings_result` | Final building records with `f_class`, peak load, consumer category |
| `postcode` | Postal code geometries with `country_code`, `state_code` |
| `grid_result` | Generated cable segments and transformer locations |
| `country` / `state` | Supported country and state registry with OSM/NUTS metadata |
| `transformer` | Transformer locations (brownfield + generated) |
| `building_transformer_assignments` | Many-to-one building → transformer mapping (per `model_id`) |

## Environment Variables

The `.env` file in the PyLovo root overrides config file defaults:

```bash
DBNAME=pylovo_db
USER=postgres
PASSWORD=postgres
HOST=host.docker.internal
PORT=5433
API_HOST=0.0.0.0
API_PORT=8086
```
