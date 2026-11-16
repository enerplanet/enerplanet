/**
 * `building-configurator` — configure buildings and their technologies, using the npm package's 3D view.
 *
 * **This module is the deliberate counter-example to "one module, one job".** It writes two ports — a
 * building's demand parameters and its technologies — which `building-demand` and `technologies` also write.
 * The overlap is the point (`modules/building-configurator-npm.md`): the all-in-one view is the legacy's only
 * building-configuration path, and `simple-building-editor` + `simple-technology-editor` exist as the clean
 * split it could be replaced by.
 *
 * What it owns is narrow and worth naming: **the opening, the picking, and the committing.** The view is a
 * blackbox the shell installs (`view.ts`), so this file never learns what renders a building — only that
 * something does, and what it hands back.
 *
 * The flow is the legacy's: the buildings layer accepts clicks, a click names one building, the overlay opens
 * on it, and **closing commits**. Nothing is written while the view is open, so an abandoned overlay changes
 * nothing — which is why `onCommit` is the only path to a transaction here.
 */
import { useEffect, useMemo, useSyncExternalStore, type FC } from "react";

import {
  type BuilderModule,
  type MapClick,
  type MapService,
  type ModelData,
  type Module,
  type ModuleViewProps,
  type OverlayControl,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";

import { buildingConfigurator, type BuildingEdit } from "./view";

export { setBuildingConfigurator } from "./view";
export type { BuildingConfigurator, BuildingEdit, BuildingViewProps } from "./view";

const NODE = "building-configurator";

/**
 * The buildings layer's id.
 *
 * **A shared convention, and the answer to the spec's open decision:** a module names a layer *after the port*
 * it holds, so `grid-generation`'s buildings layer is `buildings` and not `grid-generation-buildings`. The
 * alternative — a `setInteractiveLayer(port)` form — would put a port⇄layer map inside the map service; this
 * keeps the service addressing ids and makes them predictable instead.
 */
const LAYER = "buildings";

// ── The pick and the pending edit. Shared across this module's regions, so it lives outside React: the module
//    renders once per region it declares, and a component-local store would be per-region.

interface Picked {
  osmId: string | null;
  /**
   * Edits the view returned, by building, waiting for the module's own Continue.
   *
   * Keyed by building rather than kept in a single slot: a user working through a grid would otherwise lose every
   * edit but the last, and the point of continuing deliberately is that they can configure several buildings
   * before committing any of them.
   */
  pending: ReadonlyMap<string, BuildingEdit>;
}

let picked: Picked = { osmId: null, pending: new Map() };
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Name the building the overlay is showing (or none), waking every region. */
function setPicked(osmId: string | null): void {
  picked = { ...picked, osmId };
  announce();
}

/** Hold what the view returned, for the module's Continue to commit.
 *
 *  Exported for the module's own surfaces — the panel and the isolation tests — exactly as the technologies
 *  module exports its `hold*` helpers. Nothing outside the module may use it. */
export function holdEdit(osmId: string, edit: BuildingEdit): void {
  const pending = new Map(picked.pending);
  pending.set(osmId, edit);
  picked = { ...picked, pending };
  announce();
}

/** Forget what is pending. The module's run calls this once the edits are committed. */
export function clearEdits(): void {
  picked = { ...picked, pending: new Map() };
  announce();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Picked {
  return picked;
}

function usePicked(): Picked {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The id a clicked or collected feature is keyed by — `osm_id`, then the GeoJSON id.
 *
 *  Structural on purpose: the map hands back its own `MapFeature`, which carries `properties` but is not a
 *  GeoJSON `Feature`, and the store hands back real ones. Both are read the same way. */
function idOf(
  feature: { properties?: Record<string, unknown> | null; id?: string | number } | undefined,
): string | null {
  const id = feature?.properties?.osm_id ?? feature?.id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The buildings to offer.
 *
 * A redrawn grid means the buildings the old edits described are gone, so this reads the *current* collection
 * every time rather than caching a list.
 */
function buildingsOf(data: Readonly<ModelData>): GeoJSON.Feature[] {
  const features = data.buildings?.features;
  return Array.isArray(features) ? features : [];
}

/**
 * Apply one building's edit to the store's ports.
 *
 * Both ports are rebuilt rather than mutated: the demand entries are merged per building — so a building the
 * user never opened keeps what it had — and `technologies` is replaced for the one building the view returned
 * them for. An empty list means "the user removed them all", which is a real answer and clears the entry
 * rather than storing an empty one.
 */
function applyEdit(
  data: Readonly<ModelData>,
  osmId: string,
  edit: BuildingEdit,
): {
  buildingParams: ModelData["buildingParams"];
  technologies: ModelData["technologies"] | undefined;
  buildings: ModelData["buildings"] | undefined;
} {
  // The envelope block rides on the feature rather than in a port: it describes the building's shape and
  // fabric, not the model's energy data. Handled first because it is the one edit that rewrites `buildings`.
  if (edit.buem !== undefined && data.buildings !== undefined) {
    const buildings: ModelData["buildings"] = {
      ...data.buildings,
      features: data.buildings.features.map((feature) =>
        idOf(feature) === osmId ? { ...feature, properties: { ...feature.properties, buem: edit.buem } } : feature,
      ),
    };
    const rest = applyEdit(data, osmId, { ...edit, buem: undefined });
    return { ...rest, buildings };
  }

  const base = data.buildingParams ?? {};
  const params: ModelData["buildingParams"] = {
    ...base,
    electricity: { ...(base.electricity ?? {}) },
    heat: { ...(base.heat ?? {}) },
  };

  if (edit.params !== undefined) {
    // Every building has an electricity entry; a heat entry is only merged where one already existed, since
    // inventing one here would claim a heat demand the demand step never found.
    params.electricity![osmId] = { ...(params.electricity?.[osmId] ?? {}), ...edit.params };
    if (params.heat?.[osmId] !== undefined) {
      params.heat[osmId] = { ...params.heat[osmId], ...edit.params };
    }
  }

  if (edit.technologies === undefined) {
    return { buildingParams: params, technologies: undefined, buildings: data.buildings };
  }

  const technologies: Record<string, NonNullable<ModelData["technologies"]>[string]> = {
    ...(data.technologies ?? {}),
  };
  if (edit.technologies.length === 0) delete technologies[osmId];
  else technologies[osmId] = edit.technologies;

  return { buildingParams: params, technologies, buildings: data.buildings };
}

/** The completeness this module owns (T22): every building must have *something* — demand or a technology. */
export function issuesFor(store: Readonly<ModelData>): ValidationIssue[] {
  for (const feature of buildingsOf(store)) {
    const id = idOf(feature);
    if (id === null) continue;
    const hasDemand = store.buildingParams?.electricity?.[id] !== undefined;
    const hasHeat = store.buildingParams?.heat?.[id] !== undefined;
    const hasTechs = (store.technologies?.[id] ?? []).length > 0;
    if (!hasDemand && !hasHeat && !hasTechs) {
      return [{ port: "buildingParams", message: "A building has neither demand nor technologies." }];
    }
  }
  return [];
}

const contract: Module = {
  id: NODE,
  // The grid, and whatever demand already exists — a baseline it may adopt rather than invent. Both ports it
  // writes are declared here too: the contract requires every port an `affect` output names be a declared port.
  params: [
    { port: "buildings", required: true },
    { port: "buildingParams" },
    { port: "technologies" },
  ],
  layout: ["map", "overlay", "sidebar", "bottom"],
  affect: {
    // A redrawn grid means the buildings the edits described are gone, so both outputs go with it.
    buildings: ["buildingParams", "technologies"],
    // It writes the pair together, so a demand change moves the technologies with it.
    buildingParams: ["technologies"],
  },
  /**
   * Commit every edit the view returned.
   *
   * The view is what collected them, and `holdEdit` is how they got here — so a run with nothing held is a no-op
   * rather than an error: the module is also reachable by the frame, and continuing without having opened a
   * building should do nothing rather than fail.
   */
  run: (ctx) => {
    if (picked.pending.size === 0) return;

    // Read what this write touches: the engine's anti-clobber requires the ports be read before they are
    // rewritten, and reading `buildings` is what tells a run against an empty store to do nothing rather than
    // commit a demand entry for a building that is not on the map.
    const buildings = ctx.read("buildings");
    if (buildings === undefined) return;

    let current: Readonly<ModelData> = {
      buildings,
      buildingParams: ctx.read("buildingParams"),
      technologies: ctx.read("technologies"),
    };

    // Every held edit folded in order, so several buildings commit as one transaction rather than one each.
    let touchedBuildings = false;
    for (const [osmId, edit] of picked.pending) {
      const next = applyEdit(current, osmId, edit);
      if (next.buildings !== undefined && next.buildings !== current.buildings) touchedBuildings = true;
      current = {
        buildings: next.buildings ?? current.buildings,
        buildingParams: next.buildingParams,
        technologies: next.technologies,
      };
    }

    ctx.commit({
      buildingParams: current.buildingParams,
      ...(current.technologies === undefined ? {} : { technologies: current.technologies }),
      // Only when an envelope block changed: committing `buildings` on every edit would rewrite a port this
      // module has no business touching otherwise.
      ...(touchedBuildings ? { buildings: current.buildings } : {}),
    });
    // Consumed: continuing again without another edit must not re-commit them.
    clearEdits();
  },
  validate: (ctx) => issuesFor(ctx.store),
};

// ── The regions. Each is its own component: the module renders once per declared region, and every one of
//    them needs hooks of its own.

/** Makes the buildings layer the one that accepts clicks, and opens the overlay on whatever was hit. */
const MapRegion: FC<{ map: MapService; overlay: OverlayControl }> = ({ map, overlay }) => {
  useEffect(() => {
    map.createLayer(LAYER);
    map.setInteractiveLayer(LAYER);

    const stop = map.onElementClick((click: MapClick) => {
      const id = idOf(click.feature);
      if (id === null) return;
      setPicked(id);
      overlay.open();
    });

    // Leaving the layer interactive on unmount would leave a later click opening nothing.
    return () => {
      stop();
      map.setInteractiveLayer(null);
    };
  }, [map, overlay]);

  return null;
};

/** Renders the installed view for the picked building; the edit is held and the overlay closes. */
const OverlayRegion: FC<{
  overlay: OverlayControl;
  data: Readonly<ModelData>;
}> = ({ overlay, data }) => {
  const state = usePicked();
  const configurator = buildingConfigurator();
  const osmId = state.osmId;

  const feature = useMemo(
    () => buildingsOf(data).find((candidate) => idOf(candidate) === osmId),
    [data, osmId],
  );

  // Memoised on the collections themselves: the view seeds a store from this, and a fresh object every render
  // would write that store on every render for no change.
  const grid = useMemo(
    () => ({
      ...(data.buildings === undefined ? {} : { buildings: data.buildings }),
      ...(data.lines === undefined ? {} : { lines: data.lines }),
      ...(data.mvLines === undefined ? {} : { mvLines: data.mvLines }),
      ...(data.transformers === undefined ? {} : { transformers: data.transformers }),
      ...(data.grids === undefined ? {} : { grids: data.grids }),
    }),
    [data.buildings, data.lines, data.mvLines, data.transformers, data.grids],
  );

  if (!overlay.isOpen || configurator === null || osmId === null || feature === undefined) return null;

  const { View } = configurator;

  return (
    <View
      osmId={osmId}
      feature={feature}
      params={data.buildingParams?.electricity?.[osmId] ?? data.buildingParams?.heat?.[osmId]}
      technologies={data.technologies?.[osmId]}
      draftId={data.draftId}
      // The whole grid, because the installed view resolves the building out of its own grid state rather than
      // out of `feature`. Handing it the grid is what keeps that a view's business and not a store's.
      grid={grid}
      onCommit={(edit) => {
        // Held until the module's Continue. Nothing is written while the view is open, so an abandoned overlay
        // still changes nothing — and several buildings can be configured before any of them commit.
        holdEdit(osmId, edit);
        overlay.close();
      }}
      onClose={() => overlay.close()}
    />
  );
};

/** The batch side: which buildings exist, and which of them have been configured. */
const SidebarRegion: FC<{ overlay: OverlayControl; data: Readonly<ModelData> }> = ({ overlay, data }) => {
  const { t } = useTranslation();
  const state = usePicked();
  const buildings = buildingsOf(data);

  const configured = useMemo(
    () =>
      buildings.filter((feature) => {
        const id = idOf(feature);
        if (id === null) return false;
        return (
          data.buildingParams?.electricity?.[id] !== undefined ||
          (data.technologies?.[id] ?? []).length > 0
        );
      }).length,
    [buildings, data],
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="text-sm font-medium">
        {t("modelBuilder.building-configurator.configured", "{{configured}} of {{total}} buildings configured", {
          configured,
          total: buildings.length,
        })}
      </div>
      <ul className="min-h-0 space-y-1 overflow-auto">
        {buildings.map((feature) => {
          const id = idOf(feature);
          if (id === null) return null;
          const done =
            data.buildingParams?.electricity?.[id] !== undefined ||
            (data.technologies?.[id] ?? []).length > 0;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(id);
                  overlay.open();
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2 py-1 text-left text-xs hover:bg-muted ${
                  state.osmId === id ? "bg-muted" : ""
                }`}
              >
                <span className="truncate font-mono">{id}</span>
                <span className={done ? "text-muted-foreground" : "text-foreground"}>
                  {done ? "✓" : "·"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** The hint that makes the click discoverable — there is no button that could act before a pick. */
const BottomRegion: FC<{
  run: () => Promise<void>;
  pending: number;
  issues: readonly ValidationIssue[];
}> = ({ run, pending, issues }) => {
  const { t } = useTranslation();
  const ready = issues.length === 0;
  return (
    <div className="flex h-full items-center justify-between gap-3 bg-muted/40 px-3">
      <span className="text-xs text-muted-foreground">
        {pending > 0
          ? t(
              "modelBuilder.building-configurator.edited",
              "{{count}} building(s) edited, not yet committed",
              { count: pending },
            )
          : ready
            ? t("modelBuilder.building-configurator.hint", "Click a building on the map to configure it in detail.")
            : // A disabled button has to say what it is waiting for, or pressing it reads as broken — which is
              // exactly how it read. The gate's own message is the honest one.
              issues[0]?.message}
      </span>
      <button
        type="button"
        onClick={() => void run()}
        disabled={!ready}
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("modelBuilder.building-configurator.continue", "Continue")}
      </button>
    </div>
  );
};

const Component: FC<ModuleViewProps> = ({ region, data, run, map, overlay }) => {
  // Subscribed in every region so the bottom bar's count keeps up with edits made in the overlay.
  const state = usePicked();

  if (region === "map" && map !== undefined && overlay !== undefined) {
    return <MapRegion map={map} overlay={overlay} />;
  }
  if (region === "overlay" && overlay !== undefined) {
    return <OverlayRegion overlay={overlay} data={data} />;
  }
  if (region === "sidebar" && overlay !== undefined) {
    return <SidebarRegion overlay={overlay} data={data} />;
  }
  if (region === "bottom") {
    return <BottomRegion run={run} pending={state.pending.size} issues={issuesFor(data)} />;
  }
  return null;
};

/**
 * What the frame loads.
 *
 * The `mock` is not decoration: the contract check **fails a module that cannot state the inputs it needs**,
 * because such a module cannot be developed or tested on its own. This is the one place the buildings come from
 * without a grid having produced them.
 */
export const buildingConfiguratorModule: BuilderModule = {
  module: contract,
  Component,
  mock: {
    buildings: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { osm_id: "b1", building_type: "residential", area_m2: 120 },
          geometry: { type: "Point", coordinates: [8.6, 49.4] },
        },
      ],
    },
    buildingParams: {
      electricity: { b1: { fClass: "residential", yearlyKwh: 12_000, peakKw: 4 } },
    },
  },
};

export default buildingConfiguratorModule;
