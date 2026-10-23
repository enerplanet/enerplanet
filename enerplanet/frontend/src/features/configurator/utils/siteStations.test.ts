import { describe, expect, it } from "vitest";

import type { PylovoGridData } from "@/features/configurator/types/area-select";
import { assignToStation, siteBuildingIds, stationsFromGrid, withStationAt, type SiteStation } from "./siteStations";

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

describe("stationsFromGrid before the site is regenerated", () => {
    it("reuses a generated station an earlier edit stored, matched by position", () => {
        // A first edit stored grid 102's station as transformer 6; pylovo returns it rounded.
        const afterFirstEdit: SiteStation[] = [
            ...stored,
            { transformer_id: 6, geom: point(12.9000000004, 48.7999999996), rated_kva: 250, cost_eur: null, assigned_building_ids: [] },
        ];
        const stations = stationsFromGrid(afterFirstEdit, grid);

        expect(stations.get("102")?.transformer_id).toBe(6);
        expect([...stations.values()].filter(s => s.transformer_id === null)).toHaveLength(0);
    });
});

describe("stationsFromGrid after a station was moved or deleted", () => {
    it("leaves out a stored station that was deleted", () => {
        const stations = stationsFromGrid([], grid);

        expect(stations.has("101")).toBe(false);
        expect(stations.has("102")).toBe(true);
    });

    it("leaves out a generated station once the site was edited since generation", () => {
        // grid 102's station was stored by an earlier edit, then moved away from where the grid shows it.
        const moved: SiteStation[] = [
            ...stored,
            { transformer_id: 6, geom: point(12.95, 48.85), rated_kva: 250, cost_eur: null, assigned_building_ids: [] },
        ];
        const stations = stationsFromGrid(moved, grid, true);

        expect(stations.has("102")).toBe(false);
        expect([...stations.values()].map(s => s.transformer_id)).toEqual([5, 6]);
    });
});

describe("withStationAt", () => {
    it("moves, adds and removes a shown station, and the next edit reads it there", () => {
        const moved = withStationAt(grid, 102, [12.95, 48.85]);
        const added = withStationAt(moved, -1, [12.91, 48.82], 400);
        const removed = withStationAt(added, 101, null);

        const shown = (g: PylovoGridData) => g.transformers!.features.map(f => [f.properties?.grid_result_id, (f.geometry as GeoJSON.Point).coordinates]);
        expect(shown(removed)).toEqual([[102, [12.95, 48.85]], [-1, [12.91, 48.82]]]);
        expect(grid.transformers!.features).toHaveLength(2);

        // Stored after the edits: the moved station as 6, the added one as 7.
        const stations = stationsFromGrid([
            { transformer_id: 6, geom: point(12.95, 48.85), rated_kva: 250, cost_eur: null, assigned_building_ids: [] },
            { transformer_id: 7, geom: point(12.91, 48.82), rated_kva: 400, cost_eur: null, assigned_building_ids: [] },
        ], removed, true);
        expect(stations.get("102")?.transformer_id).toBe(6);
        expect(stations.get("-1")?.transformer_id).toBe(7);
    });
});
