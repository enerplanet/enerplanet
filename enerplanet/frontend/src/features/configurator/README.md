# Configurator

The grid model configurator — a map-based UI for selecting a region, generating a synthetic grid (via PyLovo), assigning technologies to buildings, and running power flow simulations. This is the legacy configurator (the Model Builder is the planned successor).

> **Heat & tech-db support:** the configurator additionally assigns **heat** technologies
> and consumes the **OpenTech-DB** catalog (via the backend read-only proxy). It coexists
> with the legacy simulator techs — see the *Heat & OpenTech-DB* section below and
> `~/roo-okf/heat/*` for the full design.

## Quick start

The configurator lives at two routes:
- **Create:** `/app/area-select` — draw a polygon, generate a grid, configure
- **Edit:** `/app/models/:id/edit` — reopen an existing model

Both render the main `AreaSelect.tsx` component.

## Architecture

```
AreaSelect.tsx              ← orchestrator, ~100 lines of composition
├── MapContainer            ← OpenLayers map setup
├── GridActionBar           ← toolbar (add transformer, assign buildings, power flow)
├── MapInteractionBanners   ← top-of-map hints (add-transformer, assign-building, power flow)
├── PolygonDrawer           ← region selection drawing tools
├── PolygonDrawingGuide     ← drawing hints
├── SidebarPanel            ← model metadata, techs, parameters
├── AreaSelectTour          ← onboarding tour
├── LoadingOverlay          ← full-screen loading state
├── MapOverlays             ← tooltips, cursors, grid state
└── Dialogs                 ← AddTransformerDialog, TransformerDialog,
                               BuildingDialog, TechParameterDialog,
                               UnsavedChangesDialog
```

### Hooks (single-purpose, composable)

All hooks are re-exported from `hooks/index.ts` and wired into `AreaSelect.tsx`:

| Hook | Responsibility |
|---|---|
| `useAreaSelect` | Top-level orchestration (model CRUD, loading, navigation) |
| `useAddTransformerMode` | Add-transformer mode: map click → dialog → API call |
| `useMoveTransformerMode` | Click-to-move an existing user-placed transformer |
| `useBuildingAssignMode` | Multi-step assign: select buildings → pick transformer |
| `useBuildingDemandRecalculation` | Recalculate electric + heat demand when parameters change; persists `demand_heat` / `yearly_heat_demand_kwh` / `heat_demand_estimated` to building props |
| `useTransformerActions` | Delete / change kVA on an existing transformer |
| `useTechDragDrop` | Drag technology from sidebar onto a building |
| `useTechDialogFlow` | Tech parameter editing dialog lifecycle |
| `useMapClickHandlers` | Click-to-select buildings, transformers, MV lines on map |
| `useMapDisplay` | Map resize, reassignment line, MapLibre 3D handlers |
| `usePylovoLayers` | OpenLayers layer management for grid, buildings, transformers |
| `useCustomLocationLayers` | User-defined custom building layers |
| `useMultiEditMode` | Toggle multi-edit state for batch building edits |
| `useRegion` | Reverse-geocode polygon centroid → region name, handle region selection |
| `useMapResize` | Respond to sidebar/collapse layout changes |

### State

Centralized in a Zustand store (`store/modelStore.ts`). Key state groups:

- **Active mode** — a unified `activeMode` (`"add-transformer" | "move-transformer" | "assign-buildings" | "multi-edit" | null`) so only one interaction mode is active at a time
- **Grid data** — `pylovoGridData`, `powerFlowResults`, `isRunningPowerFlow`
- **Drawing** — `allPolygons`, `isDrawing`, `allowMultiplePolygons`, `cursorPos`
- **Model metadata** — `modelName`, `fromDate`, `toDate`, `resolution`
- **Transformer state** — `newTransformerCoords`, `addTransformerDialogOpen`, `transformerCursorPos`

Derived data (selectors in `region-selector/selectors/gridDataSelectors.ts`):

```ts
useGridResultIds(pylovoGridData)           // → number[]
useGridIdToTrafoCapacity(pylovoGridData)   // → Map<number, number>
useGridIdToPeakLoad(pylovoGridData)        // → Map<number, number>
useBuildingsInPolygonCount(pylovoGridData) // → number
```

### Services

