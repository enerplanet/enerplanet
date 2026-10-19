import { describe, expect, it } from "vitest";

import type { PylovoGridData } from "@/features/configurator/types/area-select";
import { assignToStation, siteBuildingIds, stationsFromGrid, type SiteStation } from "./siteStations";

const point = (lon: number, lat: number): GeoJSON.Point => ({ type: "Point", coordinates: [lon, lat] });

// Site 2 shape: one stored OSM station (grid 101) and one the generator placed (grid 102).
const stored: SiteStation[] = [
    { transformer_id: 5, geom: point(12.89, 48.81), rated_kva: 630, cost_eur: null, assigned_building_ids: [1, 2] },
];
const grid = {
    transformers: { type: "FeatureCollection", features: [
        { type: "Feature", geometry: point(12.89, 48.81), properties: { grid_result_id: 101, site_transformer_id: 5, rated_power_kva: 630 } },
        { type: "Feature", geometry: point(12.90, 48.80), properties: { grid_result_id: 102, site_transformer_id: null, rated_power_kva: 250 } },
    ] },
    buildings: { type: "FeatureCollection", features: [
        { type: "Feature", geometry: point(12.89, 48.81), properties: { building_id: 1, osm_id: "w1" } },
        { type: "Feature", geometry: point(12.89, 48.81), properties: { building_id: 2, osm_id: "w2" } },
        { type: "Feature", geometry: point(12.90, 48.80), properties: { building_id: 3, osm_id: "w3" } },
    ] },
} as unknown as PylovoGridData;

describe("stationsFromGrid", () => {
    it("keeps stored stations and fixes generated ones where they are shown", () => {
        const stations = stationsFromGrid(stored, grid);

        expect(stations.get("101")).toEqual(stored[0]);
        expect(stations.get("102")).toEqual({ transformer_id: null, geom: point(12.90, 48.80), rated_kva: 250, cost_eur: null, assigned_building_ids: [] });
    });
});

describe("assignToStation", () => {
    it("moves buildings to the target station and off their previous one", () => {
        const stations = assignToStation(stationsFromGrid(stored, grid), siteBuildingIds(grid, ["w2", "w3"]), 102);

        expect(stations.map(s => s.assigned_building_ids)).toEqual([[1], [2, 3]]);
        expect(stored[0].assigned_building_ids).toEqual([1, 2]);
    });

    it("rejects a building that is not in the site", () => {
        expect(() => siteBuildingIds(grid, ["w9"])).toThrow("Building w9 is not part of this site");
    });
});
