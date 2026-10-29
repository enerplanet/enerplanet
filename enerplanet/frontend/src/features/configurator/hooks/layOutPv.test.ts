import { describe, expect, it, vi } from "vitest";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { fromLonLat } from "ol/proj";

const { fetchBestFitArrays } = vi.hoisted(() => ({ fetchBestFitArrays: vi.fn() }));
vi.mock("@/features/configurator/building-config/pvBestFit", () => ({ fetchBestFitArrays }));

import { layOutPv } from "./useTechDragDrop";

const pvBuilding = (osmId: string) =>
  new Feature({ geometry: new Point(fromLonLat([12.9, 48.8])), feature_type: "building", osm_id: osmId, techs: { pv_supply: { alias: "PV" } } });
const array = { surface_id: "r", tilt: 35, azimuth: 180, area: 40, usable_share: 0.6, modules: 12, capacity_kw: 4.8 };

describe("layOutPv", () => {
  it("stores each building's best fit, reuses the resolved country and counts the buildings it could not lay out", async () => {
    fetchBestFitArrays.mockImplementation(async (osmId: string) => {
      if (osmId === "bad") throw new Error("no 3D data");
      return { country: "germany", arrays: [array] };
    });
    const buildings = ["1", "2", "3", "bad", "5"].map(pvBuilding);

    expect(await layOutPv(buildings, 0.6, "EPSG:3857")).toBe(1);

    expect(buildings[0].get("techs").pv_supply).toEqual({ alias: "PV", arrays: [array] });
    expect(buildings[3].get("techs").pv_supply.arrays).toBeUndefined();
    const [, place, share] = fetchBestFitArrays.mock.calls[0];
    expect(place.lon).toBeCloseTo(12.9, 6);
    expect(place.lat).toBeCloseTo(48.8, 6);
    expect(share).toBe(0.6);
    // Once a building has resolved the country, later ones are asked for by it.
    expect(fetchBestFitArrays.mock.calls.at(-1)?.[1]).toEqual({ country: "germany" });
  });
});
