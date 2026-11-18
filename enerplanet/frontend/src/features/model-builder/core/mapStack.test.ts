/**
 * The map host's layer rules, held to account without a browser.
 *
 * G and H are the reason this file exists: a module names its own layer, the order is a list it can read and
 * write, and designating the clickable layer must not disturb that order. Those are decisions about the
 * contract, not about MapLibre, so they are pinned here rather than left to whatever the engine does.
 */

import { describe, expect, it, vi } from "vitest";
import { boundsOf, createMapStack, type MapStack } from "./mapStack";
import type { MapFeature } from "./view";

const polygon: GeoJSON.Polygon = {
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

function stack(): { host: MapStack; changes: number } {
  const counter = { changes: 0 };
  const host = createMapStack(() => {
    counter.changes += 1;
  });
  return { host, changes: counter.changes };
}

describe("layer bookkeeping", () => {
  it("appends a created layer to the order", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");

    expect(host.getLayerOrder()).toEqual(["a", "b"]);
  });

  it("adopts an existing layer rather than creating a second one", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");
    host.createLayer("a");

    expect(host.getLayerOrder()).toEqual(["a", "b"]);
  });

  it("hands back a copy of the order, not the host's own list", () => {
    const { host } = stack();
    host.createLayer("a");

    const order = host.getLayerOrder() as string[];
    order.push("smuggled");

    expect(host.getLayerOrder()).toEqual(["a"]);
  });

  it("removes a layer and forgets it", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");
    host.removeLayer("a");

    expect(host.getLayerOrder()).toEqual(["b"]);
    expect(host.featuresOf("a")).toEqual([]);
  });

  it("removing a layer that is not there does nothing", () => {
    const { host } = stack();
    host.createLayer("a");

    expect(() => host.removeLayer("ghost")).not.toThrow();
    expect(host.getLayerOrder()).toEqual(["a"]);
  });

  it("reorders to exactly what it is given", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");
    host.createLayer("c");
    host.setLayerOrder(["c", "a", "b"]);

    expect(host.getLayerOrder()).toEqual(["c", "a", "b"]);
  });

  it("refuses an order naming a layer it does not have", () => {
    const { host } = stack();
    host.createLayer("a");

    expect(() => host.setLayerOrder(["a", "ghost"])).toThrow(/unknown layer/);
  });

  it("refuses an order that drops a layer", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");

    expect(() => host.setLayerOrder(["a"])).toThrow(/exactly once/);
  });

  it("refuses an order that names a layer twice", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");

    expect(() => host.setLayerOrder(["a", "a"])).toThrow(/every layer once/);
  });
});

describe("the clickable layer", () => {
  it("is remembered, and creating with interactive does it in one call", () => {
    const { host } = stack();
    host.createLayer("a", { interactive: true });

    expect(host.interactiveLayer()).toBe("a");
  });

  it("does not disturb the order, so un-designating restores it exactly", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");
    host.createLayer("c");
    const before = host.getLayerOrder();

    // Deliberately a layer that is *not* already on top. Designating the top layer would leave a
    // move-to-front implementation looking identical to a correct one — the assertion has to be able to
    // see the difference it is claiming.
    host.setInteractiveLayer("a");
    expect(host.interactiveLayer()).toBe("a");
    expect(host.getLayerOrder()).toEqual(before);

    host.setInteractiveLayer(null);
    expect(host.interactiveLayer()).toBeNull();
    expect(host.getLayerOrder()).toEqual(before);
  });

  it("is forgotten when its layer goes", () => {
    const { host } = stack();
    host.createLayer("a", { interactive: true });
    host.removeLayer("a");

    expect(host.interactiveLayer()).toBeNull();
  });

  it("ignores a layer it does not have", () => {
    const { host } = stack();
    host.createLayer("a");
    host.setInteractiveLayer("ghost");

    expect(host.interactiveLayer()).toBeNull();
  });
});

