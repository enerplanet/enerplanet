/**
 * The example module — a working example, and the template to copy.
 *
 * It is deliberately **not** a step of any workflow. It is the shape every module should have: a
 * declared port surface, honest `affect`, a `seal`, mock inputs, a `validate`, and one UI per declared region.
 * Everything it does is small on purpose — the value is in the parts, not the job.
 *
 * It declares **all four slots** the frame offers and gives each one a real interface, so it doubles as the
 * demonstration of the frame:
 *
 *   sidebar   the model form — the name and the resolution, committed together
 *   map       draw the area — click to place ring points, then commit the ring, and put it on the map
 *   bottom    module status — every declared port and whether the store holds it
 *   overlay   the review — the declared ports with their values, the drawn area, and what is missing
 *
 * **Putting UI over the map** is what the `map` region is for: the frame renders the map host's canvas underneath
 * and this region's element above it in a **pass-through** layer, so the map keeps taking clicks unless a control
 * opts in with `pointer-events-auto` (`modules/README.md`, "Putting UI on the map"). The card in this region is
 * that pattern; use `overlay` plus `OverlayControl.open()` instead when you want a modal over the whole module
 * column.
 *
 * **Each region owns its own overflow**, which is the rule the frame sets: the host hands over a bounded box
 * and never scrolls for you, so every region that can outgrow its box says what happens when it does. Here
 * the three that can grow carry `flex h-full flex-col overflow-auto`; `bottom` deliberately does not, because
 * it is a status strip whose box is a cap (¼), not a quota.
 *
 * **Each region also calls `run()` itself**, with what it collected — it holds those values in the module's own
 * model and hands them over with `hold()`, keyed to the node they were collected for. See the notes on `hold`
 * and `seal`.
 *
 * The map region draws locally and then puts the result on the map: it **names a layer** (`createLayer`), empties
 * it (`clearLayer`) and adds the ring (`addFeatures`) — create and place as two separate calls, which is the
 * shape of the service. Drawing *from* the map (`requestPolygon`) and reacting to clicks (`onElementClick`) need
 * a real renderer behind the service; they belong to `area-draw`, and `map-provider` is what makes them work.
 *
 * Scaffold a new one from it:
 *
 *   node src/features/model-builder/scripts/new-module.mjs <id> "Human label"
 *
 * The script copies this directory, rewrites the id and the label, and registers the entry.
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

/**
 * The layer this module puts its ring on. The **module names it** — that is the service's shape: the id is how
 * this module finds its own layer again, how `getLayerOrder` talks about it, and nothing else has to agree on it.
 */
const AREA_LAYER = "example-area";

