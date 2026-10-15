import { describe, expect, it } from "vitest";
import { Feature } from "ol";

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

    it("returns the grid unchanged when nothing was edited", () => {
        const next = grid("1");
        expect(carryOverBuildingEdits([new Feature({ osm_id: "1" })], next)).toBe(next);
    });
});
