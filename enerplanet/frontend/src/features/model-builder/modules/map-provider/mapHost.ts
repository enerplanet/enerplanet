/**
 * The provider's **engine-free half**: the layer stack, the click listeners and the geometry requests, wired
 * into a real `MapService` — plus the small contract a canvas satisfies to actually draw.
 *
 * A module would never see this file. It exists because the service must be *real before any map exists*: the
 * frame mounts the provider once, and modules come and go on top of it, so a module that calls `createLayer`
 * during its first render has to have that layer waiting when the canvas appears. Keeping the bookkeeping here
 * — no MapLibre, no DOM — is also what makes it testable, since the canvas next door (`mapCanvas.tsx`) needs a
 * browser and is deliberately not unit-tested.
 *
 * This is a **blackbox** (`modules/map-provider.md`): what is inside a layer, and how it is drawn, is the
 * provider's business. What crosses the edge is this: layers with features in them, and clicks coming back
 * with the feature that was hit.
 */

import {
  boundsOf,
  createMapStack,
  type Extent,
  type MapClick,
  type MapFeature,
  type MapService,
  type MapStack,
} from "@model-builder/core";

/**
 * What a canvas must be able to do for the service to mean anything.
 *
 * `sync` is deliberately a pull — the canvas reads the stack and draws it — so there is one description of
 * what should be on the map (the stack), rather than a stream of deltas the canvas has to keep up with.
 */
export interface MapRenderer {
  /** Draw the stack as it now stands: layers, their order, their features, and which one takes clicks. */
  sync(): void;
  /** Frame this extent. */
  fit(extent: Extent): void;
  /** Let the user draw one; rejects when they cancel or the capture is interrupted. */
  capture(kind: "point" | "polygon"): Promise<MapFeature>;
}

export interface HostRuntime {
  /** The service the frame hands to every module's `map` region. */
  readonly service: MapService;
  /**
   * The stack the service reads and writes. Exposed for the **canvas only** — the canvas draws what the stack
   * holds, and reads the order and the clickable layer from it, rather than the runtime keeping a second copy
   * of either.
   */
  readonly stack: MapStack;
  /** The canvas calls this once its map exists; the returned function detaches it. */
  attach(renderer: MapRenderer): () => void;
  /** The canvas calls this for every click, with what it hit (if anything) and where. */
  publish(click: MapClick): void;
}

export function createHostRuntime(): HostRuntime {
  let renderer: MapRenderer | null = null;
  let pendingFit: Extent | undefined;
  const listeners = new Set<(click: MapClick) => void>();

  // Every change to the stack redraws — the canvas is the only thing that has to know *how*.
  const stack = createMapStack(() => renderer?.sync());

  const request = (kind: "point" | "polygon"): Promise<MapFeature> => {
    if (renderer === null) {
      return Promise.reject(new Error("the map canvas is not on screen yet"));
    }
    return renderer.capture(kind);
  };

  const service: MapService = {
    requestPoint: () => request("point"),
    requestPolygon: () => request("polygon"),

    onElementClick(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    createLayer: (id, options) => stack.createLayer(id, options),
    removeLayer: (id) => stack.removeLayer(id),
    addFeatures: (id, data) => stack.addFeatures(id, data),
    clearLayer: (id) => stack.clearLayer(id),

    setInteractiveLayer: (id) => stack.setInteractiveLayer(id),

    getLayerOrder: () => stack.getLayerOrder(),
    setLayerOrder: (order) => stack.setLayerOrder(order),

    /**
     * A fit asked for before the canvas exists is **remembered**, not dropped: a module framing its region on
     * mount is the normal case, and the canvas is usually a commit behind it.
     */
    fitTo(geometry) {
      const extent = boundsOf(geometry);
      if (extent === undefined) return;
      if (renderer === null) {
        pendingFit = extent;
        return;
      }
      renderer.fit(extent);
    },
  };

  return {
    service,
    stack,

    attach(next) {
      renderer = next;
      next.sync();
      if (pendingFit !== undefined) {
        next.fit(pendingFit);
        pendingFit = undefined;
      }
      return () => {
        renderer = null;
      };
    },

    publish(click) {
      // A copy, so a listener that unsubscribes while being called cannot disturb the loop.
      for (const listener of [...listeners]) listener(click);
    },
  };
}