/**
 * The module's own model: the values its regions have collected, and the node they were collected for.
 *
 * A module's UI gathers values that only `run()` can commit, so it keeps them itself — that is the design, not
 * a hole in the contract (see "Where a module's work comes from" in `modules/README.md`). What matters is
 * `nodeId`: the frame can move the session to another node while a form is half-filled, and a value collected
 * on one node must never be committed against another.
 */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/**
 * Hold these values for `nodeId`, **dropping anything held for a different node**.
 *
 * The only way a region hands values to `run()`, and the path a test drives the module through — there is no
 * other door into it. Holding an *empty* set is meaningful: it is how a region says "the node changed, nothing
 * of the last one applies here".
 */
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
  id: "example",
  name: "Example module",

  // The module's whole store surface — and it is exactly what `run()` writes, nothing declared "just in
  // case". Declaring a port is not paperwork: an undeclared write is rejected, and the flow gate reasons
  // about `required` before the node is even allowed to run.
  params: [
    { port: "modelName" },
    { port: "resolution", required: true },
    { port: "coordinates" },
  ],

  // Declared influence. Writing these three affects nothing downstream *here* — this module is not placed in a
  // workflow and nothing in it reads another port — so `{}` is the honest answer. Keep this honest in a real
  // module: the influence-honesty prober (`core/influence.ts`) fails one that understates it.
  affect: {},

  // How often this module's work reaches the log (`spec/core.md` T16, `Plan.md` §5). `per-commit` seals one
  // **atomic** transaction per `commit()`; the default `at-completion` seals one for the whole `run()`.
  //
  // `per-commit` is right here because the three ports are independent fields: nothing is derived from anything
  // else, so a partial state is still one this module stands behind, and the user gets field-level undo for
  // free. A module whose writes must land together leaves this at the default — `grid-generation` writes
  // buildings + transformers + lines + grids from one drawn area, and undoing one of those would leave a store
  // that violates the module's own guarantee. Atomicity is a property of the transaction either way; only the
  // group differs, and which group is right is the module's call.
  seal: "per-commit",

  // Every slot the frame offers. A module that declares nothing is headless — that is how an `auto`
  // node renders nothing.
  layout: ["sidebar", "map", "bottom", "overlay"],

  run: (ctx) => {
    const collected = takeHeld();
    const proposed: Partial<ModelData> = {};

    // Read before you write — the anti-clobber rule — and commit only what was collected actually changes, so
    // a run with nothing to say seals nothing at all rather than a transaction that changes no value.
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

  // The frame can move the session to another node mid-edit — from the bar, while this form is half-filled.
  // Nothing collected on one node may reach another, so a node change drops the held values and clears what
  // was collected locally: the region shows the *store's* values again, and only a fresh hold can be
  // committed from here. The layer this module put on the map goes with it — `removeLayer` is idempotent,
  // so this is safe even when there was nothing on the map to begin with.
  useEffect(() => {
    map?.removeLayer(AREA_LAYER);
    hold(nodeId, {});
    setTypedName(null);
    setTypedResolution(null);
    setPoints([]);
  }, [nodeId, map]);

  // ── bottom: module status. Intrinsic height on purpose — its box is a cap, so a strip that fits renders
  //    as a strip. Each port says whether the store actually holds it, by colour *and* by word.
  if (region === "bottom") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        {PORTS.map((port) => (
          <span key={port} className="flex items-baseline gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{port}</span>
            {data[port] === undefined ? (
              <span className="text-amber-600 dark:text-amber-400">
                {t("modelBuilder.example.bottom.notSet")}
              </span>
            ) : (
              <span className="text-foreground">{describeValue(data[port])}</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  // ── map: draw the area locally, then put it on the map. What gets committed is the ring — the map service
  //    never writes the store, and the layer is transient interaction state.
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

      // Four separate calls, which is the shape of the service: name a layer, empty it, put the geometry on it,
      // and say it is the one taking clicks. None of it is model state — the ring above is what was committed.
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
      // A floating card, not a full-box panel: this region sits *over* the real map, so it takes only the space
      // it needs and opts back into pointer events (the host's layer is pass-through, so a panel can never
      // swallow a map click by accident).
      <div className="pointer-events-auto flex max-h-full max-w-md flex-col gap-3 overflow-auto rounded-lg border border-border bg-card/95 p-4 shadow-sm">
        <h3 className="shrink-0 text-base font-semibold">{t("modelBuilder.example.map.title")}</h3>
        <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.example.map.hint")}</p>

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
            {t("modelBuilder.example.map.useRing")}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={points.length === 0}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("modelBuilder.example.map.clear")}
          </button>
          <span className="text-xs text-muted-foreground">
            {t("modelBuilder.example.map.points", "{{count}} points", { count: points.length })}
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
            <h3 className="text-lg font-semibold">{t("modelBuilder.example.overlay.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("modelBuilder.example.overlay.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => overlay?.close()}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("modelBuilder.example.overlay.close")}
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
                    {t("modelBuilder.example.overlay.required")}
                  </span>
                )}
              </dt>
              <dd className={data[port] === undefined ? "text-amber-600 dark:text-amber-400" : ""}>
                {data[port] === undefined
                  ? t("modelBuilder.example.bottom.notSet")
                  : describeValue(data[port])}
              </dd>
            </div>
          ))}
        </dl>

        <p className="shrink-0 text-sm">
          <span className="text-muted-foreground">{t("modelBuilder.example.overlay.area")}: </span>
          {drawnPoints === 0
            ? t("modelBuilder.example.overlay.areaNone")
            : t("modelBuilder.example.overlay.areaDrawn", "{{rings}} ring(s), {{points}} point(s)", {
                rings: rings.length,
                points: drawnPoints,
              })}
        </p>

        {issues.length === 0 ? (
          <p className="shrink-0 text-sm text-emerald-600 dark:text-emerald-400">
            {t("modelBuilder.example.overlay.complete")}
          </p>
        ) : (
          <ul className="shrink-0 space-y-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue.message}>
                {t("modelBuilder.example.overlay.issue", "{{port}}: {{message}}", {
                  port: String(issue.port ?? "—"),
                  message: issue.message,
                })}
              </li>
            ))}
          </ul>
        )}

        <p className="shrink-0 text-xs text-muted-foreground">
          {t("modelBuilder.example.overlay.shellHint")}
        </p>
      </div>
    );
  }

  // ── sidebar: the model form. Both fields go in one gesture, and the button asks `run()` for both at once.
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.example.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.example.description")}</p>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="example-name">
          {t("modelBuilder.example.nameLabel")}
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
          {t("modelBuilder.example.resolutionLabel")}
        </label>
        <select
          id="example-resolution"
          value={typedResolution ?? Number(data.resolution ?? 60)}
          onChange={(event) => setTypedResolution(Number(event.target.value))}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {RESOLUTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("modelBuilder.example.resolutionUnit", "{{minutes}} min", { minutes })}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => {
          // Everything the form owns is held for *this* node and handed over in one gesture: the write
          // boundary, anti-clobber and the cascade apply to it exactly as they do in a flow.
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
        {t("modelBuilder.example.apply")}
      </button>

      <button
        type="button"
        onClick={() => overlay?.open()}
        className="w-full shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
      >
        {t("modelBuilder.example.review")}
      </button>

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.example.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the inputs this module needs to do its work in isolation — the seed of the host's scratch
  // store. It carries the required port (resolution, which the contract check insists on) and a name, whose
  // padding is deliberate: the form trims it, so committing the form's own value is a visible change.
  mock: {
    modelName: "  Example fixture  ",
    resolution: 60,
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
  },
};

export default builderModule;
