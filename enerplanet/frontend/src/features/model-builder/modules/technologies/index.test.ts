/** `technologies`'s tests: one heat per building, the expected-fit table, and `estimated` flagging. */
import { describe, expect, it } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type ModelData,
  type TechAssignment,
} from "@model-builder/core";
import technologies, { assign, hasHeatSupply, holdAutoresolve, holdType, issuesFor, osmIdOf } from "./index";
import {
  expectedFitTech,
  HEAT_SUPPLY_TYPES,
  isZeroHeatDemandClass,
  normalizeFClass,
  productType,
  vectorsOfType,
} from "./catalogue";

const NODE = technologies.module.id;
const AUTORESOLVE = "autoresolve";

/** A building as the grid writes them. */
function building(osmId: string, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osm_id: osmId, building_type: "residential", area_m2: 120, ...props },
    geometry: { type: "Point", coordinates: [8.6, 49.4] },
  };
}

/** What a run starts from: the grid, and a demand figure per vector. */
function ready(heatKwh = 10_800): Partial<ModelData> {
  return {
    buildings: { type: "FeatureCollection", features: [building("b1")] },
    transformers: { type: "FeatureCollection", features: [] },
    buildingParams: {
      electricity: { b1: { fClass: "residential", yearlyKwh: 12_000, peakKw: 4 } },
      heat: { b1: { fClass: "residential", yearlyKwh: heatKwh, peakKw: 0 } },
    },
  };
}

/** The assignments the run left for one building. */
function techsOf(store: { data: ModelData }, osmId = "b1"): TechAssignment[] {
  return store.data.technologies?.[osmId] ?? [];
}

describe("technologies's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(technologies)).toEqual([]);
  });

  it("requires the grid, the transformers and the demand it resolves", () => {
    const required = technologies.module.params
      .filter((param) => param.required === true)
      .map((param) => param.port);

    expect([...required].sort()).toEqual(["buildingParams", "buildings", "transformers"]);
  });

  it("declares both edges it has, leaving transitivity to the module that owns it", () => {
    expect([...technologies.module.affect.buildings!]).toEqual(["technologies"]);
    expect([...technologies.module.affect.buildingParams!]).toEqual(["technologies"]);
    // The step to the save's completeness belongs to the save node's own gate.
    expect(technologies.module.affect.technologies).toBeUndefined();
  });

  it("renders in the sidebar alone, until a building selection exists", () => {
    // Assign-to-all is what the panel can offer until `MapService` supports a selection API.
    expect([...technologies.module.layout]).toEqual(["sidebar"]);
  });
});

describe("technologies's run", () => {
  it("applies a held type to every building, flagged as the user's own choice", async () => {
    holdType(NODE, "pv_supply");

    const { store, error } = await runInScratch({ module: technologies.module, mock: ready() });

    expect(error).toBeUndefined();
    expect(techsOf(store)).toEqual([
      { techId: "pv_supply", outputVector: "electricity", source: "user" },
    ]);
  });

  it("fills heat from the expected-fit table when the toggle is on", async () => {
    holdAutoresolve(NODE, true);

    const { store } = await runInScratch({ module: technologies.module, mock: ready() });

    // `residential` resolves to a gas boiler in the legacy's table, and an autoplaced pick is provisional.
    expect(techsOf(store)).toEqual([
      { techId: "gas_boiler", inputVector: "gas", outputVector: "heat", source: "estimated" },
    ]);
    // The toggle is a setting, so it lands in the settings port.
    expect(store.data.advancedParams?.[AUTORESOLVE]).toBe(true);
  });

  it("refuses a second heat supply — the legacy skips rather than replaces", async () => {
    holdType(NODE, "gas_boiler");
    holdAutoresolve(NODE, true);

    const { store } = await runInScratch({ module: technologies.module, mock: ready() });

    // The user's choice stands and the autoresolve does not stack a second one on top of it.
    expect(techsOf(store)).toHaveLength(1);
    expect(techsOf(store)[0]).toMatchObject({ techId: "gas_boiler", source: "user" });
  });

  it("assigns nothing to a building with no heat demand", async () => {
    holdAutoresolve(NODE, true);

    // A demand of zero — a garage, or a building the demand step found nothing for.
    const { store } = await runInScratch({ module: technologies.module, mock: ready(0) });

    expect(techsOf(store)).toEqual([]);
  });

  it("does not assign the same type twice, however often it is asked", async () => {
    // One store, two runs: a second scratch store would start empty and prove nothing about the dedupe.
    const store = createStore({ ...ready() });
    const engine = createEngine(store);

    holdType(NODE, "pv_supply");
    await engine.runModule(technologies.module, { id: NODE, moduleId: technologies.module.id });
    holdType(NODE, "pv_supply");
    await engine.runModule(technologies.module, { id: NODE, moduleId: technologies.module.id });

    expect(techsOf(store)).toHaveLength(1);
  });
});

