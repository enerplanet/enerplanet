import { describe, expect, it } from "vitest";

import type { Technology } from "@/features/technologies/services/technologyService";
import { appliesDefault, offeredProducts } from "./ProductPickerDialog";

describe("appliesDefault", () => {
  it("applies PV for one building without asking, whatever the catalogue holds", () => {
    expect(appliesDefault("pv_supply", 2, false)).toBe(true);
  });

  it("asks for PV on all buildings, for the usable roof share", () => {
    expect(appliesDefault("pv_supply", 1, true)).toBe(false);
  });

  it("asks for other types only when they have more than one product", () => {
    expect(appliesDefault("battery_storage", 2, false)).toBe(false);
    expect(appliesDefault("battery_storage", 1, false)).toBe(true);
  });

  it("applies nothing when the type has no product", () => {
    expect(appliesDefault("pv_supply", 0, false)).toBe(false);
  });
});

describe("offeredProducts", () => {
  const product = (key: string, type: string) => ({ key, type, alias: key, constraints: [] }) as unknown as Technology;
  const all = [product("pv_facade_400", "pv_supply"), product("pv_supply", "pv_supply"), product("battery_storage", "battery_storage")];

  it("offers only the dropped product", () => {
    expect(offeredProducts(all, "pv_supply", "pv_facade_400").map((p) => p.key)).toEqual(["pv_facade_400"]);
  });

  it("offers every product of the type, the default first, when none is given", () => {
    expect(offeredProducts(all, "pv_supply").map((p) => p.key)).toEqual(["pv_supply", "pv_facade_400"]);
  });
});
