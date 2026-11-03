import { describe, expect, it } from "vitest";
import { Feature } from "ol";
import { Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";

import type { PylovoGridData } from "@/features/configurator/types/area-select";

import { carryOverBuildingEdits } from "./buildingEdits";

const grid = (...osmIds: string[]): PylovoGridData =>
    ({
        buildings: {
            type: "FeatureCollection",
            features: osmIds.map((osm_id) => ({ type: "Feature", geometry: null, properties: { osm_id, f_class: "house" } })),
        },
    }) as unknown as PylovoGridData;

describe("carryOverBuildingEdits", () => {
    it("keeps techs, heat supplier and BuEM edits of buildings still in the grid", () => {
        const previous = [
            new Feature({ osm_id: "1", techs: { pv_supply: { alias: "PV" } }, heat_supplier: "7", buem: { building: {} } }),
            new Feature({ osm_id: "2", techs: { battery: {} } }),
            new Feature({ osm_id: "3" }),
        ];

        const next = carryOverBuildingEdits(previous, grid("1", "3", "4"));
        const props = next.buildings!.features.map((f) => f.properties);

        expect(props[0]).toEqual({ osm_id: "1", f_class: "house", techs: { pv_supply: { alias: "PV" } }, heat_supplier: "7", buem: { building: {} } });
        expect(props[1]).toEqual({ osm_id: "3", f_class: "house" });
        expect(props[2]).toEqual({ osm_id: "4", f_class: "house" });
    });

    it("keeps a building disabled across regeneration", () => {
        const next = carryOverBuildingEdits([new Feature({ osm_id: "1", activated: false })], grid("1", "2"));
        expect(next.buildings!.features.map((f) => f.properties)).toEqual([
            { osm_id: "1", f_class: "house", activated: false },
            { osm_id: "2", f_class: "house" },
        ]);
    });

    it("returns the grid unchanged when nothing was edited", () => {
        const next = grid("1");
        expect(carryOverBuildingEdits([new Feature({ osm_id: "1" })], next)).toBe(next);
    });

    describe("across a grid mode switch", () => {
        // A square of side 0.0002 degrees with its south-west corner at (lon, lat).
        const ring = (lon: number, lat: number) => [[lon, lat], [lon + 0.0002, lat], [lon + 0.0002, lat + 0.0002], [lon, lat + 0.0002], [lon, lat]];
        const mapBuilding = (lon: number, lat: number, props: Record<string, unknown>) =>
            new Feature({ ...props, geometry: new Polygon([ring(lon, lat).map((c) => fromLonLat(c))]) });
        const dataGrid = (...buildings: [string, number, number][]): PylovoGridData =>
            ({
                buildings: {
                    type: "FeatureCollection",
                    features: buildings.map(([osm_id, lon, lat]) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring(lon, lat)] }, properties: { osm_id } })),
                },
            }) as unknown as PylovoGridData;

        const previous = [
            mapBuilding(8.4230, 48.1015, { osm_id: "10", techs: { air_source_heat_pump: {} }, buem: { building: {} } }),
            mapBuilding(8.4240, 48.1015, { osm_id: "11", techs: { pv_supply: {} }, heat_supplier: "10" }),
            mapBuilding(8.4250, 48.1015, { osm_id: "12", activated: false }),
        ];

        it("gives each building the edits of the earlier building it lies in", () => {
            const next = carryOverBuildingEdits(previous, dataGrid(["c2t:a", 8.42301, 48.10151], ["c2t:b", 8.42401, 48.10151], ["c2t:c", 8.42501, 48.10151], ["c2t:d", 8.4260, 48.1015]));
            expect(next.buildings!.features.map((f) => f.properties)).toEqual([
                { osm_id: "c2t:a", techs: { air_source_heat_pump: {} } },
                { osm_id: "c2t:b", techs: { pv_supply: {} }, heat_supplier: "c2t:a" },
                { osm_id: "c2t:c", activated: false },
                { osm_id: "c2t:d" },
            ]);
        });

        it("gives every part of a split building its technologies", () => {
            const next = carryOverBuildingEdits(previous, dataGrid(["c2t:a1", 8.42301, 48.10151], ["c2t:a2", 8.42305, 48.10155]));
            expect(next.buildings!.features.map((f) => f.properties?.techs)).toEqual([{ air_source_heat_pump: {} }, { air_source_heat_pump: {} }]);
        });
    });
});

