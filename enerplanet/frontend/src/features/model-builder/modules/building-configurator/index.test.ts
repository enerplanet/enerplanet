/**
 * `building-configurator` in isolation.
 *
 * **Nothing here touches the legacy, the npm package, or a DOM.** That is the point of the slot in `view.ts`:
 * the module hands a view a typed set of props and takes back an edit, so a test can stand in a stub that does
 * nothing and exercise everything the module actually owns — the merge onto the two ports, the gate, and the
 * rule that only a close commits.
 *
 * The view's *content* (a 3D envelope, a technologies tab, geometry fetched from a dataset) is not this
 * module's behaviour and is not tested here. The real `Building3DView` is installed by the shell, and what it
 * renders is the package's business.
 *
 * The edits are driven through `holdEdit`, the same door the module's own overlay uses.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type BuildingParams,
  type ModelData,
  type TechAssignment,
} from "@model-builder/core";

import buildingConfiguratorModule, { holdEdit, issuesFor } from "./index";
import { buildingConfigurator, setBuildingConfigurator } from "./view";

const ELECTRICITY = "electricity";
const HEAT = "heat";

beforeEach(() => {
  // A stub, not the package: this is what proves the seam is a seam.
  setBuildingConfigurator({ View: () => null });
});

/** A building as the grid writes them. */
function building(osmId: string, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osm_id: osmId, building_type: "residential", area_m2: 120, ...props },
    geometry: { type: "Point", coordinates: [8.6, 49.4] },
  };
}

/** What a run starts from: two buildings, and demand on the first only. */
function ready(): Partial<ModelData> {
  return {
    buildings: { type: "FeatureCollection", features: [building("b1"), building("b2")] },
    buildingParams: {
      electricity: { b1: { fClass: "residential", yearlyKwh: 12_000, peakKw: 4 } },
      heat: { b1: { fClass: "residential", yearlyKwh: 10_800, peakKw: 0, source: "mirror" } },
    },
  };
}

const BOILER: TechAssignment[] = [
  { techId: "gas_boiler", inputVector: "gas", outputVector: "heat", source: "user" },
];

describe("building-configurator's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(buildingConfiguratorModule)).toEqual([]);
  });

  it("requires the grid and declares both ports it writes", () => {
    const ports = buildingConfiguratorModule.module.params.map((param) => param.port);

    // The buildings arrive with the grid; the demand is a baseline the module may adopt rather than invent.
    expect(buildingConfiguratorModule.module.params.find((p) => p.port === "buildings")?.required).toBe(true);
    expect(buildingConfiguratorModule.module.params.find((p) => p.port === "buildingParams")?.required).toBeUndefined();
    // Declaring a port is not writing it — but an `affect` output must be declared, so both are here.
    expect(ports).toContain("technologies");
  });

  it("claims both consequences of a redrawn grid, and pairs its own two writes", () => {
    expect([...buildingConfiguratorModule.module.affect.buildings!].sort()).toEqual([
      "buildingParams",
      "technologies",
    ]);
    // It writes the pair together, so a demand change moves the technologies with it.
    expect([...buildingConfiguratorModule.module.affect.buildingParams!]).toEqual(["technologies"]);
  });

  it("takes all four regions the spec gives it", () => {
    expect([...buildingConfiguratorModule.module.layout]).toEqual(["map", "overlay", "sidebar", "bottom"]);
  });
});

describe("the host slot", () => {
  it("hands out whatever the shell installed, and nothing before that", () => {
    setBuildingConfigurator(null);
    expect(buildingConfigurator()).toBeNull();

    const View = () => null;
    setBuildingConfigurator({ View });
    expect(buildingConfigurator()?.View).toBe(View);
  });
});

