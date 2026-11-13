import { describe, expect, it } from "vitest";
import Collection from "ol/Collection";
import type OLMap from "ol/Map";
import type BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import { loadBoundaryLayer } from "./gridLayerUtils";

const boundary: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [[[12.89, 48.81], [12.9, 48.81], [12.9, 48.82], [12.89, 48.81]]] },
};

describe("loadBoundaryLayer", () => {
    it("replaces the shown boundary when other layers follow it", () => {
        // The map's own layer collection; a full OLMap needs a DOM the test environment lacks.
        const layers = new Collection<BaseLayer>();
        const map = { getLayers: () => layers, addLayer: (l: BaseLayer) => layers.push(l), removeLayer: (l: BaseLayer) => layers.remove(l) } as unknown as OLMap;
        loadBoundaryLayer(map, boundary, "first");
        map.addLayer(new VectorLayer({ source: new VectorSource() }));

        loadBoundaryLayer(map, boundary, "second");

        const names = map.getLayers().getArray().map(l => l.get("name"));
        expect(names.filter(n => n === "boundary")).toHaveLength(1);
        expect(names).toHaveLength(2);
    });
});
