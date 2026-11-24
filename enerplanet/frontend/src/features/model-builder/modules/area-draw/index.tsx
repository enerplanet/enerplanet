/**
 * `area-draw` — the model area, drawn on the map.
 *
 * Turns a map interaction into a store port: the drawn rings are `coordinates`, which everything downstream
 * is built inside. Regions: `map` (the draw interaction), `sidebar` (the polygon list and actions). `affect`
 * is empty — nothing feeds this module.
 */

import { useEffect, useRef, useState } from "react";
import {
  defineModule,
  fingerprint,
  type BuilderModule,
  type Coordinates,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { getDraft, setDraft, useDraft } from "./draft";

/** The layer the drawn area goes on. The module names it, which is how the service works. */
const AREA_LAYER = "area-draw-polygons";

/** Mean Earth radius (IUGG), in kilometres — the sphere `areaKm2` measures on. */
const EARTH_RADIUS_KM = 6371.0088;

/** The module's own model: the draft its UI has built, keyed by the node it was built for. */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/** Hold these values for `nodeId`, dropping anything held for a different node. See the example module. */
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

/** The two port values are the same area — compared the way the engine compares them. */
function sameArea(a: Coordinates, b: Coordinates | undefined): boolean {
  return fingerprint(a) === fingerprint(b);
}

/** The area of these rings, in km², on a sphere (ring winding ignored). */
export function areaKm2(rings: Coordinates): number {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const from = ring[i];
      const to = ring[(i + 1) % ring.length];
      if (from === undefined || to === undefined) continue;
      const [lon1, lat1] = from;
      const [lon2, lat2] = to;
      sum += ((lon2 - lon1) * Math.PI) / 180 * (Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
    }
    total += Math.abs(sum / 2) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  }
  return total;
}

/** The drawn rings as one MultiPolygon to frame, or `undefined` when there is nothing worth framing. */
export function areaGeometry(rings: Coordinates | undefined): GeoJSON.MultiPolygon | undefined {
  const drawn = (rings ?? []).filter((ring) => ring.length >= 3);
  if (drawn.length === 0) return undefined;
  return { type: "MultiPolygon", coordinates: drawn.map((ring) => [ring]) } as GeoJSON.MultiPolygon;
}

/** Whether anything downstream of the area exists to lose. The grid is what `coordinates` feeds. */
function hasGrid(data: Readonly<ModelData>): boolean {
  return (
    data.buildings !== undefined ||
    data.transformers !== undefined ||
    data.lines !== undefined ||
    data.mvLines !== undefined ||
    data.grids !== undefined
  );
}

/** Whether applying this draft would destroy something — the whole grid, which `coordinates` feeds. */
export function needsConfirmation(data: Readonly<ModelData>, draft: Coordinates): boolean {
  if (sameArea(draft, data.coordinates)) return false;
  return hasGrid(data);
}

