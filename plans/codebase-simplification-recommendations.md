# Codebase Simplification Recommendations

## 1. Well-Known NPM Packages to Reduce Code

### 1.1 `@tanstack/react-query` — Already Present, Underutilized

**Current usage:** Only for model mutations (`useCreateModelMutation`, `useUpdateModelMutation2`).

**Opportunity:** Replace ALL manual `useEffect` + `useState` data fetching patterns:

| Current pattern                                       | Lines | With React Query                                                                                                        |
| ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `useCustomLocations` — manual fetch in `useEffect`    | ~30   | `useQuery({ queryKey: ['custom-locations'], queryFn: () => ... })` with built-in caching, refetch, loading/error states |
| `loadExistingModelData` — manual fetch in `useEffect` | ~40   | `useQuery({ queryKey: ['model', modelId], queryFn: () => ... })`                                                        |
| `loadAvailableRegions` — manual fetch in `useEffect`  | ~60   | `useQuery({ queryKey: ['available-regions'], queryFn: () => ... })`                                                     |
| `pylovoService.generateGrid` — manual loading state   | ~30   | `useMutation` with `onSuccess`/`onError` callbacks                                                                      |
| `pylovoService.runPowerFlow` — manual loading state   | ~30   | `useMutation` with `onSuccess`/`onError` callbacks                                                                      |
| `checkAndShowAreaSelectTour` — manual fetch           | ~10   | `useQuery`                                                                                                              |

**Estimated savings:** ~200 lines, plus built-in caching, deduplication, stale-while-revalidate.

### 1.2 `zod` — Schema Validation & Type Generation

**Current problem:** `PylovoGridData` and related types are manually defined interfaces. API responses are typed with `any` in many places (e.g., `pylovoService.runPowerFlow` returns `any`).

**With zod:**

```typescript
const PylovoGridDataSchema = z.object({
  buildings: z.object({ type: z.string(), features: z.array(GeoJSONFeatureSchema) }).optional(),
  lines: z.object({ type: z.string(), features: z.array(GeoJSONFeatureSchema) }).optional(),
  // ...
});
type PylovoGridData = z.infer<typeof PylovoGridDataSchema>;
```

**Benefits:**

- Runtime validation of API responses (catch backend changes early)
- Automatic TypeScript types inferred from schemas
- Parse API responses safely: `PylovoGridDataSchema.parse(response)`
- Can validate user input (e.g., advanced parameters form)

**Estimated savings:** ~50 lines of type definitions, plus runtime safety.

### 1.3 `valibot` — Lighter Alternative to Zod

If bundle size is a concern, `valibot` is ~1/10 the size of zod with similar API.

### 1.4 `react-hook-form` + `@hookform/resolvers` — Form Management

**Current problem:** The sidebar panel has form fields (model name, date range, resolution, advanced parameters) that are manually managed with `useState` + `useCallback`.

**With react-hook-form:**

```typescript
const { register, handleSubmit, watch } = useForm<ModelFormData>({
  resolver: zodResolver(ModelFormSchema),
  defaultValues: { modelName: "", fromDate: "", toDate: "", resolution: 60 },
});
```

**Benefits:**

- Eliminates manual `useState` for each form field
- Built-in validation, error handling, dirty tracking
- `watch()` replaces manual `useEffect` for detecting changes
- `zodResolver` integrates with zod validation

**Estimated savings:** ~100 lines in form-related components.

### 1.5 `@dnd-kit` — Drag & Drop (Replace Custom Tech Drag)

**Current problem:** `useTechDragDrop.ts` has ~130 lines of custom drag-and-drop logic using native DOM events (`dragstart`, `dragover`, `drop`). It manually handles `pixel` calculations, `forEachFeatureAtPixel`, and feature highlighting.

**With @dnd-kit:**

```typescript
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core';

// Draggable tech item
function DraggableTech({ tech }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: tech.key, data: tech });
  return <div ref={setNodeRef} {...listeners} {...attributes}>{tech.alias}</div>;
}

// Droppable map area
function MapDroppable({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'map-area' });
  return <div ref={setNodeRef} style={{ position: 'relative' }}>{children}</div>;
}
```

**Benefits:**

- Eliminates manual DOM event handling
- Built-in accessibility (keyboard, screen reader support)
- Auto-handles drag overlays, animations, collision detection
- Well-maintained, 18k+ GitHub stars

