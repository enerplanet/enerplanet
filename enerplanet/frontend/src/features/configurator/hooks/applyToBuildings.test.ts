import { describe, expect, it } from "vitest";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { applyToBuildings, techKeysInUse } from "./useTechDragDrop";

const building = (props: Record<string, unknown>) => new Feature({ geometry: new Point([0, 0]), feature_type: "building", ...props });
const boiler = { alias: "Gas boiler", constraints: [] };

const buildings = () => [
  building({ techs: { air_source_heat_pump: { alias: "Heat pump" }, pv_supply: { alias: "PV" } } }),
  building({ techs: {}, heat_supplier: "1001832407" }),
  building({ techs: { battery_storage: { alias: "Battery" } } }),
];

describe("applyToBuildings", () => {
  it("adds a heat supply only where a building has none", () => {
    const [withPump, linked, bare] = buildings();

    expect(applyToBuildings([withPump, linked, bare], "gas_boiler", boiler, "missing")).toBe(1);

    expect(Object.keys(withPump.get("techs"))).toEqual(["air_source_heat_pump", "pv_supply"]);
    expect(linked.get("techs")).toEqual({});
    expect(Object.keys(bare.get("techs"))).toEqual(["battery_storage", "gas_boiler"]);
  });

  it("replaces every building's heat supply and heat link, keeping other technologies", () => {
    const [withPump, linked, bare] = buildings();

    expect(applyToBuildings([withPump, linked, bare], "gas_boiler", boiler, "replace")).toBe(3);

    expect(Object.keys(withPump.get("techs"))).toEqual(["pv_supply", "gas_boiler"]);
    expect(linked.get("heat_supplier")).toBeUndefined();
    expect(Object.keys(linked.get("techs"))).toEqual(["gas_boiler"]);
  });

  it("puts a technology that is not a heat supply on every building", () => {
    expect(applyToBuildings(buildings(), "pv_supply", { alias: "PV" }, "missing")).toBe(3);
  });
});

describe("techKeysInUse", () => {
  it("lists a technology that only some buildings have", () => {
    expect(techKeysInUse(buildings()).sort()).toEqual(["air_source_heat_pump", "battery_storage", "pv_supply"]);
  });
});
