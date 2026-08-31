# Configurator

The grid model configurator — a map-based UI for selecting a region, generating a synthetic grid (via PyLovo), assigning technologies to buildings, and running power flow simulations. This is the legacy configurator (the Model Builder is the planned successor).

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
| `useBuildingDemandRecalculation` | Recalculate energy demand when parameters change |
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

### Dialogs

| Dialog | Trigger | Purpose |
|---|---|---|
| `AddTransformerDialog` | Click map in add-transformer mode | KVA picker + confirm |
| `TransformerDialog` | Click existing transformer | View/edit, move, delete |
| `BuildingDialog` | Click building | Edit fClass, demand, geometry, techs |
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
User draws polygon → PolygonDrawer → useModelStore.setAllPolygons
  → useAreaSelect calls pylovoService.generateGrid()
    → pylovoGridData returned → usePylovoLayers renders OpenLayers features
      → User clicks building → BuildingDialog opens
        → User assigns tech → useTransformerActions / useTechDragDrop
          → User runs power flow → pylovoService.runPowerFlow()
```

## Style conventions

All dialogs, banners, and overlays follow the same visual language:

- `bg-card/95 backdrop-blur-md border border-border/50 rounded-full` for banners
- `Dialog` (shadcn/ui) with `sm:max-w-md gap-5` and icon in `w-10 h-10 rounded-xl bg-muted` for dialogs
- `rounded-full` primary buttons with `px-3 py-1`
- Animated-in banners: `animate-in slide-in-from-top-2 fade-in duration-300`