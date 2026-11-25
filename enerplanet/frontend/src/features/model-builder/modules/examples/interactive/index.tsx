/**
 * The example module — a working example, and the template to copy.
 *
 * Not a step of any workflow. Declares all four slots (`sidebar`, `map`, `bottom`, `overlay`), one UI per
 * region. Scaffold a new module from it: `node src/features/model-builder/scripts/new-module.mjs <id> "label"`.
 */

import { useEffect, useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type PortKey,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";

/** One ring of positions, in the store's coordinate shape. */
type Ring = [number, number][];

/** The resolutions a building model is usually drawn at, in minutes. */
const RESOLUTIONS = [1, 5, 15, 30, 60] as const;

/** The layer this module puts its ring on — the module names it, which is how the service works. */
const AREA_LAYER = "example-area";

/** The module's own model: values its regions have collected, keyed by the node they were collected for. */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/** Hold values for `nodeId`, dropping anything held for a different node; the only way a region hands values to `run()`. */
export function hold(nodeId: string, values: Partial<ModelData> = {}): void {
  if (held.nodeId !== nodeId) {
    held.values = {};
    held.nodeId = nodeId;
  }
  Object.assign(held.values, values);
}

/** Take what is held and leave nothing behind: a hold describes one gesture, not a pending state. */
function takeHeld(): Partial<ModelData> {
  const values = held.values;
  held.values = {};
  held.nodeId = null;
  return values;
}

/** The model needs a name — asked of any projection, so `validate()` and the review panel agree. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const name = projection.modelName;

  if (name === undefined || name.trim().length === 0) {
    return [{ port: "modelName", message: "The model needs a name." }];
  }
  return [];
}

/** How a port's value reads in the UI — arrays summarised, because a ring printed in full is unreadable. */
function describeValue(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) {
    const rings = value as Ring[];
    const points = rings.reduce((total, ring) => total + ring.length, 0);
    return `${rings.length}×${points}`;
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

const module = defineModule({
  id: "example-interactive",
  name: "Example interactive module",

  // The module's whole store surface — exactly what `run()` writes, nothing declared "just in case".
  params: [
    { port: "modelName" },
    { port: "resolution", required: true },
    { port: "coordinates" },
  ],

  // Declared influence: this module is not placed in a workflow and nothing reads another port, so `{}` is honest.
  affect: {},

  // `per-commit` seals one atomic transaction per `commit()`; the default `at-completion` seals one per `run()`.
  seal: "per-commit",

  // Every slot the frame offers. A module that declares nothing is headless — that is how an `auto` node renders nothing.
  layout: ["sidebar", "map", "bottom", "overlay"],

  run: (ctx) => {
    const collected = takeHeld();
    const proposed: Partial<ModelData> = {};

    // Read before you write, and commit only what changed; committing nothing still seals a zero-diff run.
    if (collected.modelName !== undefined) {
      const current = ctx.read("modelName");
      const trimmed = collected.modelName.trim();
      const name = trimmed.length > 0 ? trimmed : "Untitled model";
      if (name !== current) proposed.modelName = name;
    }

    if (collected.resolution !== undefined) {
      const current = ctx.read("resolution");
      if (collected.resolution !== current) proposed.resolution = collected.resolution;
    }

    if (collected.coordinates !== undefined) {
      const current = ctx.read("coordinates");
      if (collected.coordinates !== current) proposed.coordinates = collected.coordinates;
    }

    ctx.commit(proposed);
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

/** The ports this module declares, for the status strip and the review — derived from `params`, never copied. */
const PORTS: readonly PortKey[] = module.params.map((param) => param.port);

/** Which of them the flow would insist on before letting the node run. */
const REQUIRED = new Set(
  module.params.filter((param) => param.required === true).map((param) => param.port),
);

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map, overlay }) => {
  const { t } = useTranslation();
  // What the user has collected since the last commit. Local on purpose: it is not state worth keeping.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedResolution, setTypedResolution] = useState<number | null>(null);
  const [points, setPoints] = useState<Ring>([]);

  // A node change drops the held values and clears what was collected locally; the layer goes with it (`removeLayer` is idempotent).
  useEffect(() => {
    map?.removeLayer(AREA_LAYER);
    hold(nodeId, {});
    setTypedName(null);
    setTypedResolution(null);
    setPoints([]);
  }, [nodeId, map]);

  // ── bottom: module status. Intrinsic height on purpose — its box is a cap; each port says whether the store holds it.
  if (region === "bottom") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        {PORTS.map((port) => (
          <span key={port} className="flex items-baseline gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{port}</span>
            {data[port] === undefined ? (
              <span className="text-amber-600 dark:text-amber-400">
                {t("modelBuilder.example-interactive.bottom.notSet")}
              </span>
            ) : (
              <span className="text-foreground">{describeValue(data[port])}</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  // ── map: draw the area locally, then put it on the map. What gets committed is the ring.
  if (region === "map") {
    const addPoint = (event: React.MouseEvent<SVGSVGElement>): void => {
      const box = event.currentTarget.getBoundingClientRect();
      setPoints((current) => [
        ...current,
        [((event.clientX - box.left) / box.width) * 100, ((event.clientY - box.top) / box.height) * 100],
      ]);
    };

    /** The drawing is in a 100×100 box; a real area wants degrees, so it maps onto a small window. */
    const asRing = (): Ring =>
      points.map(([x, y]) => [8.5 + (x / 100) * 0.2, 49.3 + (y / 100) * 0.2] as [number, number]);

    const commitRing = (): void => {
      const ring = asRing();
      const area = { type: "Polygon" as const, coordinates: [ring] };

      hold(nodeId, { coordinates: [ring] });

      // Four separate calls, the shape of the service: name a layer, empty it, put the geometry on it, make it interactive.
      map?.createLayer(AREA_LAYER);
      map?.clearLayer(AREA_LAYER);
      map?.addFeatures(AREA_LAYER, area);
      map?.setInteractiveLayer(AREA_LAYER);
      map?.fitTo(area);

      void run().finally(() => setPoints([]));
    };

    const clear = (): void => {
      setPoints([]);
      map?.clearLayer(AREA_LAYER);
    };

    return (
      // A floating card over the real map: it takes only the space it needs and opts back into pointer events.
      <div className="pointer-events-auto flex max-h-full max-w-md flex-col gap-3 overflow-auto rounded-lg border border-border bg-card/95 p-4 shadow-sm">
        <h3 className="shrink-0 text-base font-semibold">{t("modelBuilder.example-interactive.map.title")}</h3>
        <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.example-interactive.map.hint")}</p>

        <svg
          viewBox="0 0 100 100"
          onClick={addPoint}
          role="presentation"
          className="h-40 w-full shrink-0 cursor-crosshair rounded-lg border border-border bg-background"
        >
          {points.length > 1 && (
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              className="fill-primary/10 stroke-primary"
              strokeWidth={1}
            />
          )}
          {points.map(([x, y], index) => (
            <circle key={index} cx={x} cy={y} r={1.5} className="fill-primary" />
          ))}
        </svg>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={commitRing}
            disabled={points.length < 3}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("modelBuilder.example-interactive.map.useRing")}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={points.length === 0}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("modelBuilder.example-interactive.map.clear")}
          </button>
          <span className="text-xs text-muted-foreground">
            {t("modelBuilder.example-interactive.map.points", "{{count}} points", { count: points.length })}
          </span>
        </div>
      </div>
    );
  }

  // ── overlay: the review. The store read the way a modeller would want to check it, plus what is missing.
  if (region === "overlay") {
    const issues = issuesFor(data);
    const rings = (data.coordinates ?? []) as Ring[];
    const drawnPoints = rings.reduce((total, ring) => total + ring.length, 0);

    return (
      <div className="flex h-full flex-col gap-4 overflow-auto">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{t("modelBuilder.example-interactive.overlay.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("modelBuilder.example-interactive.overlay.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => overlay?.close()}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("modelBuilder.example-interactive.overlay.close")}
          </button>
        </div>

        <dl className="shrink-0 space-y-1 text-sm">
          {PORTS.map((port) => (
            <div
              key={port}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1"
            >
              <dt className="flex items-baseline gap-1.5 font-mono text-xs text-muted-foreground">
                {port}
                {REQUIRED.has(port) && (
                  <span className="rounded bg-muted px-1 text-[0.65rem] uppercase">
                    {t("modelBuilder.example-interactive.overlay.required")}
                  </span>
                )}
              </dt>
              <dd className={data[port] === undefined ? "text-amber-600 dark:text-amber-400" : ""}>
                {data[port] === undefined
                  ? t("modelBuilder.example-interactive.bottom.notSet")
                  : describeValue(data[port])}
              </dd>
            </div>
          ))}
        </dl>

        <p className="shrink-0 text-sm">
          <span className="text-muted-foreground">{t("modelBuilder.example-interactive.overlay.area")}: </span>
          {drawnPoints === 0
            ? t("modelBuilder.example-interactive.overlay.areaNone")
            : t("modelBuilder.example-interactive.overlay.areaDrawn", "{{rings}} ring(s), {{points}} point(s)", {
                rings: rings.length,
                points: drawnPoints,
              })}
        </p>

        {issues.length === 0 ? (
          <p className="shrink-0 text-sm text-emerald-600 dark:text-emerald-400">
            {t("modelBuilder.example-interactive.overlay.complete")}
          </p>
        ) : (
          <ul className="shrink-0 space-y-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue.message}>
                {t("modelBuilder.example-interactive.overlay.issue", "{{port}}: {{message}}", {
                  port: String(issue.port ?? "—"),
                  message: issue.message,
                })}
              </li>
            ))}
          </ul>
        )}

        <p className="shrink-0 text-xs text-muted-foreground">
          {t("modelBuilder.example-interactive.overlay.shellHint")}
        </p>
      </div>
    );
  }

  // ── sidebar: the model form. Both fields go in one gesture, and the button asks `run()` for both at once.
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.example-interactive.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.example-interactive.description")}</p>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="example-name">
          {t("modelBuilder.example-interactive.nameLabel")}
        </label>
        <input
          id="example-name"
          // What is typed wins while the user is typing; after a commit the store's value takes over again.
          value={typedName ?? String(data.modelName ?? "")}
          onChange={(event) => setTypedName(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="example-resolution">
          {t("modelBuilder.example-interactive.resolutionLabel")}
        </label>
        <select
          id="example-resolution"
          value={typedResolution ?? Number(data.resolution ?? 60)}
          onChange={(event) => setTypedResolution(Number(event.target.value))}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {RESOLUTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("modelBuilder.example-interactive.resolutionUnit", "{{minutes}} min", { minutes })}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => {
          // Everything the form owns is held for this node and handed over in one gesture.
          hold(nodeId, {
            ...(typedName === null ? {} : { modelName: typedName }),
            ...(typedResolution === null ? {} : { resolution: typedResolution }),
          });
          void run().finally(() => {
            setTypedName(null);
            setTypedResolution(null);
          });
        }}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {t("modelBuilder.example-interactive.apply")}
      </button>

      <button
        type="button"
        onClick={() => overlay?.open()}
        className="w-full shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
      >
        {t("modelBuilder.example-interactive.review")}
      </button>

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.example-interactive.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the seed of the host's scratch store; carries the required port and a deliberately padded name.
  mock: {
    modelName: "  Example fixture  ",
    resolution: 60,
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
  },
};

export default builderModule;
