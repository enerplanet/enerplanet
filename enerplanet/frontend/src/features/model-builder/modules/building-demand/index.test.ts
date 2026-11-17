/**
 * `building-demand`'s tests.
 *
 * Written failing first.
 *
 * The estimate arrives through a slot, so every case here installs a fake and asserts what the module *does
 * with the answers*: one request per building, both vectors filled, the merge that leaves another module's
 * vector alone, and the flags that say where each number came from.
 *
 * The heat mirror gets its own cases, and they are mostly about the *table* — it is a deliberate copy of
 * backend defaults, so the rates are the part that has to be right. A mirror that is merely close is worse
 * than none: it disagrees exactly where nobody looks.
 *
 * (The rules the core enforces are demonstrated in the example module's tests. This file is about *this*
 * module.)
 */
import { describe, expect, it, beforeEach } from "vitest";
import { contractIssues, runInScratch, type ModelData } from "@model-builder/core";
import buildingDemand, { attributesOf, issuesFor, osmIdOf } from "./index";
import { setDemandSource, type DemandEstimate, type DemandEstimateSource } from "./source";
import {
  estimateYearlyHeatDemand,
  isZeroHeatDemandClass,
  normalizeFClass,
  specificHeatDemand,
} from "./heat";

const ELECTRICITY = "electricity";
const HEAT = "heat";
/** The port this module writes, named once so the cases speak about the same thing. */
const PARAMS = "buildingParams";

/** A feature as the grid writes them, with only the properties a case cares about. */
function building(osmId: string, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osm_id: osmId, building_type: "residential", area_m2: 120, ...props },
    geometry: { type: "Point", coordinates: [8.6, 49.4] },
  };
}

/** The buildings a run starts from. */
function withBuildings(...features: GeoJSON.Feature[]): Partial<ModelData> {
  return { buildings: { type: "FeatureCollection", features } };
}

/** A source that answers from a table, and remembers what it was asked. */
function fakeSource(
  answers: Record<string, Partial<DemandEstimate>> = {},
): DemandEstimateSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async estimate(attributes) {
      asked.push(attributes.buildingType);
      return {
        fClass: "residential",
        yearlyKwh: 12_000,
        peakKw: 4,
        ...(answers[attributes.buildingType] ?? {}),
      };
    },
  };
}

beforeEach(() => {
  setDemandSource(null);
});

describe("building-demand's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(buildingDemand)).toEqual([]);
  });

  it("declares itself an automatic step — nothing for the user to collect", () => {
    expect(buildingDemand.module.auto).toBe(true);
  });

  it("requires the grid, and declares what it can affect without writing it", () => {
    expect(
      buildingDemand.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["buildings"]);
    // `weatherSelection` is declared but never read: a weather change invalidates these params, and a module
    // must know every port its writes can affect. Declaring is not claiming to write.
    expect(buildingDemand.module.params.map((param) => param.port).sort()).toEqual([
      PARAMS,
      "buildings",
      "weatherSelection",
    ]);
  });

  it("declares both edges it actually has, and leaves transitivity to the module that owns it", () => {
    expect([...buildingDemand.module.affect.buildings!]).toEqual(["buildingParams"]);
    expect([...buildingDemand.module.affect.weatherSelection!]).toEqual(["buildingParams"]);
    // The step to `technologies` belongs to that module's own declaration (it carries it onward).
    expect(buildingDemand.module.affect.buildingParams).toBeUndefined();
  });
});

describe("building-demand's run", () => {
  it("asks for one building at a time — the legacy's real behaviour, not the batch endpoint", async () => {
    const source = fakeSource();
    setDemandSource(source);

    await runInScratch({ module: buildingDemand.module, mock: withBuildings(building("b1"), building("b2")) });

    expect(source.asked).toHaveLength(2);
  });

  it("fills both vectors, and says where each number came from", async () => {
    setDemandSource(fakeSource());

    const { store, error } = await runInScratch({
      module: buildingDemand.module,
      mock: withBuildings(building("b1")),
    });

    expect(error).toBeUndefined();
    // electricity: from the service, flagged as an estimate.
    expect(store.data.buildingParams?.[ELECTRICITY]?.b1).toMatchObject({
      fClass: "residential",
      yearlyKwh: 12_000,
      peakKw: 4,
      source: "estimate",
    });
    // heat: the module's own mirror of the backend's defaults, flagged as such.
    expect(store.data.buildingParams?.[HEAT]?.b1?.yearlyKwh).toBe(10_800); // 120 m² × 90 (residential)
    expect(store.data.buildingParams?.[HEAT]?.b1?.source).toBe("mirror");
    expect(store.data.buildingParams?.[HEAT]?.b1?.peakKw).toBe(0);
  });

  it("skips a building with no usable area, rather than inventing one", async () => {
    const source = fakeSource();
    setDemandSource(source);

    const { store } = await runInScratch({
      module: buildingDemand.module,
      mock: withBuildings(building("b1"), building("b2", { area_m2: 0 })),
    });

    expect(source.asked).toHaveLength(1);
    expect(store.data.buildingParams?.[ELECTRICITY]?.b2).toBeUndefined();
    // …and the gate reports it, so the node does not read as finished.
    expect(issuesFor(store.data).map((issue) => issue.port)).toEqual([PARAMS]);
  });

  it("merges into the port, leaving another module's vector alone", async () => {
    setDemandSource(fakeSource());
    const existing = { gas: { b1: { yearlyKwh: 500 } } };

    const { store } = await runInScratch({
      module: buildingDemand.module,
      mock: { ...withBuildings(building("b1")), buildingParams: existing },
    });

    // The vector set is open: replacing the whole port would throw someone else's work away.
    expect(store.data.buildingParams?.gas?.b1?.yearlyKwh).toBe(500);
  });

  it("says so plainly when no host installed a source", async () => {
    const { error } = await runInScratch({
      module: buildingDemand.module,
      mock: withBuildings(building("b1")),
    });

    expect(error?.message).toContain("no estimate source");
  });
});

