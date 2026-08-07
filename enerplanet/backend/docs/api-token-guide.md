# API Token Guide — Programmatic Access to Models

This guide explains how an **expert** issues a personal access token for a
user, and how that user accesses their wildfire models and results from any
external application (scripts, Postman, other apps) using the token.

- Base URL (local development): `http://localhost:8000/api`
- Base URL (production): `https://wildfire.th-deg.de/api`

---

## Part 1 — Issuing a token (expert)

Tokens are created by experts from the admin dashboard and handed to the user.
A token always acts **as that user**: it can see exactly the models the user
owns or that were shared with them — nothing more.

1. Log in with an **expert** account.
2. Go to **Admin Dashboard → User Management**.
3. Find the user in the table and click the **key icon** in the Actions
   column.
   - A grey key = the user has no active tokens.
   - A green key = the user already has at least one active token.
4. In the dialog, fill in:
   - **Token name** — what it's for, e.g. `analysis-script` or `qgis-import`.
   - **Scope** — `Read-only (recommended)` can only fetch data;
     `Read & write` can also create/modify (use only when required).
   - **Expiry** — 30 days, 90 days (default), 1 year, or never.
5. Click **Generate token**.
6. **Copy the token immediately** (yellow box, `whf_…`).
   ⚠️ It is shown exactly once and can never be retrieved again — not by
   you, not by the user, not from the database (only a hash is stored).
7. Hand the token to the user over a secure channel (not plain e-mail if
   avoidable; a password manager share or similar is preferred).

### Managing existing tokens

The same dialog lists every token of the user with its name, prefix
(`whf_xxxxxxxx…`), status (Active / Revoked / Expired), scope, expiry, and
last-used date. Click **Revoke** to disable a token immediately — the next
API request with it fails with `401`.

---

## Part 2 — Using the token (user / external app)

Send the token in the `Authorization` header of every request:

```
Authorization: Bearer whf_<your-token>
```

### Quick test with curl

```bash
TOKEN="whf_paste_your_token_here"

# List your models
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models

# One model (take an id from the list)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models/92

# Results and risk metrics of a model
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models/92/results
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models/92/risk-metrics

# Download the result archive
curl -OJ -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models/92/download
```

### Postman

1. New request → method `GET`, URL `http://localhost:8000/api/models`.
2. **Authorization** tab → Type **Bearer Token** → paste the `whf_…` token.
3. **Send**. A `200` response lists the user's models.
4. Save the token as a Postman environment variable (`{{api_token}}`) to
   reuse it across requests.

### Python example

```python
import requests

BASE = "http://localhost:8000/api"
TOKEN = "whf_paste_your_token_here"
headers = {"Authorization": f"Bearer {TOKEN}"}

models = requests.get(f"{BASE}/models", headers=headers).json()["data"]
for m in models:
    print(m["id"], m["title"], m["status"])

model_id = models[0]["id"]
metrics = requests.get(f"{BASE}/models/{model_id}/risk-metrics", headers=headers).json()
print(metrics)
```

### Selecting a model

`GET /models` returns **all the models you can access** — your own plus any
shared with you. You pick the one you want from that list. Each entry includes:

- `id` — the model id you pass to every other `/models/{id}/...` endpoint.
- `title` — the human name of the model (e.g. `Galicia`), so you can recognise it.
- `status` — `draft`, `queue`, `running`, `completed`, `published`, …
- `child_model_ids` — on a **parent** model, the ids of its copies/versions.
- `parent_model_id` + `parent_model_title` — on a **child** model, the id and
  title of the model it was copied from (e.g. `Galicia v1` shows
  `parent_model_title: "Galicia"`), so the relationship is readable.

Normal flow: call `GET /models`, find the model **by its `id`** (using the
`title` to recognise it), then use that id in the follow-up calls.

```bash
# List all models, then pick the id of the one whose title you want
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/models \
  | jq '.data[] | {id, title, status, parent_model_title, child_model_ids}'
```

### Fetching a result and its map layer (the result id)

