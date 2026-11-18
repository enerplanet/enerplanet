import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

import { createMapStack } from "@model-builder/core";
import {
  CITY_3D_LAYER_ID,
  FULL_EXTRUSION_OPACITY,
  FULL_EXTRUSION_PITCH,
  POLYGON_FILTER,
  cityBuildings3dLayer,
  extrusionIdOf,
  extrusionLayer,
  extrusionOpacityAt,
  hasOwnVolumes,
} from "./extrusion";

/** A style with a vector building layer, then one more layer above it. */
const withBuildings = (): StyleSpecification =>
  ({
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.invalid/tiles.json" } },
    layers: [
      { id: "background", type: "background" },
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building" },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
    ],
  }) as StyleSpecification;

const aPolygon = (): GeoJSON.Feature => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[8, 49], [8, 50], [9, 50], [8, 49]]] },
});

describe("a module layer's extrusion", () => {
  it("takes its place after the layer's fill, line and circle, so the raw ids stay together", () => {
    expect(extrusionIdOf("buildings")).toBe("mb-layer-buildings-extrusion");
  });

  it("draws the layer's polygons as volumes, in the colour the layer asked for", () => {
    expect(extrusionLayer("buildings", "mb-source-buildings", { fallback: 8, color: "#3b82f6" })).toMatchObject({
      id: "mb-layer-buildings-extrusion",
      type: "fill-extrusion",
      source: "mb-source-buildings",
      paint: { "fill-extrusion-color": "#3b82f6", "fill-extrusion-height": 8 },
    });
  });

  it("takes the height from a feature where the data has one, and falls back where it does not", () => {
    const layer = extrusionLayer("buildings", "s", { fallback: 8, color: "#3b82f6", heightFrom: "levels" });
    expect(layer).toMatchObject({ paint: { "fill-extrusion-height": ["coalesce", ["get", "levels"], 8] } });
  });

  it("keeps MultiPolygon footprints, which an equality on Polygon would silently drop", () => {
    expect(POLYGON_FILTER).toContain("LineString");
    expect(POLYGON_FILTER).not.toContain("Polygon");
  });

  it("starts invisible, so the flat map is unchanged until it is tilted", () => {
    expect(extrusionLayer("buildings", "s", { fallback: 8, color: "#3b82f6" })).toMatchObject({
      paint: { "fill-extrusion-opacity": 0 },
    });
  });
});

describe("the city's own buildings", () => {
  it("are drawn from the style's own source, directly above the flat footprints", () => {
    expect(cityBuildings3dLayer(withBuildings())).toMatchObject({
      layer: {
        id: CITY_3D_LAYER_ID,
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
      },
      beforeId: "water",
    });
  });

  it("are not built at all when the style draws no vector buildings", () => {
    const style = withBuildings();
    style.sources = { openmaptiles: { type: "raster", tiles: ["https://example.invalid/{z}/{x}/{y}.png"] } };
    expect(cityBuildings3dLayer(style)).toBeUndefined();
  });
});

describe("which volumes are drawn", () => {
  it("keeps the city's while no layer stands up volumes of its own", () => {
    expect(hasOwnVolumes(createMapStack())).toBe(false);
  });

  it("keeps the city's while a layer has declared an extrusion but holds nothing yet", () => {
    const stack = createMapStack();
    stack.createLayer("buildings", { extrusion: { fallback: 8, color: "#3b82f6" } });
    // The grid declares its buildings before it has any, and the city's 3D must not blink out before then.
    expect(hasOwnVolumes(stack)).toBe(false);
  });

  it("retires the city's the moment a layer's volumes have features", () => {
    const stack = createMapStack();
    stack.createLayer("buildings", { extrusion: { fallback: 8, color: "#3b82f6" } });
    stack.addFeatures("buildings", aPolygon());
    expect(hasOwnVolumes(stack)).toBe(true);
  });

  it("is not moved by a layer that has features but asked for no volume", () => {
    const stack = createMapStack();
    stack.createLayer("lines");
    stack.addFeatures("lines", aPolygon());
    expect(hasOwnVolumes(stack)).toBe(false);
  });
});

describe("the volume's visibility, driven by pitch", () => {
  it("is nothing at all while the map is flat", () => {
    expect(extrusionOpacityAt(0)).toBe(0);
    expect(extrusionOpacityAt(-1)).toBe(0);
    expect(extrusionOpacityAt(Number.NaN)).toBe(0);
  });

  it("is solid once the map is tilted at all meaningfully, not merely visible", () => {
    expect(extrusionOpacityAt(FULL_EXTRUSION_PITCH)).toBe(1);
    expect(FULL_EXTRUSION_OPACITY).toBe(1);
  });

  it("fades in between, so the volume arrives with the tilt rather than popping", () => {
    const mid = extrusionOpacityAt(FULL_EXTRUSION_PITCH / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(FULL_EXTRUSION_OPACITY);
  });
});
