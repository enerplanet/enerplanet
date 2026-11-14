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
 * independent should say `per-commit` instead (see `modules/example/index.tsx`).
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

import { useEffect, useMemo, useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type PortKey,
  type RegionRef,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import type { GridEngine } from "./engine";

export type { GridEngine, GridRequest, GridResult } from "./engine";

/** Everything this module produces, in one place — the ports, the `affect` claim and the UI read from it. */
const PRODUCED = ["buildings", "transformers", "lines", "mvLines", "grids"] as const;
type ProducedPort = (typeof PRODUCED)[number];

/** The layers the grid goes on. The module names them; nothing else has to agree on the ids. */
const LAYERS: Readonly<Record<ProducedPort, string | null>> = {
  buildings: "grid-generation-buildings",
  transformers: "grid-generation-transformers",
  lines: "grid-generation-cables",
  mvLines: "grid-generation-mv-cables",
  // The grid ids are a list, not geometry — there is nothing to draw for them.
  grids: null,
};

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

/** A grid needs somewhere to be generated in, and something to generate from. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (projection.coordinates === undefined) {
    issues.push({ port: "coordinates", message: "Draw an area before generating a grid." });
  }
  if (projection.region === undefined) {
    issues.push({ port: "region", message: "Choose the region the model sits in." });
  }
  return issues;
}

/**
 * Would generating throw away work?
 *
 * Two losses, and the second is the one a user cannot see from the button: replacing the grid itself, and
 * invalidating everything built on it — the demand parameters and technology assignments downstream. The
 * cascade the spec describes is exactly this, so the warning names it.
 */
export function needsConfirmation(data: Readonly<ModelData>): boolean {
  const hasGrid = PRODUCED.some((port) => data[port] !== undefined);
  const hasDerivedWork = data.technologies !== undefined || data.buildingParams !== undefined;

  return hasGrid || hasDerivedWork;
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

  // The spec's broad invalidation, declared honestly: redrawing the area or moving the model to another region
  // means the *entire* grid is gone, not part of it. A narrower claim here would let stale demand survive a
  // redraw — and the influence prober (`core/influence.ts`) would fail this module for understating it anyway.
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

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  // The first click only warns; the second goes through. Reset whenever the store moves under us.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // A node change means whatever this module was about to say no longer applies here — including a warning
  // the user has not answered yet.
  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [nodeId]);

  // The grid on the map. **Only the `map` region does this**: the module renders once per declared region, and
  // two instances writing one layer would take turns clearing each other's work. The layer styles are the
  // provider's for now — a module cannot restyle what it draws yet (`modules/README.md`).
  useEffect(() => {
    if (region !== "map" || map === undefined) return;

    for (const [port, layer] of Object.entries(LAYERS) as [ProducedPort, string | null][]) {
      if (layer === null) continue;
      map.createLayer(layer);
      map.clearLayer(layer);

      const collection = collections[port];
      if (collection !== undefined && collection.features.length > 0) {
        map.addFeatures(layer, collection);
      }
    }

    // Bottom-to-top: buildings under cables under transformers, so the network reads correctly.
    map.setLayerOrder([
      ...Object.values(LAYERS).filter((layer): layer is string => layer !== null),
    ]);
  }, [region, map, collections]);

  /** The layer is this module's, so this module takes it off when it leaves. */
  useEffect(() => {
    if (region !== "map" || map === undefined) return undefined;
    return () => {
      for (const layer of Object.values(LAYERS)) {
        if (layer !== null) map.removeLayer(layer);
      }
    };
  }, [region, map]);

  const generate = (): void => {
    if (missing.length > 0 || generating) return;
    // The data-loss step: a store that would lose work needs the question asked first, and the button says
    // what it will do rather than repeating itself.
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

  // ── sidebar: generate, and the data-loss warning. The area must already exist — this module has nothing to
  //    offer without it, so it says so instead of offering a button that cannot work.
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