**Estimated savings:** ~80 lines, plus better UX.

### 1.6 `immer` — Immutable State Updates

**Current problem:** Complex state updates in `usePylovoLayers.ts` (e.g., `runPowerFlowAnalysis` updating `pylovoGridData` with nested map/filter operations). The updater functions are hard to read and maintain.

**With immer:**

```typescript
import { produce } from "immer";

setPylovoGridData(
  produce((draft) => {
    draft.lines?.features?.forEach((feature, i) => {
      // Direct mutation syntax — immer handles immutability
      const props = feature.properties ?? {};
      if (props.loading_percent !== lineResult.loading_percent) {
        props.loading_percent = lineResult.loading_percent;
      }
    });
  })
);
```

**Benefits:**

- Eliminates complex spread operations (`...prev`, `...feature`, `...props`)
- Makes nested updates readable
- Built into Zustand via `immer` middleware: `create(immer((set) => ({...})))`

**Estimated savings:** ~50 lines, significantly better readability.

### 1.7 `date-fns` or `dayjs` — Date Handling

**Current problem:** Date formatting is done manually (e.g., `formatDate` function in `useAreaSelect.ts`). The `@internationalized/date` package is used sparingly.

**With date-fns:**

```typescript
import { format, parseISO } from "date-fns";
format(new Date(), "yyyy-MM-dd");
```

**Benefits:**

- Replaces custom `formatDate` helper
- Consistent date formatting across the app
- `dayjs` is even smaller (2KB vs 30KB for date-fns)

### 1.8 `@tanstack/react-virtual` — Virtualized Lists

**Current problem:** If there are lists of buildings, transformers, or tech items that could be long, they're rendered naively.

Not an immediate need, but worth noting if building lists grow.

### 1.9 `konva` or `react-konva` — Canvas Rendering (Alternative to OL)

**Current problem:** OpenLayers is used for map rendering, but OL has a steep learning curve and the imperative API (layers, sources, features) creates a lot of boilerplate (~800 lines in `usePylovoLayers.ts` alone).

**Not recommended** as a replacement for OL — OL is the right tool for GIS/map data. But if there are non-map canvas elements (diagrams, schematics), `konva` is lighter.

---

## 2. Further Codebase Simplification Ideas

### 2.1 Merge `modelStore.ts` and `pylovoStore.ts` into a Single Store

**Why:** The current split between `modelStore` and the extracted hooks is artificial. The `pylovoLayersRef` and its associated actions (`runPowerFlowAnalysis`, `processPylovoData`) are tightly coupled to the data they operate on.

**How:** Move the OL layer management into a Zustand store with `immer` middleware. The refs (`pylovoLayersRef`, `boundaryLayerRef`) can be stored in a module-level variable or a `Map` keyed by map instance.

**Savings:** Eliminates the need to pass `pylovoLayersRef` as a prop to `useTechDragDrop` and `useMapClickHandlers`.

### 2.2 Eliminate `useAreaSelect.ts` Entirely

**Why:** Now that `useAreaSelect.ts` is only 247 lines of orchestration, it's worth questioning whether it needs to exist at all. The `AreaSelect.tsx` component could call the 4 extracted hooks directly.

**How:** Move the orchestration logic (save, load, polygon handlers) into `AreaSelect.tsx` directly. The 4 hooks (`useCustomLocationLayers`, `usePylovoLayers`, `useTechDragDrop`, `useMapClickHandlers`) are already called independently.

**Savings:** Eliminates one layer of abstraction. `AreaSelect.tsx` becomes slightly larger (~500 lines) but with less indirection.

### 2.3 Standardize API Service Layer

**Current problem:** API services (`pylovoService`, `modelService`, `energyService`, `customLocationService`) have inconsistent patterns:

- Some return `{ success, data, message }`
- Some return `response.data` directly
- Some use `axios` directly, some use a service class

**How:** Create a consistent API client wrapper:

```typescript
// services/api.ts
class ApiClient {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await axios.get(url, { params });
    return response.data;
  }
  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await axios.post(url, data);
    return response.data;
  }
}
```

Then make all services use `ApiClient` and return typed responses using `zod` validation.

### 2.4 Extract OL Layer Management into a Reusable Abstraction

**Current problem:** OL layer creation (building layers, cable layers, transformer layers, MV line layers) is repeated in `usePylovoLayers.ts`. Each layer type has the same pattern: create source, read GeoJSON, add features, style, add to map.

