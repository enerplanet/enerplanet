import { describe, expect, it } from "vitest";
import { adaptBuemFeature } from "@thd-spatial-ai/building-configurator";

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

// A block saved with 300 m2 in total, as configurators before 0.14 saved it: without a storey count.
const savedWithoutStoreys = () => toStoredBuem(adaptBuemFeature({
  type: "Feature",
  id: "268425674",
  geometry: footprint,
  properties: { buem: { building: { building_type: "SFH", A_ref: { value: 300, unit: "m2" }, envelope: { elements: [wall] } } } },
}));

describe("stored BuEM", () => {
  it("reopens an edited building with its envelope and solver", () => {
    const stored = toStoredBuem(opened);

    const reopened = fromStoredBuem("268425674", footprint, stored);

    expect(stored.solver).toEqual({ use_milp: false });
    expect(Object.keys(reopened.envelope)).toEqual(Object.keys(opened.envelope));
    expect(reopened.envelope.w1).toMatchObject({ uValue: 0.18, area: 40 });
  });

  it("reopens a building saved with the old technology state", () => {
    const legacy = { ...toStoredBuem(opened), technology_state: { pvArrays: [], battery: { installed: true } } };

    const reopened = fromStoredBuem("268425674", footprint, legacy);

    expect(reopened.envelope.w1).toMatchObject({ uValue: 0.18, area: 40 });
    expect(toStoredBuem(reopened)).not.toHaveProperty("technology_state");
  });

  it("keeps the construction year beside the block across save and reopen", () => {
    const withYear = adaptBuemFeature({
      type: "Feature",
      id: "268425674",
      geometry: footprint,
      properties: { buem: { building: { building_type: "SFH", envelope: { elements: [wall] } }, construction_year: 1968 } },
    });

    const stored = toStoredBuem(withYear);
    const reopened = toStoredBuem(fromStoredBuem("268425674", footprint, stored));

    expect(stored.construction_year).toBe(1968);
    expect(stored.building).not.toHaveProperty("construction_period");
    expect(reopened.construction_year).toBe(1968);
  });

  it("reopens a block saved without its storey count with City2TABULA's count", () => {
    const { identity } = fromStoredBuem("268425674", footprint, savedWithoutStoreys(), 3);

    expect(identity.storeys).toBe(3);
    expect(identity.floorArea).toBe(300);
  });

  it("keeps a stored storey count over City2TABULA's", () => {
    const saved = savedWithoutStoreys();
    const stored = { ...saved, building: { ...saved.building, n_storeys: 2 } };

    expect(fromStoredBuem("268425674", footprint, stored, 3).identity.storeys).toBe(2);
  });

  it("reopens a building at its footprint's location", () => {
    expect(fromStoredBuem("268425674", footprint, toStoredBuem(opened)).identity.coordinates).toEqual([6.02, 52.1]);
  });

  it("finds nothing stored on a building nobody edited", () => {
    expect(storedBuemOf({ osm_id: "1", f_class: "house" })).toBeNull();
    expect(storedBuemOf(undefined)).toBeNull();
  });
});
