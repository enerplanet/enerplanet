/**
 * `grid-generation` — the synthetic grid, from the drawn area.
 *
 * Requires the area (`area-draw`) and the region (`model-start`); produces the **whole** grid: buildings,
 * transformers, low-voltage cables, medium-voltage cables and the grid ids. Like `area-draw` it is a step with
 * a provider behind it: `engine.ts` declares the slot, `shell/gridEngine.ts` is the pylovo implementation the
 * frame installs, and this file never learns which one it has.
 *
 * Two things about it are worth reading before copying it:
 *
 * **Five ports, one transaction.** `seal` stays at its `at-completion` default, so the grid arrives whole or
 * not at all — nothing can observe buildings whose cables were never written. A module whose ports are
 * independent should say `per-commit` instead (see `modules/examples/interactive/index.tsx`).
 *
 * **The engine is injected, not imported.** A module may only depend on `@model-builder/core`, and the app's
 * CSRF-aware axios instance is the app's — so the frame hands the engine in at startup (`setGridEngine`). That
 * is also what makes this module testable without a backend: a test supplies its own engine.
 *
 * The regions are `map` (the grid on the map), `sidebar` (generate, and the data-loss warning it needs) and
 * `bottom` (the counts). The map work is guarded to the `map` region for the reason `modules/README.md` calls
 * *a module renders once per region* — the module renders once per declared region, and two instances writing
 * one layer would take turns clearing each other's work.
 */

import { useEffect, useMemo } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type PortKey,
  type RegionRef,
  type LayerExtrusion,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import type { GridEngine } from "./engine";

export type { GridEngine, GridRequest, GridResult } from "./engine";

/** Everything this module produces, in one place — the ports, the `affect` claim and the UI read from it. */
const PRODUCED = ["buildings", "transformers", "lines", "mvLines", "grids"] as const;
type ProducedPort = (typeof PRODUCED)[number];

/** The layers the grid goes on. **Each is named after the port it holds** — the shared convention a module
 *  relies on when it needs a layer it does not own (the building configurator subscribes to clicks on
 *  `buildings`). The grid ids are a list, not geometry, so they have no layer at all.
 *
 *  Ordered **bottom to top as written** (`setLayerOrder` below uses this order): buildings, then the cables,
 *  then the transformers last so they read on top of the network they serve. */
const LAYERS: Readonly<Record<ProducedPort, string | null>> = {
  buildings: "buildings",
  lines: "lines",
  mvLines: "mvLines",
  transformers: "transformers",
  grids: null,
};

/**
 * The buildings are the ones in hand: they are inside the drawn area, and the rest of the city is not. So they
 * stand up in the highlight blue while the basemap's own buildings stay a ghost beneath them.
 *
 * Every one gets the same height. The building levels come from a separate backend call and are not on these
 * features, and for saying "these are the buildings in play" a uniform volume does the job.
 */
const BUILDINGS_EXTRUSION: LayerExtrusion = { fallback: 8, color: "#3b82f6" };

/**
 * The engine the frame installs.
 *
 * Module-level rather than per-render, for the same reason `hold()` is: it belongs to the module, not to one
 * region's render. Until a host sets it, a run fails loudly rather than reaching for a backend on its own —
 * which is what lets this module be tested, and reused, without EnerPlanET's HTTP stack behind it.
 */
let engine: GridEngine | null = null;

/** Install the grid engine. The frame calls this once, at startup (`shell/gridEngine.ts`). */
export function setGridEngine(next: GridEngine): void {
  engine = next;
}

/** A grid needs somewhere to be generated in, something to generate from — and a result worth keeping. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (projection.coordinates === undefined) {
    issues.push({ port: "coordinates", message: "Draw an area before generating a grid." });
  }
  if (projection.region === undefined) {
    issues.push({ port: "region", message: "Choose the region the model sits in." });
  }

  // The result, not only the inputs — this is the half of the completeness rule the module owns. An
  // area can legitimately yield no buildings, and an empty FeatureCollection is a fact the store is allowed
  // to hold; what this module may not do is call that a *finished* grid, because everything downstream
  // builds on buildings that are not there. Reported rather than thrown on purpose: the empty grid stays
  // visible on the map, the reason is on screen, and the node never reads as done — so the flow rests here
  // instead of walking on to demand and technologies.
  if (projection.buildings !== undefined && projection.buildings.features.length === 0) {
    issues.push({ port: "buildings", message: "The area yielded no buildings — nothing to model." });
  }

  return issues;
}

/**
 * H — the whole layer order, with ours on top.
 *
 * Another module's layer can be on the map at the same time (area-draw's is, until it unmounts), and
 * `setLayerOrder` requires every layer named exactly once — so a list of *only* our own throws while any
 * other module is mounted and the draw never lands. Keeping what is already there is what the contract means
 * by handing back `getLayerOrder`, reordered.
 */