/** What is missing, or wrong, for a model built in this area. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (projection.region === undefined) {
    issues.push({ port: "region", message: "Choose the region the model is drawn in." });
  }

  const rings = projection.coordinates;
  if (rings === undefined || rings.length === 0) {
    issues.push({ port: "coordinates", message: "The model needs an area to be built in." });
  } else if (rings.some((ring) => ring.length < 3)) {
    issues.push({ port: "coordinates", message: "A polygon needs at least three points." });
  }

  return issues;
}

const module = defineModule({
  id: "area-draw",
  name: "Area draw",

  // An area is drawn inside a region, so the flow may not run this before one has been chosen.
  params: [{ port: "region", required: true }, { port: "coordinates" }],

  affect: {},

  // One gesture, one transaction: the whole ring list lands together or not at all.
  seal: "per-commit",

  layout: ["sidebar", "map"],

  run: (ctx) => {
    const collected = takeHeld();
    if (collected.coordinates === undefined) return;

    // Read before you write, and commit only what changed; applying the area already there proposes nothing.
    const current = ctx.read("coordinates");
    if (sameArea(collected.coordinates, current)) return;

    ctx.commit({ coordinates: collected.coordinates });
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t } = useTranslation();
  // The draft lives outside React (`draft.ts`): this module renders once per region, so two `useState`s would fight over the layer.
  const draft = useDraft();
  const [drawing, setDrawing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applied = data.coordinates ?? [];
  const pending = !sameArea(draft, applied);

  // The draft follows the store; a node change throws the local state away with it. Both regions run this harmlessly.
  useEffect(() => {
    setDraft(data.coordinates ?? []);
    setConfirmed(false);
    setDrawing(false);
    setError(null);
    hold(nodeId, {});
  }, [nodeId, data.coordinates]);

  // A confirmation belongs to the draft it was asked about.
  useEffect(() => {
    setConfirmed(false);
  }, [draft]);

  // What is drawn is on the map — the draft, not the applied area. Only the `map` region does this.
  useEffect(() => {
    if (region !== "map" || map === undefined) return;
    map.createLayer(AREA_LAYER);
    map.clearLayer(AREA_LAYER);
    if (draft.length === 0) return;
    map.addFeatures(AREA_LAYER, {
      type: "FeatureCollection",
      features: draft.map((ring) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      })),
    });
    map.setInteractiveLayer(AREA_LAYER);
  }, [map, region, draft]);

  // Where the model is, framed once, when its area first exists. Only the `map` instance does this.
  const framed = useRef(false);
  useEffect(() => {
    if (region !== "map" || map === undefined || framed.current) return;
    const area = areaGeometry(data.coordinates);
    if (area === undefined) return;
    framed.current = true;
    map.fitTo(area);
  }, [map, region, data.coordinates]);

  /** The layer is this module's, so this module takes it off when it leaves. */
  useEffect(() => {
    if (region !== "map" || map === undefined) return undefined;
    return () => {
      map.removeLayer(AREA_LAYER);
    };
  }, [map, region]);

  /** Ask the map for a polygon and add it to the draft. */
  const draw = async (): Promise<void> => {
    if (map === undefined) {
      // Never a silent no-op. A button that looks alive and does nothing is the worst of both.
      setError(t("modelBuilder.area-draw.mapMissing"));
      return;
    }
    setDrawing(true);
    setError(null);
    try {
      const drawn = await map.requestPolygon();
      const ring = drawn.geometry?.type === "Polygon" ? drawn.geometry.coordinates[0] ?? [] : [];
      if (ring.length < 3) {
        // The map handed back something that is not an area. Say so rather than appearing to ignore the click.
        setError(t("modelBuilder.area-draw.ringTooSmall"));
        return;
      }
      // Appends: the model may be built in several polygons. Read the store, since this handler may outlive its render.
      setDraft([...getDraft(), [...ring] as [number, number][]]);
    } catch (thrown) {
      // A cancelled capture is a normal outcome — Escape, or a close with too few corners — so only a real failure shows.
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      if (!/cancel/i.test(message)) setError(message);
    } finally {
      setDrawing(false);
    }
  };

  /** Apply the draft: the second click confirms when applying it would destroy downstream work. */
  const apply = async (): Promise<void> => {
    if (needsConfirmation(data, draft) && !confirmed) {
      setConfirmed(true);
      return;
    }
    hold(nodeId, { coordinates: draft });
    await run();
    setConfirmed(false);
  };

  // ── map: the draw interaction, and the area itself. A floating card over the real map.
  if (region === "map") {
    return (
      <div className="pointer-events-auto flex max-h-full max-w-md flex-col gap-3 overflow-auto rounded-lg border border-border bg-card/95 p-4 shadow-sm">
        <h3 className="shrink-0 text-base font-semibold">{t("modelBuilder.area-draw.mapTitle")}</h3>
        <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.area-draw.mapHint")}</p>

        <button
          type="button"
          onClick={() => void draw()}
          disabled={drawing}
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {drawing
            ? t("modelBuilder.area-draw.drawing")
            : draft.length === 0
              ? t("modelBuilder.area-draw.draw")
              : t("modelBuilder.area-draw.drawAnother")}
        </button>

        {/* The model may be built in several polygons, so the count is on the card the drawing happens on. */}
        <p className="shrink-0 text-sm text-muted-foreground">
          {t("modelBuilder.area-draw.drawnCount", "Drawn: {{count}}", { count: draft.length })}
        </p>

        {error !== null && <p className="shrink-0 text-sm text-destructive">{error}</p>}

        <p className="shrink-0 text-xs text-muted-foreground">
          {pending ? t("modelBuilder.area-draw.unapplied") : t("modelBuilder.area-draw.applied")}
        </p>
      </div>
    );
  }

  // ── sidebar: the polygons, the summary, and the actions.
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.area-draw.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.area-draw.description")}</p>
      </div>

      <div className="shrink-0 space-y-1">
        <p className="text-sm text-muted-foreground">{t("modelBuilder.area-draw.polygons")}</p>
        {draft.length === 0 ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("modelBuilder.area-draw.nothing")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {draft.map((ring, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {t("modelBuilder.area-draw.polygon", "{{index}}.", { index: index + 1 })}
                </span>
                <span>
                  {t("modelBuilder.area-draw.points", "{{count}} points", { count: ring.length })}
                </span>
                <span className="font-mono text-xs">
                  {t("modelBuilder.area-draw.area", "{{area}} km²", {
                    area: areaKm2([ring]).toFixed(2),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="shrink-0 text-sm">
        <span className="text-muted-foreground">{t("modelBuilder.area-draw.total")}: </span>
        {t("modelBuilder.area-draw.area", "{{area}} km²", { area: areaKm2(draft).toFixed(2) })}
      </p>

      {confirmed && (
        <div className="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive">
            {t("modelBuilder.area-draw.confirmBody", "Applying this removes the existing grid ({{count}} buildings).", {
              count: data.buildings?.features.length ?? 0,
            })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmed(false);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("modelBuilder.area-draw.confirmCancel")}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => void apply()}
        disabled={!pending}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {confirmed
          ? t("modelBuilder.area-draw.confirmApply")
          : t("modelBuilder.area-draw.apply")}
      </button>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setDraft(getDraft().slice(0, -1))}
          disabled={draft.length === 0}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("modelBuilder.area-draw.undo")}
        </button>
        <button
          type="button"
          onClick={() => setDraft([])}
          disabled={draft.length === 0}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("modelBuilder.area-draw.clear")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setDraft(applied)}
        disabled={!pending}
        className="w-full shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("modelBuilder.area-draw.discard")}
      </button>

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.area-draw.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The seed for test mode: a region (its only required port), so the module can run on its own. No area — starting empty is its job.
  mock: {
    region: { country: "DE", state: "BW" },
  },
};

export default builderModule;
