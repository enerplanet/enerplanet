# Validation: Node Modeller README vs. Configurator

Validated against [`enerplanet/frontend/src/features/configurator`](../configurator) — the actual implementation at commit time.

---

## Aspect 1: The Context

**README claim:** A unified context object holding all model data (geodata, userdata, everything needed for compilation). Context leads the workflow. Every change saved as a diff — revertable, redoable, traceable.

**Configurator reality:** Data is fragmented across:

- [`AreaSelectState`](../configurator/types/area-select.ts:112) (form fields, polygons, flags)
- OpenLayers map features (building edits, tech assignments, transformer kVA)
- React Query cache (model list, stats)
- [`PylovoGridData`](../configurator/types/area-select.ts:82) (grid snapshot, fetched once)
- Auth/workspace Zustand stores

There is **no unified context object**. The save pipeline assembles a payload ad-hoc from these scattered sources. There is **no diff tracking, no undo/redo, no change traceability**.

**Viability:** ⚠️ The concept of a unified context is sound and would simplify data flow. But the configurator proves it's not strictly necessary — the fragmented approach works, at the cost of complexity and fragility.

**Shortcoming for an improved configurator:** The README doesn't specify _how_ diffs are stored (operational transforms? event sourcing? JSON patches?). Without a concrete diff mechanism, this is aspirational.

---

## Aspect 2: The Workflow

**README claim:** A node-based workflow: A (Model Settings) → B (Area Selection + Grid) → C (Demand) → D (Technologies) → E (Run Model) → F (View Results), with optimization sub-workflows.

**Configurator reality:** The configurator is a **single monolithic page** ([`AreaSelect.tsx`](../configurator/region-selector/AreaSelect.tsx)). All steps happen simultaneously:

- User draws polygons on the map
- Grid is generated in one shot via `pylovoService.generateGrid()`
- Buildings are editable immediately
- Technologies can be dragged onto buildings at any time
- Save bundles everything at once

There is **no step-by-step workflow, no node sequencing, no optimization loop**. The "optimization workflow" described (self-reliance, renewables, cost) **does not exist** anywhere in the configurator.

**Viability:** ✅ High. A workflow engine would be a genuine improvement. Breaking the monolithic page into sequenced steps would reduce cognitive load and enable the optimization loops the README describes.

**Shortcomings for an improved configurator:**

1. The README's workflow mixes **UI steps** (Model Settings) with **backend computation** (Run Model) and **decision points** (View Results → Branch/Optimize/New). These are different node types with different semantics — the README doesn't distinguish them.
2. The "Technologies Module" sub-loop (select building → show techs → assign → loop) is described as a single node D, but it's itself a mini-workflow. The README doesn't address nested/sub-workflows.
3. The optimization workflow assumes Calliope/PyPSA results are available, but the configurator currently only does grid-level PyPSA (power flow), not full energy system optimization. The backend may not support this yet.
4. No mention of **error handling** or **rollback** within the workflow — what happens when a node fails?

---

## Aspect 3: Node-Based Workflow Builder for Admins

**README claim:** React Flow-based visual editor. Dynamic node linking based on context requirements. Publishing/management tool with admin vs. user permissions.

**Configurator reality:** **Nothing like this exists.** The configurator is a fixed UI — there is no workflow builder, no React Flow integration, no admin publishing workflow. The concept is entirely new.

**Viability:** ⚠️ Technically feasible (React Flow is mature), but the scope is massive. This is essentially building a low-code platform on top of the energy modelling domain.

**Shortcomings for an improved configurator:**

1. **Massive scope creep.** A visual workflow builder with admin publishing is a separate product, not an "improved configurator." The README underestimates the engineering cost.
2. **Context validation at link time** ("if the node's required input is not in the context, the node can't be connected") requires a formal type system for context data. The configurator has no such type system.
3. **Permission model** (admin vs. user) is not currently in the backend for workflows. The backend has workspace roles but no workflow-level RBAC.
4. **React Flow** is good for DAGs, but the README describes loops (optimization iterates through modules). DAGs don't naturally support cycles — this needs careful design.

---

## Aspect 4: User Datasets (Timeseries)

**README claim:** User-uploaded timeseries for demand and technology production. Stored in object database. Removable via data management tool. Default data fallback.

**Configurator reality:** The configurator uses **AI-based estimation** via [`energyService.estimateBuildingEnergyDemand()`](../configurator/services/energyService.ts:61) which calls `/v2/pylovo/estimate-energy`. There is:

- No timeseries upload
- No object database for user data
- No data management tool
- No concept of "default data" vs. "user data" — it's always AI-estimated

**Viability:** ✅ High value, but requires significant backend work. The current AI estimation is a pragmatic shortcut — user timeseries would be more accurate.

**Shortcomings for an improved configurator:**

1. The README doesn't specify the **timeseries format** (CSV? NetCDF? Parquet? OpenAPI-style hourly profiles?). This matters for implementation.
2. No mention of **validation** — what happens when a user uploads malformed data?
3. The "object database" is vague. Timeseries data is inherently time-indexed — a time-series DB (TimescaleDB, InfluxDB) would be more appropriate than a generic object store.
4. **Default data fallback** is already partially handled by the AI estimation — the README should clarify whether this replaces or supplements the AI approach.

---

## Aspect 5: History

**README claim:** Context tracked as diffs. History component showing changes. Branching from any history point. Branch awareness (origin tracking, visual indicators).