export function layerOrderFor(current: readonly string[]): string[] {
  const mine = Object.values(LAYERS).filter((layer): layer is string => layer !== null);
  return [...current.filter((layer) => !mine.includes(layer)), ...mine];
}

const module = defineModule({
  id: "grid-generation",
  name: "Grid generation",

  // Exactly what `run()` writes, plus the two things it needs. Nothing declared "just in case": an undeclared
  // write is rejected, and `required` is what the flow gate reasons about before the node may run at all.
  params: [
    { port: "coordinates", required: true },
    { port: "region", required: true },
    { port: "buildings" },
    { port: "transformers" },
    { port: "lines" },
    { port: "mvLines" },
    { port: "grids" },
  ],

  // The broad invalidation, declared honestly: redrawing the area or moving the model to another region
  // means the *entire* grid is gone, not part of it. A narrower claim here would let stale demand survive a
  // redraw — and the influence prober (`core/influence.ts`) would fail this module for understating it anyway.
  affect: {
    coordinates: [...PRODUCED],
    region: [...PRODUCED],
  },

  // One sealed transaction for the whole run: five ports that only make sense together.
  seal: "at-completion",

  // Automatic: the frame runs it on arrival, and the walk runs it again when its ports go stale — which the
  // `affect` edges above limit to a redrawn area or a different region. Regenerating an *unchanged* area
  // re-derives the same grid, so no transaction is sealed and nothing downstream is discarded. That is what
  // makes asking unnecessary: the only re-run is a real change, and a real change is meant to replace the grid.
  auto: true,

  // No `sidebar` and no `overlay`. There is nothing to press, so nothing wants a bar to press it from — and an
  // auto node's overlay slot is force-opened, which for a node that *draws* would mean a scrim over its own grid.
  layout: ["map", "bottom"],

  run: async (ctx: ModuleCtx) => {
    if (engine === null) {
      throw new Error(
        "grid-generation has no engine: a host installs one with setGridEngine() (shell/gridEngine.ts)",
      );
    }

    const coordinates = ctx.read("coordinates");
    const region = ctx.read("region");

    if (coordinates === undefined || region === undefined) {
      throw new Error("grid-generation needs a drawn area and a region before it can generate");
    }

    const grid = await engine.generate({ coordinates, region });

    // Read before write — the anti-clobber rule — so regenerating a grid the store already holds is a licence
    // this module earns by looking, not a blind overwrite. The engine either returns a whole grid or throws, so
    // there is no partial result to represent here.
    for (const port of PRODUCED) ctx.read(port);

    ctx.commit({
      buildings: grid.buildings,
      transformers: grid.transformers,
      lines: grid.lines,
      mvLines: grid.mvLines,
      grids: grid.grids,
    });
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

/** How many features a collection holds; `undefined` reads as none. */
function featureCount(collection: GeoJSON.FeatureCollection | undefined): number {
  return collection?.features.length ?? 0;
}

/** The map control as a module sees it. */
type MapControl = NonNullable<ModuleViewProps["map"]>;

/**
 * The slice of the map the draw actually uses. Narrow on purpose: a `MapStack` satisfies it, so the draw can be
 * run against the real layer bookkeeping in a test instead of a mock of it.
 */
type GridMap = Pick<
  MapControl,
  "createLayer" | "clearLayer" | "addFeatures" | "getLayerOrder" | "setLayerOrder"
>;

/** The four collections that reach the map, gathered in one object so the draw names what it draws. */
type Collections = Partial<Record<ProducedPort, GeoJSON.FeatureCollection | undefined>>;

/**
 * Put the four collections on the map.
 *
 * Its own function, and taking the map control rather than reaching for one, so the draw can be run against a
 * real `MapStack` in a test — the map control is a pure interface, and this was otherwise the one piece of this
 * module that nothing could check. It is also what keeps the effect's dependencies honest: it names exactly what
 * it draws.
 */
export function drawGrid(map: GridMap, collections: Collections): void {
  const mine = Object.values(LAYERS).filter((layer): layer is string => layer !== null);

  // Every layer first, then the features. Creating one and filling it before the next exists leaves the map
  // mid-draw: each `createLayer` and `addFeatures` redraws, and a redraw taken while the grid is only half
  // declared draws the part of it that exists — which is why the buildings appeared and the cables did not.
  for (const layer of mine) {
    map.createLayer(layer, layer === LAYERS.buildings ? { extrusion: BUILDINGS_EXTRUSION } : undefined);
    map.clearLayer(layer);
  }

  for (const [port, layer] of Object.entries(LAYERS) as [ProducedPort, string | null][]) {
    if (layer === null) continue;
    const collection = collections[port];
    if (collection !== undefined && collection.features.length > 0) {
      map.addFeatures(layer, collection);
    }
  }

  // Bottom-to-top: buildings under cables under transformers, so the network reads correctly. Ours go last,
  // and whatever else is on the map keeps its place beneath them.
  map.setLayerOrder(layerOrderFor(map.getLayerOrder()));
}

const Component: React.FC<ModuleViewProps> = ({ region, data, map }) => {
  const { t } = useTranslation();
  const missing = issuesFor(data);
  const hasGrid = PRODUCED.some((port) => data[port] !== undefined);

  /**
   * The four collections that actually get drawn, gathered here so the layer effect depends on *what it draws*
   * rather than on the whole projection. `grids` is a list, not geometry, so it is not among them.
   */
  const collections = useMemo(
    () =>
      ({
        buildings: data.buildings,
        transformers: data.transformers,
        lines: data.lines,
        mvLines: data.mvLines,
      }) as Partial<Record<ProducedPort, GeoJSON.FeatureCollection | undefined>>,
    [data.buildings, data.transformers, data.lines, data.mvLines],
  );

  /**
   * The grid on the map. **Only the `map` region does this**: the module renders once per declared region, and
   * two instances writing one layer would take turns clearing each other's work.
   *
   * Nothing takes these layers off again. This module used to remove them on unmount, which erased the grid the
   * moment the session left the node — and the session leaves the instant a run lands, because the position is
   * the first node that is not done. The only way to see a freshly generated grid was to come back to an
   * already-done node, where nothing advances and nothing unmounts; that confirm-then-replace worked while
   * Generate alone did not was the tell, since it re-runs a node that is already done.
   *
   * The stack is the host's, and a module draws what it owns onto it. Leaving it standing is also what lets the
   * nodes after this one — the building configurator's clicks especially — see the grid they are about.
   */
  useEffect(() => {
    if (region !== "map" || map === undefined) return;
    drawGrid(map, collections);
  }, [region, map, collections]);

  // ── bottom: the counts. Intrinsic height on purpose — its box is a cap, not a quota.
  if (region === "bottom") {
    // What it is waiting for, in the gate's own words — the same courtesy a disabled button gets.
    if (missing.length > 0) {
      return <p className="text-sm text-muted-foreground">{missing[0]?.message}</p>;
    }

    if (!hasGrid) {
      return (
        <p className="text-sm text-muted-foreground">
          {t("modelBuilder.grid-generation.bottom.none", "No grid yet.")}
        </p>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {(
          [
            ["buildings", t("modelBuilder.grid-generation.bottom.buildings", "buildings")],
            ["transformers", t("modelBuilder.grid-generation.bottom.transformers", "transformers")],
            ["lines", t("modelBuilder.grid-generation.bottom.cables", "cables")],
            ["mvLines", t("modelBuilder.grid-generation.bottom.mvCables", "MV cables")],
          ] as [ProducedPort, string][]
        ).map(([port, label]) => (
          <span key={port} className="flex items-baseline gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{label}</span>
            <span className="text-foreground">
              {featureCount(data[port] as GeoJSON.FeatureCollection | undefined)}
            </span>
          </span>
        ))}
      </div>
    );
  }

  // ── map: a legend, over the grid it describes. The map work is the effect above; this is the only thing the
  //    region has to *render*, and it opts back into pointer events so the legend stays readable.
  if (region === "map") {
    return (
      <div className="pointer-events-auto flex max-h-full max-w-xs flex-col gap-2 overflow-auto rounded-lg border border-border bg-card/95 p-4 shadow-sm">
        <h3 className="shrink-0 text-base font-semibold">
          {t("modelBuilder.grid-generation.map.title", "The grid")}
        </h3>
        {hasGrid ? (
          <ul className="shrink-0 space-y-1 text-sm">
            {(
              [
                ["buildings", t("modelBuilder.grid-generation.bottom.buildings", "buildings")],
                ["transformers", t("modelBuilder.grid-generation.bottom.transformers", "transformers")],
                ["lines", t("modelBuilder.grid-generation.bottom.cables", "cables")],
                ["mvLines", t("modelBuilder.grid-generation.bottom.mvCables", "MV cables")],
              ] as [ProducedPort, string][]
            ).map(([port, label]) => (
              <li key={port} className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span>{featureCount(data[port] as GeoJSON.FeatureCollection | undefined)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="shrink-0 text-sm text-muted-foreground">
            {t("modelBuilder.grid-generation.map.empty", "Generate a grid to see it here.")}
          </p>
        )}
      </div>
    );
  }

  // Nothing is left for a region this module does not declare: `map` and `bottom` are the whole of it.
  return null;
};

const builderModule: BuilderModule = {
  module,
  Component,
  // What the module needs to do its work in isolation — the seed of a host's scratch store. Both are required
  // ports, so the contract check insists on them being here.
  mock: {
    region: { country: "DE", state: "BW" } satisfies RegionRef,
    coordinates: [
      [
        [8.50, 49.30],
        [8.51, 49.30],
        [8.51, 49.31],
        [8.50, 49.31],
        [8.50, 49.30],
      ],
    ],
  },
};

/** The ports this module declares, for the module's own tests and any host that needs to list them. */
export const declaredPorts: readonly PortKey[] = module.params.map((param) => param.port);

export default builderModule;