The map/WMS layer is **not** addressed by the model id. There are two ids in
play, and mixing them up is the most common mistake:

- **model id** — identifies the model (e.g. `84`). Used by every `/models/...`
  endpoint.
- **result id** — identifies the *processed result record* of that model
  (e.g. `43`). Used **only** by `/results/{result_id}/layer`.

**How to get the `result_id`:** run `GET /models/{model_id}/results`. The
response `data` is a list of result records; the `id` of a record **is** the
`result_id`. Then call `/results/{result_id}/layer` with it.

```text
GET /models/84/results   →  data[0].id = 43      ← this 43 is the result_id
GET /results/43/layer    →  WMS layer info
```

Full example:

```bash
MODEL_ID=84

# 1. Get the result record(s) for the model — each has its own "id"
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/models/$MODEL_ID/results
# → data: [ { "id": 57, "model_id": 84,
#             "geoserver_layer_name": "...", "geoserver_status": "configured" } ]

# 2. Use that RESULT id (57 here — NOT the model id 84) to get the layer
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/results/57/layer
```

In Python:

```python
model_id = 84
results = requests.get(f"{BASE}/models/{model_id}/results", headers=headers).json()["data"]
if results:
    result_id = results[0]["id"]            # the result-record id, NOT the model id
    layer = requests.get(f"{BASE}/results/{result_id}/layer", headers=headers).json()
    print(layer)
else:
    print("No processed result yet for this model.")
```

If `GET /models/{id}/results` returns an empty list (`"data": []`), the
calculation has not been processed into GeoServer yet, so there is no layer to
fetch and `/results/{result_id}/layer` would return `404 Result not found`.

### Available endpoints

| Method | Endpoint                        | Description                                                             | Scope |
| ------ | ------------------------------- | ----------------------------------------------------------------------- | ----- |
| GET    | `/models`                       | List your models (supports `limit`, `offset`, `search`, `workspace_id`) | read  |
| GET    | `/models/stats`                 | Your model usage statistics                                             | read  |
| GET    | `/models/{id}`                  | One model with its configuration                                        | read  |
| GET    | `/models/{id}/results`          | Result records (processing status, GeoServer layer state)               | read  |
| GET    | `/models/{id}/risk-metrics`     | Computed fire-risk metrics                                              | read  |
| GET    | `/models/{id}/risk-map-samples` | Positioned raster samples for visualisation                             | read  |
| GET    | `/models/{id}/download`         | Download the result archive                                             | read  |
| GET    | `/results/{result_id}/layer`    | WMS layer info for map integration (QGIS etc.)                          | read  |
| POST   | `/models`                       | Create a model                                                          | full  |
| POST   | `/calculation/start/{id}`       | Start a calculation                                                     | full  |

A **read-only** token can use every GET endpoint; POST/PUT/DELETE requests
are rejected with `403`. A **full** token can also use the write endpoints,
with the user's normal permissions and limits.

> **Note on ids:** every `/models/...` endpoint takes the **model id**. The
> `/results/{result_id}/layer` endpoint is the exception — `{result_id}` is the
> id of a **result record**, not the model id. Get it from
> `GET /models/{id}/results`: each entry there has its own `id`, which you then
> pass to `/results/{result_id}/layer`. A model only has a result record once
> its calculation has been processed into GeoServer; until then this endpoint
> returns `404 Result not found`.

---

## Part 3 — Errors and what they mean

| Response                          | Meaning                                                      | Fix                                                      |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `401 Invalid API token`           | Token unknown, expired, or revoked                           | Ask an expert for a new token                            |
| `401 Session not found`           | `Authorization` header missing or malformed                  | Header must be exactly `Bearer whf_…`                    |
| `403 This API token is read-only` | Write attempt with a read-only token                         | Ask for a `full`-scope token if writing is really needed |
| `403 Access denied`               | The model belongs to another user and is not shared with you | Request access via model sharing                         |
| `404 Model not found`             | Wrong model id                                               | Check `GET /models` for valid ids                        |

---

## Part 4 — Security properties (for reference)

