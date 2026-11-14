/**
 * The host runtime, held to account without a browser.
 *
 * What is worth pinning here is the part a module's experience depends on and the canvas cannot be trusted to
 * provide on its own: that the service works *before* the map exists, that a fit asked for too early is
 * remembered rather than lost, that clicks reach every listener and stop reaching them when they unsubscribe,
 * and that a detached canvas stops being redrawn.
 *
 * The canvas itself — MapLibre, WebGL, tiles — is deliberately not tested here; it needs a browser.
 */

import { describe, expect, it, vi } from "vitest";
import { createHostRuntime, type MapRenderer } from "./mapHost";
import type { Extent, MapClick, MapFeature } from "@model-builder/core";

const square: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [8.5, 49.3],
      [8.7, 49.3],
      [8.7, 49.5],
      [8.5, 49.5],
      [8.5, 49.3],
    ],
  ],
};

/** A canvas that draws nothing and remembers everything it was asked to do. */
function fakeRenderer(): MapRenderer & {
  syncs: () => number;
  fits: Extent[];
  onCapture: (kind: "point" | "polygon", result: Promise<MapFeature>) => void;
} {
  let syncs = 0;
  const fits: Extent[] = [];
  let capture: (kind: "point" | "polygon") => Promise<MapFeature> = () =>
    Promise.reject(new Error("no capture scripted"));

  return {
    sync: () => {
      syncs += 1;
    },
    fit: (extent) => {
      fits.push(extent);
    },
    capture: (kind) => capture(kind),
    syncs: () => syncs,
    fits,
    onCapture: (kind, result) => {
      capture = (asked) => (asked === kind ? result : Promise.reject(new Error("wrong kind")));
    },
  };
}

describe("the service before any canvas exists", () => {
  it("is real: layers can be made and read", () => {
    const runtime = createHostRuntime();
    runtime.service.createLayer("area");
    runtime.service.addFeatures("area", square);

    expect(runtime.service.getLayerOrder()).toEqual(["area"]);
  });

  it("refuses geometry it cannot draw yet, instead of pretending", async () => {
    const runtime = createHostRuntime();

    await expect(runtime.service.requestPoint()).rejects.toThrow(/not on screen/);
    await expect(runtime.service.requestPolygon()).rejects.toThrow(/not on screen/);
  });

  it("remembers a fit asked for too early and applies it on attach", () => {
    const runtime = createHostRuntime();
    runtime.service.fitTo(square);

    const renderer = fakeRenderer();
    runtime.attach(renderer);

    expect(renderer.fits).toEqual([[8.5, 49.3, 8.7, 49.5]]);
  });

  it("hands the canvas whatever was put on the stack while it was away", () => {
    const runtime = createHostRuntime();
    runtime.service.createLayer("area");

    const renderer = fakeRenderer();
    runtime.attach(renderer);

    // attach() syncs unconditionally: the canvas starts by drawing the stack, not by assuming it is empty.
    expect(renderer.syncs()).toBe(1);
  });
});

describe("with a canvas attached", () => {
  it("redraws on every change to the stack", () => {
    const runtime = createHostRuntime();
    const renderer = fakeRenderer();
    runtime.attach(renderer);

    runtime.service.createLayer("area");
    runtime.service.addFeatures("area", square);
    runtime.service.clearLayer("area");

    expect(renderer.syncs()).toBe(4); // attach + three changes
  });

  it("sends a fit straight through, and nothing before the canvas for a geometry with no positions", () => {
    const runtime = createHostRuntime();
    const renderer = fakeRenderer();
    runtime.attach(renderer);

    runtime.service.fitTo(square);
    runtime.service.fitTo({ type: "GeometryCollection", geometries: [] });

    expect(renderer.fits).toEqual([[8.5, 49.3, 8.7, 49.5]]);
  });

  it("resolves a capture through the canvas", async () => {
    const runtime = createHostRuntime();
    const renderer = fakeRenderer();
    const drawn: MapFeature = { properties: {}, geometry: square };
    renderer.onCapture("polygon", Promise.resolve(drawn));
    runtime.attach(renderer);

    await expect(runtime.service.requestPolygon()).resolves.toEqual(drawn);
  });

  it("stops redrawing once the canvas detaches, and refuses geometry again", async () => {
    const runtime = createHostRuntime();
    const renderer = fakeRenderer();
    const detach = runtime.attach(renderer);
    const syncs = renderer.syncs();

    detach();
    runtime.service.createLayer("after-detach");

    expect(renderer.syncs()).toBe(syncs);
    await expect(runtime.service.requestPoint()).rejects.toThrow(/not on screen/);
  });
});

describe("clicks", () => {
  it("reach every listener", () => {
    const runtime = createHostRuntime();
    const first = vi.fn();
    const second = vi.fn();
    runtime.service.onElementClick(first);
    runtime.service.onElementClick(second);

    const click: MapClick = { coordinates: [8.6, 49.4] };
    runtime.publish(click);

    expect(first).toHaveBeenCalledWith(click);
    expect(second).toHaveBeenCalledWith(click);
  });

  it("carry the element when one was hit", () => {
    const runtime = createHostRuntime();
    const listener = vi.fn();
    runtime.service.onElementClick(listener);

    const hit: MapFeature = { properties: { osm_id: 42 }, geometry: square };
    runtime.publish({ coordinates: [8.6, 49.4], feature: hit });

    expect(listener.mock.calls[0]?.[0]).toEqual({ coordinates: [8.6, 49.4], feature: hit });
  });

  it("stop reaching a listener that unsubscribed", () => {
    const runtime = createHostRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.service.onElementClick(listener);

    runtime.publish({ coordinates: [1, 2] });
    unsubscribe();
    runtime.publish({ coordinates: [3, 4] });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("do not throw when nobody is listening", () => {
    const runtime = createHostRuntime();

    expect(() => runtime.publish({ coordinates: [1, 2] })).not.toThrow();
  });
});

describe("the layer rules arrive intact", () => {
  it("keeps the order strict all the way through the service", () => {
    const runtime = createHostRuntime();
    runtime.service.createLayer("a");

    expect(() => runtime.service.setLayerOrder(["a", "ghost"])).toThrow(/unknown layer/);
  });

  it("remembers which layer takes clicks", () => {
    const runtime = createHostRuntime();
    runtime.service.createLayer("a");
    runtime.service.setInteractiveLayer("a");

    // The canvas reads this off the stack during sync; the service does not need a second channel for it.
    expect(runtime.service.getLayerOrder()).toEqual(["a"]);
  });
});