describe("features on a layer", () => {
  it("keeps the properties of a feature that has them", () => {
    const { host } = stack();
    host.createLayer("a");
    host.addFeatures("a", { type: "Feature", properties: { osm_id: 42 }, geometry: polygon });

    const [feature] = host.featuresOf("a");
    expect(feature?.properties).toEqual({ osm_id: 42 });
    expect(feature?.geometry).toEqual(polygon);
  });

  it("takes a MapFeature straight from the service, properties and all", () => {
    const { host } = stack();
    host.createLayer("a");
    const drawn: MapFeature = { properties: { drawn: true }, geometry: polygon };

    host.addFeatures("a", drawn);

    expect(host.featuresOf("a")).toEqual([drawn]);
  });

  it("gives a bare geometry empty properties rather than guessing", () => {
    const { host } = stack();
    host.createLayer("a");
    host.addFeatures("a", polygon);

    const [feature] = host.featuresOf("a");
    expect(feature?.properties).toEqual({});
    expect(feature?.geometry).toEqual(polygon);
  });

  it("adds every feature of a collection", () => {
    const { host } = stack();
    host.createLayer("a");
    host.addFeatures("a", {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { n: 1 }, geometry: polygon },
        { type: "Feature", properties: { n: 2 }, geometry: polygon },
      ],
    });

    expect(host.featuresOf("a").map((feature) => feature.properties.n)).toEqual([1, 2]);
  });

  it("refuses to add to a layer nobody created", () => {
    const { host } = stack();

    expect(() => host.addFeatures("ghost", polygon)).toThrow(/unknown layer/);
  });

  it("empties a layer but keeps it and its place", () => {
    const { host } = stack();
    host.createLayer("a");
    host.createLayer("b");
    host.addFeatures("a", polygon);
    host.clearLayer("a");

    expect(host.featuresOf("a")).toEqual([]);
    expect(host.getLayerOrder()).toEqual(["a", "b"]);
  });
});

describe("bounds", () => {
  it("boxes a polygon, in west-south-east-north order", () => {
    expect(boundsOf(polygon)).toEqual([8.5, 49.3, 8.7, 49.5]);
  });

  it("boxes a collection of features", () => {
    expect(
      boundsOf({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [9, 50] } },
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [8, 48] } },
        ],
      }),
    ).toEqual([8, 48, 9, 50]);
  });

  it("reaches into nested rings", () => {
    expect(
      boundsOf({
        type: "MultiPolygon",
        coordinates: [[[[1, 2], [3, 4], [1, 4], [1, 2]]], [[[5, 6], [7, 8], [5, 8], [5, 6]]]],
      }),
    ).toEqual([1, 2, 7, 8]);
  });

  it("says nothing about geometry it has no positions for", () => {
    expect(boundsOf(undefined)).toBeUndefined();
    expect(boundsOf({ type: "GeometryCollection", geometries: [] })).toBeUndefined();
  });
});

describe("layer options", () => {
  it("remembers a colour and an on-top flag, and a repeat is not a change", () => {
    const onChange = vi.fn();
    const host = createMapStack(onChange);

    host.createLayer("highlight", { color: "#16a34a", onTop: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(host.optionsOf("highlight")).toMatchObject({ color: "#16a34a", onTop: true });

    // Declaring the same thing again — which a module does on every render — must stay quiet.
    host.createLayer("highlight", { color: "#16a34a", onTop: true });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("merges a later option instead of clearing the earlier one", () => {
    const host = createMapStack();

    host.createLayer("a", { color: "#f00" });
    host.createLayer("a", { onTop: true });

    // A key left out of a later call is not a request to forget it.
    expect(host.optionsOf("a")).toMatchObject({ color: "#f00", onTop: true });
  });
});

describe("notification", () => {
  it("fires when something changed and stays quiet when nothing did", () => {
    const onChange = vi.fn();
    const host = createMapStack(onChange);

    host.createLayer("a");
    expect(onChange).toHaveBeenCalledTimes(1);

    host.createLayer("a");
    expect(onChange).toHaveBeenCalledTimes(1);

    host.removeLayer("ghost");
    expect(onChange).toHaveBeenCalledTimes(1);

    host.setInteractiveLayer("ghost");
    expect(onChange).toHaveBeenCalledTimes(1);

    host.removeLayer("a");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