- Tokens are 256-bit random values; the server stores only a SHA-256 hash.
  A database leak does not expose usable tokens.
- The plaintext appears exactly once, in the create response, and is never
  logged.
- Tokens never carry expert/manager privileges, regardless of the user's
  role — admin endpoints are not reachable with a token.
- Default scope is read-only; default lifetime is 90 days.
- Every token request is audit-logged (token id, user, route); creation and
  revocation are logged with the acting expert.
- Revocation is immediate.

## Part 5 — Manager access (creating users & API tokens)

If your account has **Manager** access, you can manage your own group of users
directly from the dashboard — you don't need an expert for day-to-day work:

- **Create new users** in your group — **User Management → Add New User**.
- **Generate and revoke API tokens** for those users — the **key icon** in the
  Actions column opens the same token dialog described in Part 1.
- Users you create stay inside your manager group.

![Manager — User Management](images/user-management.png)

The screenshot shows the **User Management** tab under **Manager Access**: the
**Add New User** button (top right) and, for each user row, the **Actions**
icons — including the **key icon** used to create or revoke that user's API
tokens. So a manager can both onboard a user and issue them an API token from
this one screen.

---

## Troubleshooting

- **Everything returns 401 although the token is fresh** — the backend may
  be running a build that predates the token feature; restart it.
- **`{"data": []}` although the user has models** — the token belongs to a
  different user than expected; check the email shown in the token dialog.
- **CORS errors from a browser app** — browser-based apps on other origins
  are subject to the API's CORS allow-list; server-side use (scripts,
  Postman, backends) is unaffected.

---

## Part 6 — Worked example: model → result id → layer (tested in Postman)

This is the end-to-end flow that turns a **model id** into a **map layer**,
using model `84` as the example. Set **Authorization → Bearer Token** to your
`whf_…` token on each request.

### Step 0 — List the user's models (find the `model_id`)

Send:

```
GET http://localhost:8000/api/models
```

This returns **every model belonging to (or shared with) the token's user**.
The response `data` is a list; for each model you can read:

- `id` — the **model id** (here `84`) you'll use in the next steps.
- `title` — the model's name, so you can recognise the one you want.
- `status` — e.g. `completed`, `draft`, `running`.
- `workspace` — the workspace the model lives in (id, name, members).
- `parent_model_id` / `parent_model_title` — present on a copy, showing which
  model it was versioned from.
- `child_model_ids` — present on an original, listing its copies/versions.

Pick the `id` of the model you want (here **`84`**) and continue.

![GET /models — all models for the user, with id, title, status, workspace](images/test-models-list.png)

### Step 1 — Get the result record (find the `result_id`)

Send:

```
GET http://localhost:8000/api/models/84/results
```

The response lists the model's result record(s). The **`id`** field of a
record is the **`result_id`** you need next — here it is **`43`** (note this is
*not* the model id `84`). Useful fields in the same record:

- `model_id` — confirms which model this result belongs to (`84`).
- `geoserver_layer_name` (`model_84`) and `geoserver_workspace` (`fire_risk`).
- `geoserver_status: configured` — the layer is ready to view.

![GET /models/84/results — the result id is data[0].id = 43](images/test-models-results.png)

### Step 2 — Get the map layer using that `result_id`

Take the `id` from Step 1 (`43`) and send:

```
GET http://localhost:8000/api/results/43/layer
```

The response is the WMS layer info you plug into QGIS or a web map:

- `wms_url` — `http://localhost:8083/api/geoserver-proxy/fire_risk/wms`
- `layer_name` — `fire_risk:model_84`
- `workspace` — `fire_risk`
- `status` — `configured`
- `bounds` — `minx/miny/maxx/maxy` with `crs: EPSG:4326`

![GET /results/43/layer — WMS layer info](images/test-result-layer.png)

> Remember: `GET /results/84/layer` would fail with `404 Result not found`,
> because `84` is the **model id**, not the **result id**. Always take the
> `result_id` from `GET /models/{model_id}/results` first.
