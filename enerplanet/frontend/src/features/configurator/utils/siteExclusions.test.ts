import { describe, expect, it } from "vitest";
import { Feature } from "ol";
import { Point } from "ol/geom";

import type { PylovoGridData } from "@/features/configurator/types/area-select";
import type { SiteStation } from "@/features/configurator/utils/siteStations";
import { disabledOsmIds, exclusionChanges, insideArea, keepDisabledBuildings, withoutAssignments } from "./siteExclusions";

const building = (osmId: string, props: Record<string, unknown> = {}, at: [number, number] = [8.42, 48.1]) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[at, [at[0] + 0.0001, at[1]], [at[0], at[1] + 0.0001], at]] },
  properties: { osm_id: osmId, ...props },
});

const onMap = (osmId: string, disabled = false) => {
  const f = new Feature(new Point([0, 0]));
  f.set("osm_id", osmId);
  if (disabled) f.set("activated", false);
  return f;
};

const grid = (...features: ReturnType<typeof building>[]): PylovoGridData =>
  ({ buildings: { type: "FeatureCollection", features } }) as unknown as PylovoGridData;

describe("exclusionChanges", () => {
  it("lists the buildings disabled or enabled since the grid was generated", () => {
    const generated = [building("1"), building("2", { activated: false }), building("3")].map((f) => f);
    const current = [onMap("1", true), onMap("2"), onMap("3")];
    expect(exclusionChanges(generated, current)).toEqual([
      { osm_id: "1", excluded: true },
      { osm_id: "2", excluded: false },
    ]);
  });

  it("is empty when the buildings are back to the generated set", () => {
    const generated = [building("1"), building("2", { activated: false })];
    expect(exclusionChanges(generated, [onMap("1"), onMap("2", true)])).toEqual([]);
  });
});

describe("disabledOsmIds", () => {
  it("returns the osm ids of the disabled buildings on the map", () => {
    expect(disabledOsmIds([onMap("1", true), onMap("2"), onMap("c2t:DEBW_1", true)])).toEqual(new Set(["1", "c2t:DEBW_1"]));
  });
});

describe("withoutAssignments", () => {
  const station = (ids: number[]): SiteStation => ({
    transformer_id: 5, geom: { type: "Point", coordinates: [8.42, 48.1] }, rated_kva: 160, cost_eur: null, assigned_building_ids: ids,
  });

  it("takes the buildings off the stations they are fixed to", () => {
    expect(withoutAssignments([station([1, 2, 3])], [2])?.[0].assigned_building_ids).toEqual([1, 3]);
  });

  it("returns null when none of the buildings is fixed to a station", () => {
    expect(withoutAssignments([station([1])], [2])).toBeNull();
  });
});

describe("keepDisabledBuildings", () => {
  it("adds back the disabled buildings the regenerated grid left out, without their transformer", () => {
    const previous = grid(building("1", { grid_result_id: 9, building_id: 1 }), building("2", { grid_result_id: 9 }));
    const next = grid(building("2", { grid_result_id: 11 }));
    const kept = keepDisabledBuildings(previous, next, new Set(["1"]));
    const props = kept.buildings?.features?.map((f) => f.properties);
    expect(props).toEqual([{ osm_id: "2", grid_result_id: 11 }, { osm_id: "1", activated: false }]);
  });

  it("drops the kept building's feature id, which the regenerated grid may reuse", () => {
    const previous = grid({ ...building("1"), id: "0" } as ReturnType<typeof building>);
    const next = grid({ ...building("2"), id: "0" } as ReturnType<typeof building>);
    const kept = keepDisabledBuildings(previous, next, new Set(["1"]));
    expect(kept.buildings?.features?.map((f) => (f as { id?: unknown }).id)).toEqual(["0", undefined]);
  });

  it("leaves out a disabled building that fails the area test", () => {
    const previous = grid(building("1"));
    const kept = keepDisabledBuildings(previous, grid(), new Set(["1"]), () => false);
    expect(kept.buildings?.features).toEqual([]);
  });
});

describe("insideArea", () => {
  const area: [number, number][][] = [[[8.4, 48.0], [8.5, 48.0], [8.5, 48.2], [8.4, 48.2]]];

  it("tests a building in lon/lat against the drawn area", () => {
    const test = insideArea(area, "EPSG:4326");
    expect(test(building("1", {}, [8.42, 48.1]))).toBe(true);
    expect(test(building("2", {}, [9.0, 48.1]))).toBe(false);
  });
});
