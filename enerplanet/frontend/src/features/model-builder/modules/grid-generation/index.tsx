/**
 * `grid-generation` — the synthetic grid, from the drawn area.
 *
 * Requires the area (`area-draw`) and the region (`model-start`); produces buildings, transformers, lines,
 * mvLines and grids. The engine is injected at startup (`setGridEngine`), never imported. Regions: `map`,
 * `sidebar`, `bottom`.
 */

import { useEffect, useMemo, useState } from "react";
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

/** The layers the grid goes on, each named after the port it holds; ordered bottom to top as written. `grids` is a list, not geometry. */
const LAYERS: Readonly<Record<ProducedPort, string | null>> = {
  buildings: "buildings",
  lines: "lines",
  mvLines: "mvLines",
  transformers: "transformers",
  grids: null,
};

/** The buildings in play stand up in the highlight blue, all at a uniform height. */
const BUILDINGS_EXTRUSION: LayerExtrusion = { fallback: 8, color: "#3b82f6" };

/** The engine the frame installs. Module-level so a host sets it once; a run without one fails loudly. */
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

  // The result, not only the inputs: an empty grid is a fact the store may hold, but not a finished one.
  if (projection.buildings !== undefined && projection.buildings.features.length === 0) {
    issues.push({ port: "buildings", message: "The area yielded no buildings — nothing to model." });
  }

  return issues;
}

/** Whether generating would throw away work: replacing the grid, and the demand/technology work built on it. */
export function needsConfirmation(data: Readonly<ModelData>): boolean {
  const hasGrid = PRODUCED.some((port) => data[port] !== undefined);
  const hasDerivedWork = data.technologies !== undefined || data.buildingParams !== undefined;

  return hasGrid || hasDerivedWork;
}

/** The whole layer order with ours on top — a list of only our layers throws while another module's is mounted. */
export function layerOrderFor(current: readonly string[]): string[] {
  const mine = Object.values(LAYERS).filter((layer): layer is string => layer !== null);
  return [...current.filter((layer) => !mine.includes(layer)), ...mine];
}

const module = defineModule({
  id: "grid-generation",
  name: "Grid generation",

  // Exactly what `run()` writes, plus the two things it needs; `required` gates the node before it may run.
  params: [
    { port: "coordinates", required: true },
    { port: "region", required: true },
    { port: "buildings" },
    { port: "transformers" },
    { port: "lines" },
    { port: "mvLines" },
    { port: "grids" },
  ],

  // The broad invalidation, declared honestly: redrawing the area or moving region loses the whole grid.
  affect: {
    coordinates: [...PRODUCED],
    region: [...PRODUCED],
  },

  // One sealed transaction for the whole run: five ports that only make sense together.
  seal: "at-completion",

  layout: ["map", "sidebar", "bottom"],

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

    // Read before write (anti-clobber); the engine returns a whole grid or throws, so there is no partial result.
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

/** The slice of the map the draw uses — narrow, so the draw can run against a real `MapStack` in a test. */
type GridMap = Pick<
  MapControl,
  "createLayer" | "clearLayer" | "addFeatures" | "getLayerOrder" | "setLayerOrder"
>;

/** The four collections that reach the map, gathered in one object so the draw names what it draws. */
type Collections = Partial<Record<ProducedPort, GeoJSON.FeatureCollection | undefined>>;

/** Put the four collections on the map. Its own function taking the map control, so a test can run it. */
export function drawGrid(map: GridMap, collections: Collections): void {
  const mine = Object.values(LAYERS).filter((layer): layer is string => layer !== null);

  // Every layer first, then the features: a redraw mid-draw would paint only the part of the grid declared so far.
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

  // Bottom-to-top: buildings under cables under transformers; ours go last, other layers keep their place beneath.
  map.setLayerOrder(layerOrderFor(map.getLayerOrder()));
}

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  // The first click only warns; the second goes through. Reset whenever the store moves under us.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = issuesFor(data);
  const hasGrid = PRODUCED.some((port) => data[port] !== undefined);

  /** The four collections that actually get drawn, so the layer effect depends on what it draws. `grids` is not geometry. */
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

  // A node change means whatever this module was about to say no longer applies here.
  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [nodeId]);

  /**
   * The grid on the map. Only the `map` region does this (the module renders once per declared region).
   * Nothing removes these layers: the stack is the host's, and the nodes after this one need to see the grid.
   */
  useEffect(() => {
    if (region !== "map" || map === undefined) return;
    drawGrid(map, collections);
  }, [region, map, collections]);

  const generate = (): void => {
    if (missing.length > 0 || generating) return;
    // The data-loss step: ask first, and the button says what it will do rather than repeating itself.
    if (needsConfirmation(data) && !confirming) {
      setConfirming(true);
      return;
    }

    setConfirming(false);
    setError(null);
    setGenerating(true);
    void run()
      .catch((thrown: unknown) => {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      })
      .finally(() => setGenerating(false));
  };

  // ── bottom: the counts. Intrinsic height on purpose — its box is a cap, not a quota.
  if (region === "bottom") {
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

  // ── map: a legend over the grid; the map work is the effect above, and the legend opts back into pointer events.
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

  // ── sidebar: generate, and the data-loss warning. The area must already exist.
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.grid-generation.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modelBuilder.grid-generation.description")}
        </p>
      </div>

      {missing.length > 0 && (
        <ul className="shrink-0 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {missing.map((issue) => (
            <li key={issue.port}>{issue.message}</li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="shrink-0 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {t("modelBuilder.grid-generation.failed", "The grid could not be generated: {{reason}}", {
            reason: error,
          })}
        </p>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={missing.length > 0 || generating}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {generating
          ? t("modelBuilder.grid-generation.generating", "Generating…")
          : confirming
            ? t("modelBuilder.grid-generation.lossConfirm", "Replace it anyway")
            : hasGrid
              ? t("modelBuilder.grid-generation.regenerate", "Regenerate grid")
              : t("modelBuilder.grid-generation.generate", "Generate grid")}
      </button>

      {confirming && (
        <p className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {t(
            "modelBuilder.grid-generation.loss",
            "Generating again replaces this grid and discards the demand and technology work built on it.",
          )}
        </p>
      )}
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // What the module needs in isolation — the seed of a host's scratch store; both are required ports.
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