describe("building-demand's gate", () => {
  it("reports buildings whose demand is missing, and says nothing before a run", () => {
    expect(issuesFor({})).toEqual([]); // nothing written yet: the node is pending, not stale
    expect(issuesFor({ ...withBuildings(building("b1")) })).toEqual([
      { port: PARAMS, message: "1 building(s) have no demand yet." },
    ]);
  });

  it("is satisfied once every building has both vectors", () => {
    const params = {
      [ELECTRICITY]: { b1: { yearlyKwh: 1 } },
      [HEAT]: { b1: { yearlyKwh: 1 } },
    };
    expect(issuesFor({ ...withBuildings(building("b1")), buildingParams: params })).toEqual([]);
  });
});

describe("reading the features", () => {
  it("takes the id from osm_id, and falls back to the feature id", () => {
    expect(osmIdOf(building("b1"))).toBe("b1");
    expect(osmIdOf({ type: "Feature", id: 7, properties: {}, geometry: { type: "Point", coordinates: [0, 0] } })).toBe("7");
    expect(osmIdOf({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } })).toBeUndefined();
  });

  it("reads the attributes the estimate needs, and refuses a building without an area", () => {
    expect(attributesOf(building("b1", { area_m2: 80, num_floors: 3, construction_year: 1970 }))).toEqual({
      buildingType: "residential",
      areaM2: 80,
      numFloors: 3,
      yearOfConstruction: 1970,
    });
    expect(attributesOf(building("b1", { area_m2: 0 }))).toBeUndefined();
    // pylovo properties are untrusted JSON: strings that hold numbers are numbers.
    expect(attributesOf(building("b1", { area_m2: "150" }))?.areaM2).toBe(150);
  });

  it("falls back to the legacy's alternate property names", () => {
    // `area_m2` cleared so the spread's default cannot win: this is the fallback path, and it only runs when
    // the primary name is genuinely absent.
    const legacy = building("b1", {
      area_m2: undefined,
      area: 90,
      floors: 2,
      year_of_construction: 1990,
    });
    expect(attributesOf(legacy)).toMatchObject({ areaM2: 90, numFloors: 2, yearOfConstruction: 1990 });
  });
});

describe("the heat mirror", () => {
  it("normalises classes the way the backend does", () => {
    expect(normalizeFClass("Town House")).toBe("town_house");
    expect(normalizeFClass("semi-detached")).toBe("semi_detached");
  });

  it("knows which classes mean no heating demand", () => {
    expect(isZeroHeatDemandClass("garage")).toBe(true);
    expect(isZeroHeatDemandClass("Shed")).toBe(true);
    expect(isZeroHeatDemandClass("apartment")).toBe(false);
  });

  it("takes the class rate, then its category, then the fallback", () => {
    expect(specificHeatDemand("apartment")).toBe(90); // table
    expect(specificHeatDemand("hospital")).toBe(200); // table
    expect(specificHeatDemand("some_unknown_public_thing")).toBe(80); // category: public
    expect(specificHeatDemand("")).toBe(80); // fallback — an unknown use is still heated
  });

  it("scales by area, and reports zero for a class that means no demand", () => {
    expect(estimateYearlyHeatDemand("apartment", 100)).toEqual({ kwh: 9_000, estimated: true });
    expect(estimateYearlyHeatDemand("garage", 100)).toEqual({ kwh: 0, estimated: false });
    expect(estimateYearlyHeatDemand("apartment", undefined)).toEqual({ kwh: 0, estimated: false });
  });

  it("prefers a user's own value, and does not call it an estimate", () => {
    // The legacy's `heat_demand_estimated` distinction, which is why this returns two things.
    expect(estimateYearlyHeatDemand("apartment", 100, 5_000)).toEqual({ kwh: 5_000, estimated: false });
  });
});
