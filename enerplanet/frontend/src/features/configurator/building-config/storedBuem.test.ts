import { describe, expect, it } from "vitest";
import { adaptBuemFeature, type TechnologyState } from "@thd-spatial-ai/building-configurator";

import { fromStoredBuem, storedBuemOf, toStoredBuem } from "./storedBuem";

const footprint = {
  type: "Polygon",
  coordinates: [[[6.02, 52.1], [6.021, 52.1], [6.021, 52.101], [6.02, 52.101], [6.02, 52.1]]],
};

const wall = { id: "w1", type: "wall", area: { value: 40, unit: "m2" }, U: { value: 0.18, unit: "W/(m2K)" }, azimuth: { value: 180, unit: "deg" }, tilt: { value: 90, unit: "deg" } };

const opened = adaptBuemFeature({
  type: "Feature",
  id: "268425674",
  geometry: footprint,
  properties: { buem: { building: { building_type: "SFH", n_storeys: 2, envelope: { elements: [wall] } } } },
});

describe("stored BuEM", () => {
  it("reopens an edited building with its envelope, solver and technologies", () => {
    const technologyState = { pvArrays: [], battery: { installed: true } } as unknown as TechnologyState;
    const stored = toStoredBuem({ ...opened, technologyState });

    const reopened = fromStoredBuem("268425674", footprint, stored);

    expect(stored.solver).toEqual({ use_milp: false });
    expect(Object.keys(reopened.envelope)).toEqual(Object.keys(opened.envelope));
    expect(reopened.envelope.w1).toMatchObject({ uValue: 0.18, area: 40 });
    expect(reopened.technologyState).toBe(technologyState);
  });

  it("finds nothing stored on a building nobody edited", () => {
    expect(storedBuemOf({ osm_id: "1", f_class: "house" })).toBeNull();
    expect(storedBuemOf(undefined)).toBeNull();
  });
});
