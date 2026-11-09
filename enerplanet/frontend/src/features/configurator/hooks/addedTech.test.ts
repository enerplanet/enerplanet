import { describe, expect, it } from "vitest";

import { addedTech } from "./useTechDragDrop";

const entry = { alias: "PV", icon: "solar-panel", constraints: [] };
const array = { surface_id: "r", tilt: 35, azimuth: 180, area: 40, usable_share: 0.8 };

describe("addedTech", () => {
  it("starts PV added in the building's 3D view on no surface", () => {
    expect(addedTech("pv_supply", entry, undefined, true)).toEqual({ ...entry, arrays: [] });
  });

  it("leaves PV added on the map without arrays, for the best fit", () => {
    expect(addedTech("pv_supply", entry, undefined, false)).toEqual(entry);
  });

  it("keeps the arrays of PV the building already has", () => {
    expect(addedTech("pv_supply", entry, { arrays: [array] }, true)).toEqual({ ...entry, arrays: [array] });
    expect(addedTech("pv_supply", entry, { arrays: [array] }, false)).toEqual({ ...entry, arrays: [array] });
  });

  it("adds no arrays to other technologies", () => {
    expect(addedTech("battery_storage", entry, undefined, true)).toEqual(entry);
  });
});