- `services/pylovoService.ts` — axios client for `/v2/pylovo/*` endpoints (generate-grid, add-transformer, power-flow, transformer-sizes, etc.)
- `services/energyService.ts` — energy estimation API
- `services/opentechdbService.ts` — OpenTech-DB catalog bridge: fetches heat +
  electricity technologies via the backend proxy (`/api/opentech-db/*`),
  maps them onto the legacy `Technology` shape, offline fallback. Heat techs are
  gated by `output_carriers.includes("heat")` (see *Heat & OpenTech-DB*).

### Dialogs

| Dialog | Trigger | Purpose |
|---|---|---|
| `AddTransformerDialog` | Click map in add-transformer mode | KVA picker + confirm |
| `TransformerDialog` | Click existing transformer | View/edit, move, delete |
| `BuildingDialog` | Click building | Edit fClass, electricity + heat demand, geometry, techs (tech picker has carrier toggle ⚡/🔥 + search) |
| `TechParameterDialog` | Click tech in building | Edit tech-specific constraints |
| `UnsavedChangesDialog` | Navigate with unsaved changes | Discard or stay |

### Map overlays

- `MapOverlays` — tooltips, cursors, grid/building labels
- `TransformerCursorOverlay` — animated cursor following the mouse in add/move mode
- `MapInteractionBanners` — top-of-map hints for active modes
- `PowerFlowLegend` — color legend for power flow results
- `LoadingOverlay` — full-screen spinner during model load

## Data flow

```
buildings        → useBuildingDemandRecalculation writes yearly_demand_kwh,
                    demand_energy, peak_load_kw, demand_heat, yearly_heat_demand_kwh,
                    heat_demand_estimated to feature props
techs            → TechnologyDrawer / BuildingDialog picker → useTechDragDrop /
                    useTechDialogFlow writes feature.set("techs", {key:{alias,icon,constraints}})
                    (simulator techs from /technologies DB table; OTDB techs from the
                     proxy, badged, with provenance constraint entries)
producers→heat links → each building's techs go into model.config.buildings -->
  backend extractAndTransformTechs → webservice/Calliope
  → User runs power flow → pylovoService.runPowerFlow()
```

## Heat & OpenTech-DB

The configurator supports **two co-existing tech systems** (see `~/roo-okf/heat/tech-systems.md`):

| | Simulator techs (legacy) | OpenTech-DB techs |
|---|---|---|
| Source | `/technologies` DB table | backend proxy `/api/opentech-db/*` → external FastAPI (`dependencies/OpenTech-DB`) |
| Shape | `cont_*` / `cost_*` constraints | Calliope `essentials`/`constraints`/`costs` → mapped to `Technology` shape |
| Carrier | implicit electricity | explicit `carrier_in`/`carrier_out` |
| Heat techs | none | yes (heat pumps, boilers, CHP, thermal storage, heat networks) |

**Carrier toggle + search** in both the `TechnologyDrawer` and the
`BuildingDialog` tech picker: switch between ⚡ electricity and 🔥 heat; OTDB
techs are badged "OTDB" and shown below the simulator techs (or as the whole heat
view).

**Heat demand.** `useBuildingDemandRecalculation` writes `demand_heat` /
`yearly_heat_demand_kwh` / `heat_demand_estimated` to each building's feature
props alongside its electricity demand; the payload carries them (backend reads
these keys). `configurator/utils/heatDemand.ts` mirrors the backend's TABULA
estimate for display.

**Backend dependency.** The OpenTech-DB read-only proxy lives in the backend:
`internal/opentechdb/client.go` + `handler.go`, a 1:1 passthrough mounted at
`/api/opentech-db/*proxyPath` → upstream `/api/v1/<path>` (raw body, no
`{success,data}` envelope). See `~/roo-okf/heat/opentechdb-api.md`.

> Heat-network features (expected-fit auto-resolve, blocking heat validation,
> producer→consumer heat links, fuel-price surfacing) are planned but not yet in
> the configurator — see `enerplanet/frontend/heat-configurator-plan.md`.

## Style conventions

All dialogs, banners, and overlays follow the same visual language:

- `bg-card/95 backdrop-blur-md border border-border/50 rounded-full` for banners
- `Dialog` (shadcn/ui) with `sm:max-w-md gap-5` and icon in `w-10 h-10 rounded-xl bg-muted` for dialogs
- `rounded-full` primary buttons with `px-3 py-1`
- Animated-in banners: `animate-in slide-in-from-top-2 fade-in duration-300`