describe("technologies's gate", () => {
  it("reports buildings with heat demand but no supply", () => {
    // The completeness the module owns: demand was resolved by something, or the model is not finished.
    expect(issuesFor(ready() as ModelData)).toEqual([
      { port: "technologies", message: "1 building(s) have heat demand but no supply." },
    ]);
  });

  it("is satisfied once every heated building has a supply", () => {
    const solved = {
      ...ready(),
      technologies: { b1: [{ techId: "gas_boiler", outputVector: "heat" as const }] },
    };
    expect(issuesFor(solved as ModelData)).toEqual([]);
  });

  it("asks nothing of a building with no heat demand", () => {
    expect(issuesFor(ready(0) as ModelData)).toEqual([]);
  });

  it("says nothing before the demand it would judge exists", () => {
    expect(issuesFor({})).toEqual([]);
  });
});

describe("the catalogue's arithmetic", () => {
  it("maps each type to the carriers it converts", () => {
    expect(vectorsOfType("pv_supply")).toEqual({ outputVector: "electricity" });
    expect(vectorsOfType("gas_boiler")).toEqual({ inputVector: "gas", outputVector: "heat" });
    expect(vectorsOfType("not_a_technology")).toBeUndefined();
  });

  it("resolves the expected fit from the legacy's table, and its fallback", () => {
    // The table is ported verbatim; these two are its point: a class it knows, and one it does not.
    expect(expectedFitTech("apartment", 10_000)?.techId).toBe("gas_boiler");
    expect(expectedFitTech("house", 10_000)?.techId).toBe("air_source_heat_pump");
    expect(expectedFitTech("something_unlisted", 10_000)?.techId).toBe("gas_boiler");
    // Undefined, not a guess: no heat demand means nothing to resolve.
    expect(expectedFitTech("house", 0)).toBeUndefined();
    expect(expectedFitTech("garage", 10_000)).toBeUndefined();
  });

  it("knows the classes that mean no heating demand", () => {
    expect(isZeroHeatDemandClass("garage")).toBe(true);
    expect(isZeroHeatDemandClass("Shed")).toBe(true);
    expect(isZeroHeatDemandClass("apartment")).toBe(false);
    expect(normalizeFClass("Town House")).toBe("town_house");
  });

  it("takes a product's type from its own field or its key", () => {
    expect(productType({ key: "pv-400", type: "pv_supply", alias: "PV 400" })).toBe("pv_supply");
    expect(productType({ key: "pv_supply", alias: "PV" })).toBe("pv_supply");
  });
});

describe("the assignment rules", () => {
  it("adds a heat supply to a building that has none, and refuses a second", () => {
    const boiler: TechAssignment = { techId: "gas_boiler", outputVector: "heat" };
    const pump: TechAssignment = { techId: "air_source_heat_pump", outputVector: "heat" };

    const once = assign(undefined, boiler);
    expect(once).toHaveLength(1);
    expect(assign(once, pump)).toEqual(once);
    expect(hasHeatSupply(once)).toBe(true);
  });

  it("allows a non-heat technology alongside a heat one", () => {
    const withBoiler = assign(undefined, { techId: "gas_boiler", outputVector: "heat" });
    const withPv = assign(withBoiler, { techId: "pv_supply", outputVector: "electricity" });

    expect(withPv).toHaveLength(2);
  });

  it("counts exactly the legacy's heat types as heat supplies", () => {
    expect(HEAT_SUPPLY_TYPES).toContain("electric_boilers");
    // An air conditioner is in the legacy's heat group but is not a supply, so it must not satisfy the rule.
    expect(HEAT_SUPPLY_TYPES).not.toContain("air_conditioner");
  });

  it("reads the id from osm_id, and falls back to the feature id", () => {
    expect(osmIdOf(building("b1"))).toBe("b1");
    expect(osmIdOf({ type: "Feature", id: 7, properties: {}, geometry: { type: "Point", coordinates: [0, 0] } })).toBe("7");
  });
});
