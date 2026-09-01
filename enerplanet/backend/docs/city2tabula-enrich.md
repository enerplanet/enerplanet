# City2TABULA enrich endpoint

Resolves City2TABULA 3D envelope data for the buildings in a user-drawn area and
returns a per-`osm_id` merge map the Building Configurator folds onto its
building features. Called after the PyLovo grid is fetched.

Two endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/city2tabula/enrich` | resolve the area; trigger a pipeline run if some buildings are unlinked |
| GET | `/api/v1/city2tabula/enrich/{run_id}` | poll a triggered run; returns data once it completes |

Both require session auth. The OpenAPI definitions are in `docs/swagger.json`
(regenerate with `make docs`); the Swagger UI is at
`/api/swagger/index.html`.

## Testing in Postman

1. `make docs` (or use the committed `docs/swagger.json`).
2. Postman → Import → `docs/swagger.json`. This creates a "City2TABULA" folder
   with both requests and example bodies filled from the schema.
3. Set a collection variable `baseUrl` to `http://localhost:8000` and log in
   (`POST /api/login`, `admin@example.de` / `12345678`) so the `session_id`
   cookie is set.
4. Run the requests below.

City2TABULA itself must be reachable at `CITY2TABULA_SERVICE_URL` (default
`http://localhost:5000`) with data for the country. Germany LoD2 is the
reliable test country.

## Flow and payloads

### 1. Area already covered

Every `osm_id` is already linked in City2TABULA. One call, data returned inline.

```bash
curl -s -X POST http://localhost:8000/api/v1/city2tabula/enrich \
  -H 'Content-Type: application/json' \
  -b 'session_id=<cookie>' \
  -d '{
    "country": "germany",
    "bbox": { "xmin": 6.09, "ymin": 51.90, "xmax": 6.13, "ymax": 51.93 },
    "osm_ids": ["240054621", "240054622"]
  }'
```

```json
{
  "status": "completed",
  "resolved": 2,
  "total": 2,
  "data": {
    "240054621": {
      "object_id": "DEBW_1",
      "match_type": 1,
      "tabula_variant_code": "DE.N.SFH.05.Gen.ReEx.001.001",
      "buem": {
        "building": {
          "n_storeys": 3,
          "h_room": { "value": 2.5, "unit": "m" },
          "footprint_area": { "value": 80, "unit": "m2" },
          "envelope": {
            "elements": [
              { "id": "w1", "type": "wall", "area": { "value": 30, "unit": "m2" }, "azimuth": { "value": 180, "unit": "deg" }, "tilt": { "value": 90, "unit": "deg" } },
              { "id": "r1", "type": "roof", "area": { "value": 60, "unit": "m2" }, "azimuth": { "value": 0, "unit": "deg" }, "tilt": { "value": 0, "unit": "deg" } }
            ]
          }
        }
      }
    }
  }
}
```

### 2. Area not yet processed

Some `osm_ids` are not linked. A bbox-scoped pipeline run is triggered; the
response is `202` with a `run_id` and whatever resolved so far.

```bash
curl -s -i -X POST http://localhost:8000/api/v1/city2tabula/enrich \
  -H 'Content-Type: application/json' \
  -b 'session_id=<cookie>' \
  -d '{
    "country": "germany",
    "bbox": { "xmin": 6.09, "ymin": 51.90, "xmax": 6.13, "ymax": 51.93 },
    "osm_ids": ["240054621", "999999999"]
  }'
```

```
HTTP/1.1 202 Accepted
```
```json
{
  "status": "running",
  "run_id": "a1b2c3d4",
  "resolved": 1,
  "total": 2,
  "missing": ["999999999"],
  "data": { "240054621": { "...": "as above" } }
}
```

Then poll, repeating `country` and `osm_ids` so the completed response carries
the merge map:

```bash
curl -s 'http://localhost:8000/api/v1/city2tabula/enrich/a1b2c3d4?country=germany&osm_ids=240054621,999999999' \
  -b 'session_id=<cookie>'
```

```json
{ "status": "running", "resolved": 0, "total": 0, "data": {} }
```

When the run finishes:

```json
{
  "status": "completed",
  "resolved": 2,
  "total": 2,
  "data": { "240054621": { "...": "..." }, "999999999": { "...": "..." } }
}
```

### 3. City2TABULA unavailable for a run

Some buildings are unlinked but the pipeline run could not be triggered. The
client proceeds with what resolved.

```json
{ "status": "partial", "resolved": 1, "total": 2, "missing": ["999999999"], "data": { "240054621": { "...": "..." } } }
```

## Response fields

| Field | Meaning |
|---|---|
| `status` | `completed` \| `running` \| `partial`; on the run endpoint also City2TABULA's `pending` \| `no_data` \| `failed` |
| `run_id` | present when `status` is `running`; pass to the GET endpoint |
| `resolved` / `total` | count of `osm_ids` with data / requested |
| `missing` | `osm_ids` with no linked City2TABULA building |
| `data[osm_id].tabula_variant_code` | absent when City2TABULA matched the building geometry but no TABULA archetype; the configurator falls back to an archetype |
| `data[osm_id].buem.building.envelope.elements` | one element per usable surface; `id` is the City2TABULA surface id unchanged; `tilt` and `azimuth` are already in BuEM's convention |
| `data[osm_id].buem.building.{n_storeys,h_room,footprint_area}` | present only when City2TABULA has the value |

## Status codes

| Code | Cause | Retry |
|---|---|---|
| 200 | resolved, or a run is in progress (`running`), or degraded (`partial`) | poll the run endpoint for `running` |
| 202 | a pipeline run was triggered | poll the run endpoint |
| 400 | `country` or `osm_ids` missing | no |
| 502 | City2TABULA unreachable | yes, after a delay |
