/**
 * The grid reaching the map — the one thing about this module nothing could check.
 *
 * Written failing first, and written because of a real bug: the buildings drew and the cables did not, which
 * looked like a data problem and was not (the store held 134 cables). The draw was a `useEffect` inside the
 * component, and the app has no DOM test environment, so it could never be run. Pulling it out into `drawGrid`
 * makes it checkable against a real `MapStack` — the map control is a pure interface, so the real stack *is*
 * the test double, not a mock of it.
 *
 * These cases do not test the effect; they test everything the effect calls. If the store holds a collection and
 * `drawGrid` runs, the map holds it too.
 */

import { describe, expect, it } from "vitest";
import { createMapStack, type MapStack } from "@model-builder/core";
import { drawGrid } from "./index";

const OSM_A = 100;

const buildings: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { osm_id: OSM_A },
      geometry: { type: "Point", coordinates: [8.6, 49.4] },
    },
  ],
};

const lines: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { grid_result_id: 1 },
      geometry: {
        type: "LineString",
        coordinates: [
          [8.6, 49.4],
          [8.61, 49.41],
        ],
      },
    },
  ],
};

const mvLines: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { grid_result_id: 1 },
      geometry: {
        type: "LineString",
        coordinates: [
          [8.6, 49.4],
          [8.62, 49.42],
        ],
      },
    },
  ],
};

const transformers: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { grid_result_id: 1 },
      geometry: { type: "Point", coordinates: [8.6, 49.4] },
    },
  ],
};

/** Every layer the grid owns, in the order the module declares them. */
const LAYERS = ["buildings", "lines", "mvLines", "transformers"] as const;

describe("drawGrid", () => {
  it("puts every collection the grid produced on its own layer", () => {
    const map: MapStack = createMapStack();

    drawGrid(map, { buildings, lines, mvLines, transformers });

    // One feature each, on the layer named for the port it came from.
    for (const layer of LAYERS) {
      expect(map.featuresOf(layer)).toHaveLength(1);
    }
  });

  it("does not lose the cables — the bug this test exists for", () => {
    const map: MapStack = createMapStack();

    drawGrid(map, { buildings, lines });

    // The cables are the whole point of a grid; the buildings were never the part that failed.
    expect(map.featuresOf("lines")).toHaveLength(1);
    expect(map.featuresOf("lines")[0].properties.grid_result_id).toBe(1);
  });

  it("keeps another module's layer beneath the grid and names every layer once", () => {
    const map: MapStack = createMapStack();
    map.createLayer("area-draw-polygons");

    drawGrid(map, { buildings, lines, mvLines, transformers });

    // `setLayerOrder` throws unless every layer is named exactly once — including the ones this module does
    // not own, which is why the grid failed to draw while area-draw was mounted.
    expect(map.getLayerOrder()).toEqual(["area-draw-polygons", ...LAYERS]);
  });

  it("creates the layer but leaves it empty when a collection is missing", () => {
    const map: MapStack = createMapStack();

    drawGrid(map, { buildings });

    expect(map.getLayerOrder()).toEqual([...LAYERS]);
    expect(map.featuresOf("buildings")).toHaveLength(1);
    expect(map.featuresOf("lines")).toHaveLength(0);
  });

  it("replaces what a layer held rather than appending to it", () => {
    const map: MapStack = createMapStack();

    drawGrid(map, { buildings });
    drawGrid(map, { buildings });

    // Drawing twice is a redraw, not a second grid: 17 buildings must not become 34.
    expect(map.featuresOf("buildings")).toHaveLength(1);
  });
});