**How:** Create a `LayerFactory` class:

```typescript
class LayerFactory {
  static createBuildingLayer(map: OLMap, geojson: any, colorMap: Map<number, number>): VectorLayer { ... }
  static createCableLayer(map: OLMap, geojson: any, colorMap: Map<number, number>): VectorLayer { ... }
  static createTransformerLayer(map: OLMap, geojson: any, colorMap: Map<number, number>): VectorLayer { ... }
}
```

**Savings:** ~100 lines, eliminates duplication of GeoJSON reading and feature setup.

### 2.5 Replace `any` Types with Proper Generics

**Current problem:** The codebase is heavy with `any` types, especially in:

- `pylovoService` responses
- OL feature properties
- Power flow results
- Transformer/building tooltip data

**How:** Use `zod` schemas to define types for API responses, then use `z.infer` to generate TypeScript types. This catches type mismatches at runtime and compile time.

### 2.6 Consolidate Notification System

**Current problem:** `useNotification` returns `{ notification, showSuccess, showError, hide }` and is passed around as a prop. `AreaSelect.tsx` has a `<Notification>` component that reads from this.

**How:** Move notification state into a Zustand store slice:

```typescript
const useNotificationStore = create<NotificationStore>((set) => ({
  open: false,
  message: "",
  severity: "info",
  showSuccess: (msg: string) => set({ open: true, message: msg, severity: "success" }),
  showError: (msg: string) => set({ open: true, message: msg, severity: "error" }),
  hide: () => set({ open: false }),
}));
```

**Savings:** Eliminates prop drilling of `notification` through `useAreaSelect` → child hooks → components.

### 2.7 Simplify Power Flow Analysis

**Current problem:** `runPowerFlowAnalysis` in `usePylovoLayers.ts` is a single 100-line function that:

1. Extracts grid IDs from multiple data sources
2. Runs parallel API calls
3. Applies results to OL features
4. Syncs results back to GeoJSON for 3D layers

**How:** Split into focused functions:

- `extractGridResultIds(pylovoGridData): number[]`
- `runPowerFlowForGrids(gridIds): Map<number, PowerFlowResult>`
- `applyPowerFlowResultsToLayers(results, layersRef)`
- `syncPowerFlowResultsToGeoJSON(results, pylovoGridData)`

**Savings:** Better testability, each function is ~20 lines instead of one 100-line function.

### 2.8 Use `React.Suspense` + `lazy` for Code Splitting

**Current problem:** `AreaSelect.tsx` imports many components statically, increasing initial bundle size.

**How:**

```typescript
const BuildingDialog = lazy(() => import("./components/BuildingDialog"));
const TechParameterDialog = lazy(() => import("./components/TechParameterDialog"));
```

**Savings:** Smaller initial bundle, faster page load. Particularly impactful for dialog components that are only opened on user interaction.

---

## 3. Priority Matrix

| Package/Idea                           | Effort | Impact | Risk   | Priority |
| -------------------------------------- | ------ | ------ | ------ | -------- |
| `@tanstack/react-query` (expand usage) | Medium | High   | Low    | **1**    |
| `zod` for API validation               | Medium | High   | Low    | **2**    |
| `react-hook-form` for forms            | Medium | Medium | Low    | **3**    |
| Eliminate `useAreaSelect.ts`           | Low    | Medium | Medium | **4**    |
| `immer` for immutable updates          | Low    | Medium | Low    | **5**    |
| Standardize API service layer          | High   | Medium | Medium | **6**    |
| Extract `LayerFactory`                 | Low    | Low    | Low    | **7**    |
| Consolidate notification store         | Low    | Low    | Low    | **8**    |
| `@dnd-kit` for drag-and-drop           | Medium | Low    | Medium | **9**    |
| `date-fns` for date formatting         | Low    | Low    | Low    | **10**   |
| Code splitting with `lazy`             | Medium | Low    | Low    | **11**   |

**Top 3 recommendations to implement next:**

1. **Expand React Query usage** — Replace manual `useEffect` + `useState` fetching patterns. This is the single biggest win for code reduction and reliability.
2. **Add `zod`** — Start with `PylovoGridData` and API response types. This catches runtime errors that TypeScript can't.
3. **Eliminate `useAreaSelect.ts`** — Now that it's only 247 lines, move its logic into `AreaSelect.tsx` directly. One less indirection layer.