describe("building-configurator's run", () => {
  it("merges an edit onto the demand it already had, leaving other fields alone", async () => {
    holdEdit("b1", { params: { yearlyKwh: 15_000 } });

    const { store, error } = await runInScratch({ module: buildingConfiguratorModule.module, mock: ready() });

    expect(error).toBeUndefined();
    expect(store.data.buildingParams?.[ELECTRICITY]?.b1).toEqual({
      fClass: "residential",
      yearlyKwh: 15_000,
      peakKw: 4,
    });
  });

  it("leaves the buildings the user never opened exactly as they were", async () => {
    holdEdit("b1", { params: { yearlyKwh: 15_000 } });

    const { store } = await runInScratch({ module: buildingConfiguratorModule.module, mock: ready() });

    // b2 had no demand; the edit was for b1, so nothing may appear for it.
    expect(store.data.buildingParams?.[ELECTRICITY]?.b2).toBeUndefined();
    expect(store.data.buildings?.features).toHaveLength(2);
  });

  it("does not invent a heat entry for a building that had none", async () => {
    holdEdit("b2", { params: { yearlyKwh: 9_000 } });

    const { store } = await runInScratch({ module: buildingConfiguratorModule.module, mock: ready() });

    expect(store.data.buildingParams?.[ELECTRICITY]?.b2).toEqual({ yearlyKwh: 9_000 });
    // Inventing one would claim a heat demand the demand step never found.
    expect(store.data.buildingParams?.[HEAT]?.b2).toBeUndefined();
  });

  it("writes the technologies the view returned for that building only", async () => {
    holdEdit("b1", { technologies: BOILER });

    const { store } = await runInScratch({ module: buildingConfiguratorModule.module, mock: ready() });

    expect(store.data.technologies?.b1).toEqual(BOILER);
    expect(store.data.technologies?.b2).toBeUndefined();
  });

  it("clears a building's technologies when the view returned an empty list", async () => {
    // Removing the last technology is a real answer, not the absence of one: the entry goes, so the save's
    // fold writes an empty array rather than the old one.
    holdEdit("b1", { technologies: [] });
    const withTechs = { ...ready(), technologies: { b1: BOILER } };

    const { store } = await runInScratch({ module: buildingConfiguratorModule.module, mock: withTechs });

    expect(store.data.technologies?.b1).toBeUndefined();
  });

  it("does nothing when the view was closed without a change", async () => {
    // The module is reachable through the forward action, and pressing it without opening a building must not
    // fail — nor invent a transaction.
    const { store, error } = await runInScratch({ module: buildingConfiguratorModule.module, mock: ready() });

    expect(error).toBeUndefined();
    expect(store.data.buildingParams?.electricity?.b1?.yearlyKwh).toBe(12_000);
  });

  it("consumes the edit, so a second run commits nothing", async () => {
    // One store, two runs — a second scratch store would start empty and prove nothing.
    const store = createStore({ ...ready() });
    const engine = createEngine(store);

    holdEdit("b1", { params: { yearlyKwh: 15_000 } });
    await engine.runModule(buildingConfiguratorModule.module, { id: buildingConfiguratorModule.module.id });
    expect(store.data.buildingParams?.[ELECTRICITY]?.b1?.yearlyKwh).toBe(15_000);

    // Nothing is held now. A run that committed anyway would produce a new projection; identity is the proof
    // that it did nothing at all.
    const before = store.data.buildingParams;
    await engine.runModule(buildingConfiguratorModule.module, { id: buildingConfiguratorModule.module.id });
    expect(store.data.buildingParams).toBe(before);
  });
});

describe("building-configurator's gate", () => {
  it("reports a building with neither demand nor technologies", () => {
    // b2 has nothing at all, which is the incompleteness this module can name — it is the one writing both.
    expect(issuesFor(ready() as ModelData)).toEqual([
      { port: "buildingParams", message: "A building has neither demand nor technologies." },
    ]);
  });

  it("is satisfied when every building has demand", () => {
    const full = {
      ...ready(),
      buildingParams: {
        electricity: {
          b1: { yearlyKwh: 12_000 } as BuildingParams,
          b2: { yearlyKwh: 6_000 } as BuildingParams,
        },
      },
    };

    expect(issuesFor(full as ModelData)).toEqual([]);
  });

  it("counts a technology as enough on its own", () => {
    const techsOnly = {
      ...ready(),
      buildingParams: undefined,
      technologies: { b1: BOILER, b2: BOILER },
    };

    expect(issuesFor(techsOnly as ModelData)).toEqual([]);
  });

  it("says nothing when there are no buildings to judge", () => {
    expect(issuesFor({})).toEqual([]);
  });
});
