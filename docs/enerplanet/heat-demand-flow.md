---
audience: developer
---

# Heat Demand Resolution

The backend resolves a building's annual space-heating demand from TABULA
building-typology data served by ignis. Every ignis call is routed through the
TentaCron orchestrator; the backend holds no ignis address of its own.

This page covers the request path from a generated grid to a resolved figure
in the building dialog.

## Participants

| Component | Role |
|---|---|
| Configurator UI | React building dialog on `:3000` |
| Backend | Go / Gin on `:8000` |
| PyLovo | LV-grid service on `:8086` |
| TentaCron | Orchestrator on `:8092` |
| ignis | TABULA / EN ISO 13790 heat-demand service |

## Request flow

The sequence below shows grid creation, the two lookups fired when the dialog
opens, and the two ignis calls made on resolve.

```mermaid
sequenceDiagram
    autonumber
    participant U as Configurator UI
    participant BE as Backend
    participant PL as PyLovo
    participant TC as TentaCron
    participant IG as ignis

    note over U,PL: 1 - Grid and buildings
    U->>BE: POST /api/v2/pylovo/generate-grid (polygon)
    BE->>PL: POST /generate-grid
    PL-->>BE: buildings + LV grid<br>(f_class, floors, area, country_code)
    BE-->>U: FeatureCollection - buildings drawn on the map

    note over TC: Every TentaCron call is async. POST /v1/requests<br>(target + payload, X-API-Key header) returns 202 and a request id.<br>The backend long-polls the request until its state is completed,<br>then reads the verbatim ignis body from result.target_response.

    note over U,IG: 2 - Building clicked, dialog opens
    U->>BE: GET /api/v2/ignis/fields
    BE->>TC: target ignis-fields, empty payload
    TC->>IG: GET /api/v1/fields
    IG-->>TC: field catalogue
    TC-->>BE: completed
    BE-->>U: success envelope - form labels

    U->>BE: GET /api/v2/ignis/variants/DE
    BE->>TC: target ignis-variants, payload iso2
    TC->>IG: GET /api/v1/variants/DE
    IG-->>TC: variant code strings
    TC-->>BE: completed
    BE-->>U: success envelope - Building Type dropdown (SFH, TH, MFH, AB)

    note over U,IG: 3 - Type and construction year chosen, Resolve clicked
    U->>BE: POST /api/v1/heat-demand/resolve<br>(osm_id, f_class, building_type, construction_year,<br>floor_area_m2 taken as footprint times floors, country)
    note over BE: in-process - residential check,<br>TABULA type, ISO2 (no network)
    BE->>TC: target ignis-variants-match, payload iso2 + type + year
    TC->>IG: GET /api/v1/variants/DE/match for type MFH and year 1975
    IG-->>TC: code + label pairs, existing state first
    TC-->>BE: completed - the first code is taken
    BE->>TC: target ignis-calculate, payload code
    TC->>IG: POST /api/v1/calculate for that code, empty body
    IG-->>TC: variant_code, q_h_nd, unit
    TC-->>BE: completed
    note over BE: heating_demand_kwh_a is<br>round(floor_area_m2 times q_h_nd)
    BE-->>U: source ignis, heating_demand_kwh_a,<br>specific_heating_demand_kwh_m2a, tabula_variant_code
```

## Notes

- **Two ignis calls per resolve**: `ignis-variants-match` then `ignis-calculate`.
  `ignis-fields` and `ignis-variants` fire once when the dialog first opens and
  are cached per country on the frontend.
- **The browser makes one call per user action.** The 202 + long-poll runs
  entirely between the backend and TentaCron on the internal network.
- **Routing logic stays in the backend.** The residential classifier, the
  TABULA-type mapping, the by-code dedup, and the U-value attach used by
  `run_buem` all run in-process. TentaCron performs only the configured call.
- **Fallback.** A non-residential class, a missing construction year, no
  matching archetype, or an ignis error falls back to the usage-class estimate:
  `source: "estimate"` with a `warnings` entry naming the reason.
- **ignis 4xx** returns as a TentaCron `target_error`; the backend unwraps
  ignis's own message and treats it as a miss.

!!! note "Scope"
    Only ignis is routed through TentaCron. buem-gateway, City2TABULA and weather are still called directly by the
    backend. Moving them behind TentaCron is planned as later increments.
