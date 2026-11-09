import { describe, expect, it } from "vitest";

import { iconTechKeys } from "./mapStyleUtils";

describe("iconTechKeys", () => {
  it("leaves out PV placed on no surface", () => {
    expect(iconTechKeys({ pv_supply: { arrays: [] }, battery_storage: {} })).toEqual(["battery_storage"]);
  });

  it("keeps PV on at least one surface, or still awaiting its best fit", () => {
    expect(iconTechKeys({ pv_supply: { arrays: [{ surface_id: "r" }] } })).toEqual(["pv_supply"]);
    expect(iconTechKeys({ pv_supply: {} })).toEqual(["pv_supply"]);
  });
});