**Configurator reality:** The configurator has **zero history functionality**:

- No undo/redo
- No diff tracking
- No history component
- No branching UI

The backend [`modelService.duplicateModel()`](../../model-dashboard/services/modelService.ts:257) creates copies with `parent_model_id` and `is_copy` flags, and auto-incrementing " v2" titles. This is a **simple copy**, not branching with diff-based history.

**Viability:** ⚠️ High user value, but extremely complex to implement correctly. Git-like branching for energy models is novel research territory.

**Shortcomings for an improved configurator:**

1. **Storage explosion.** Storing every change as a diff means the backend needs an event store or similar. The current PostgreSQL-backed model service is not designed for this.
2. **Diff granularity.** What constitutes a "change"? A keystroke in the model name? A drag on the map? A tech parameter edit? The README doesn't define the atomic unit of change.
3. **Branch merge semantics.** The README describes branching but not merging. Can branches be merged? What happens when two branches modify the same building?
4. **Performance.** Loading a model with 500+ history entries and showing a branch tree would be non-trivial UI work.
5. The configurator's `configFingerprint()` approach (counting features + techs) is a pragmatic alternative — it detects _that_ something changed without tracking _what_ changed. The README should consider whether full diff history is worth the complexity.

---

## Aspect 6: UI/UX and Cognitive Load

**README claim:** Cognitive lightweight interface. Logical defaults. Hidden advanced options.

**Configurator reality:** Partially aligned:

- ✅ Advanced parameters are in a drawer ([`AdvancedParametersDrawer.tsx`](../configurator/region-selector/AdvancedParametersDrawer.tsx))
- ✅ Building dialogs have sensible defaults
- ❌ The monolithic UI is inherently complex — the user sees everything at once (map, sidebar, tech drawer, building dialogs)
- ❌ No progressive disclosure beyond the advanced params drawer

**Viability:** ✅ The goal is correct. A step-by-step workflow (Aspect 2) would inherently improve cognitive load by showing only what's relevant at each step.

**Shortcomings for an improved configurator:**

1. The README doesn't address **mobile/responsive** — energy modelling on small screens is a real UX challenge.
2. No mention of **onboarding** or **guided tours** for non-expert users. The configurator has a tour (`showAreaSelectTour` in [`AreaSelectState`](../configurator/types/area-select.ts:119)) but it's minimal.
3. "Logical defaults" need to be **context-aware** — a German residential district has different defaults than a Spanish industrial park. The configurator doesn't handle this.

---

## Aspect 7: Clear Cutoff and Isolated Testing

**README claim:** Each module testable with vitest. Component importable externally. Local file download mode for isolation.

**Configurator reality:** The configurator is **deeply coupled**:

- Direct imports from `@/lib/axios`, `@/store/auth-store`, `@/providers/map-context`
- Depends on OpenLayers (map, layers, features, styles)
- Depends on React Query mutations from `@/features/model-dashboard`
- Depends on Zustand stores (auth, workspace, map)
- No DI or module boundary abstraction

There are **no vitest tests** for the configurator.

**Viability:** ✅ Essential for maintainability. The configurator's tight coupling is its biggest technical debt.

**Shortcomings for an improved configurator:**

1. The README says "each module should be testable on its own" but doesn't define **what a module is**. Is a module a workflow node? A UI component? A service?
2. **External importability** conflicts with the deep integration the configurator needs (map, backend, auth). True isolation would require an abstraction layer (ports & adapters) that the README doesn't mention.
3. The "local file download" mode is a good idea but the README doesn't specify the **data format** — is it a single JSON blob? A zip of GeoJSON files? A Calliope-compatible model folder?

---

## Overall Assessment

| Aspect                    | Viability | Configurator Gap                | Effort         |
| ------------------------- | --------- | ------------------------------- | -------------- |
| 1. Unified Context        | ⚠️ Medium | Fragmented state, no diffs      | Medium         |
| 2. Workflow Engine        | ✅ High   | Monolithic page, no sequencing  | High           |
| 3. Admin Workflow Builder | ⚠️ Low    | Doesn't exist, separate product | Very High      |
| 4. User Timeseries        | ✅ High   | AI estimation only              | High (backend) |
| 5. History & Branching    | ⚠️ Medium | No history, simple copy only    | Very High      |
| 6. UI/UX Cognitive Load   | ✅ High   | Partially addressed             | Medium         |
| 7. Isolated Testing       | ✅ High   | Deeply coupled, no tests        | Medium         |

### Key Recommendations for an Improved Configurator

1. **Start with the workflow engine (Aspect 2)** — it's the highest-viability, highest-impact change. Break the monolithic page into sequenced steps. This alone reduces cognitive load (Aspect 6) and enables module isolation (Aspect 7).

2. **Add a unified context with change tracking (Aspect 1)** — but use a simple approach (snapshot-on-save with fingerprinting, like the current `configFingerprint()`) rather than full diff history. Full Git-style branching (Aspect 5) can come later.

3. **Defer the admin workflow builder (Aspect 3)** — it's a separate product. Start with hardcoded workflows, then add a workflow definition format (JSON/YAML), then consider a visual editor.

4. **Add user timeseries (Aspect 4)** alongside the existing AI estimation — let users override AI estimates with their own data. This is high-value and doesn't require replacing the existing system.

5. **Invest in testability (Aspect 7)** from day one — extract pure functions, use dependency injection for services, and write vitest tests for each workflow node in isolation.
