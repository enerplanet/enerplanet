import { describe, expect, it } from "vitest";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { applyToBuildings, dropTargets, productsInUse, removeProduct } from "./useTechDragDrop";

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

describe("productsInUse", () => {
  it("lists a technology that only some buildings have", () => {
    expect(productsInUse(buildings()).sort()).toEqual(["air_source_heat_pump", "battery_storage", "pv_supply"]);
  });

  it("lists the product a building names, not its type", () => {
    const facade = building({ techs: { pv_supply: { alias: "Facade 400 W", product: "pv_facade_400" } } });
    expect(productsInUse([facade, ...buildings()]).sort()).toEqual(["air_source_heat_pump", "battery_storage", "pv_facade_400", "pv_supply"]);
  });
});

describe("removeProduct", () => {
  it("removes the product only from the buildings that carry it", () => {
    const facade = building({ techs: { pv_supply: { alias: "Facade 400 W", product: "pv_facade_400" } } });
    const all = [facade, ...buildings()];
    expect(removeProduct(all, { key: "pv_supply", product: "pv_facade_400" })).toBe(1);
    expect(facade.get("techs")).toEqual({});
    expect(all[1].get("techs").pv_supply).toBeDefined();
  });

  it("removes the type's default product from buildings that name no product", () => {
    const all = buildings();
    expect(removeProduct(all, { key: "pv_supply", product: "pv_supply" })).toBe(1);
    expect(all[0].get("techs").pv_supply).toBeUndefined();
  });
});

describe("dropTargets", () => {
  const grid = () => ["1", "2", "3"].map((osm_id) => building({ osm_id, techs: {} }));

  it("targets every selected building when the drop lands on one of them", () => {
    const all = grid();
    expect(dropTargets(all[0], new Set(["1", "3"]), all)).toEqual([all[0], all[2]]);
  });

  it("targets only the dropped building when it is not selected", () => {
    const all = grid();
    expect(dropTargets(all[1], new Set(["1", "3"]), all)).toEqual([all[1]]);
  });

  it("targets only the dropped building when nothing is selected", () => {
    const all = grid();
    expect(dropTargets(all[0], new Set(), all)).toEqual([all[0]]);
  });
});
