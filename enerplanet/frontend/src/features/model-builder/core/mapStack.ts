/**
 * The pure half of the map host.
 *
 * Which layers exist, in what order, which one takes clicks, and what is on each — as plain data with no
 * renderer behind it. That is deliberate: the rules G and H describe (a module names its own layer, the order
 * is a list, designating the clickable layer does not disturb the order) are *decisions*, not effects of
 * whichever engine is underneath, so they live where they can be reasoned about and tested without a DOM.
 *
 * Both hosts build on this: the frame's stub (no map library yet) and the `map-provider` module (MapLibre).
 * Duplicating the rules in each would mean two answers to "what order is this layer in".
 */

import type { LayerExtrusion, LayerOptions, MapFeature } from "./view";

/** An extent as `[west, south, east, north]` — the order the model's `region` uses. */
export type Extent = [number, number, number, number];

export interface MapStack {
  /** Create the layer, or adopt the one that already has this id (idempotent). */
  createLayer(id: string, options?: LayerOptions): void;
  /** Remove the layer and its features. Removing a layer that is not there does nothing. */
  removeLayer(id: string): void;
  /** Empty the layer, keeping it and its place in the order. */
  clearLayer(id: string): void;
  /**
   * Append features to a layer: each is normalised to a `MapFeature`, so a bare geometry gets empty
   * properties and a GeoJSON Feature keeps its own. Unknown layer → throws, because adding to a layer you
   * never created is a bug, not a no-op.
   */
  addFeatures(id: string, data: GeoJSON.GeoJSON | MapFeature): void;

  /** The order, bottom to top. A copy — mutating what you get back does not touch the host. */
  getLayerOrder(): readonly string[];
  /** Put the layers in this order. Must name every layer exactly once, or it throws. */
  setLayerOrder(order: readonly string[]): void;

  /** Which layer is up front and accepts clicks; `null` for none. Leaves the stored order alone. */
  setInteractiveLayer(id: string | null): void;
  interactiveLayer(): string | null;

  /**
   * What the layer was created with.
   *
   * The host keeps these because a module declares *what it draws* once and draws it many times: the renderer
   * asks here rather than being told again on every redraw.
   */
  optionsOf(id: string): LayerOptions | undefined;

  /** What is on a layer, in the order it was added. */
  featuresOf(id: string): readonly MapFeature[];
}

/** A `MapFeature` is the shape the service hands back — properties plus optional geometry. */
function isMapFeature(value: GeoJSON.GeoJSON | MapFeature): value is MapFeature {
  return typeof (value as MapFeature).properties === "object" && (value as MapFeature).properties !== null;
}

/**
 * One thing the caller passed, as the 0..n features it means.
 *
 * A `FeatureCollection` is several, a `Feature` is one with its properties, and a bare geometry is one with
 * none — which is what makes `addFeatures(id, await requestPolygon())` and `addFeatures(id, someCollection)`
 * the same call.
 */
function normalise(data: GeoJSON.GeoJSON | MapFeature): MapFeature[] {
  if (isMapFeature(data)) {
    return [{ properties: { ...data.properties }, ...(data.geometry === undefined ? {} : { geometry: data.geometry }) }];
  }

  const candidate = data as GeoJSON.GeoJsonObject & { type?: string };
  if (candidate.type === "FeatureCollection") {
    const collection = data as GeoJSON.FeatureCollection;
    return collection.features.map((feature) => ({
      properties: { ...(feature.properties ?? {}) },
      ...(feature.geometry === null ? {} : { geometry: feature.geometry }),
    }));
  }

  if (candidate.type === "Feature") {
    const feature = data as GeoJSON.Feature;
    return [
      {
        properties: { ...(feature.properties ?? {}) },
        ...(feature.geometry === null ? {} : { geometry: feature.geometry }),
      },
    ];
  }

  return [{ properties: {}, geometry: data as GeoJSON.Geometry }];
}

/** Walk any GeoJSON geometry and report the box it covers, or `undefined` when it has no positions. */
export function boundsOf(geometry: GeoJSON.GeoJSON | undefined): Extent | undefined {
  if (geometry === undefined) return undefined;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let sawPosition = false;

  const visitPositions = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      sawPosition = true;
      return;
    }
    for (const child of node) visitPositions(child);
  };

  // One walk that knows where positions hide: through a collection's features, a feature's geometry, a
  // geometry collection's children — and finally into the coordinate arrays themselves.
  const visitGeometry = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const shape = node as {
      type?: string;
      coordinates?: unknown;
      geometries?: unknown;
      features?: unknown;
      geometry?: unknown;
    };

    if (shape.type === "FeatureCollection") {
      for (const feature of (shape.features ?? []) as unknown[]) visitGeometry(feature);
      return;
    }
    if (shape.type === "Feature") {
      visitGeometry(shape.geometry);
      return;
    }
    if (shape.type === "GeometryCollection") {
      for (const child of (shape.geometries ?? []) as unknown[]) visitGeometry(child);
      return;
    }
    visitPositions(shape.coordinates);
  };

  visitGeometry(geometry);

  return sawPosition ? [west, south, east, north] : undefined;
}

/** Whether two extrusions describe the same volume, so a re-render with an equal option is not a change. */
function sameExtrusion(a: LayerExtrusion | undefined, b: LayerExtrusion): boolean {
  return (
    a !== undefined && a.fallback === b.fallback && a.color === b.color && a.heightFrom === b.heightFrom
  );
}

/**
 * The host's layer bookkeeping. `onChange` is called after a call that actually changed something, so a view
 * can re-render without polling.
 */
export function createMapStack(onChange: () => void = () => undefined): MapStack {
  const order: string[] = [];
  const features = new Map<string, MapFeature[]>();
  const layerOptions = new Map<string, LayerOptions>();
  let interactive: string | null = null;

  return {
    createLayer(id, options) {
      let changed = false;
      if (!features.has(id)) {
        features.set(id, []);
        order.push(id);
        changed = true;
      }
      if (options?.interactive === true && interactive !== id) {
        interactive = id;
        changed = true;
      }
      // An option that arrives after the layer was created still applies — a module creates its layer when it
      // mounts and may declare what it draws on a later render — but only when it differs, or every redraw of a
      // layer would look like a change and call `onChange` again.
      const held = layerOptions.get(id);
      if (options?.extrusion !== undefined && !sameExtrusion(held?.extrusion, options.extrusion)) {
        layerOptions.set(id, { ...held, ...options });
        changed = true;
      }
      if (changed) onChange();
    },

    removeLayer(id) {
      const at = order.indexOf(id);
      if (at === -1) return;
      order.splice(at, 1);
      features.delete(id);
      layerOptions.delete(id);
      if (interactive === id) interactive = null;
      onChange();
    },

    clearLayer(id) {
      const held = features.get(id);
      if (held === undefined || held.length === 0) return;
      features.set(id, []);
      onChange();
    },

    addFeatures(id, data) {
      const held = features.get(id);
      if (held === undefined) throw new Error(`unknown layer: ${id}`);
      held.push(...normalise(data));
      onChange();
    },

    getLayerOrder: () => [...order],

    setLayerOrder(next) {
      for (const id of next) {
        if (!features.has(id)) throw new Error(`unknown layer in layer order: ${id}`);
      }
      if (new Set(next).size !== next.length) throw new Error("a layer order must name every layer once");
      if (next.length !== order.length) {
        throw new Error("a layer order must name every layer exactly once");
      }
      order.length = 0;
      order.push(...next);
      onChange();
    },

    setInteractiveLayer(id) {
      const target = id !== null && features.has(id) ? id : null;
      if (target === interactive) return;
      interactive = target;
      onChange();
    },

    interactiveLayer: () => interactive,
    optionsOf: (id) => layerOptions.get(id),
    featuresOf: (id) => [...(features.get(id) ?? [])],
  };
}
