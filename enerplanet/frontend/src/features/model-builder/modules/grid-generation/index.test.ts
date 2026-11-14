/**
 * `grid-generation`'s tests.
 *
 * Written failing first.
 *
 * The declaration cases pin what this module *is*: it requires the drawn area and the region it sits in, and
 * produces the whole synthetic grid — five ports at once, because a grid of half a network is not a grid.
 * The `affect` cases pin the broad invalidation the spec asks for: *either* input invalidates the **entire**
 * output, so the cascade downstream (building-demand → technologies) can never be reached by a partial
 * rewrite. That is the invalidation the spec calls out, and getting it wrong is how stale demand survives a
 * redrawn area.
 *
 * The engine is **injected**, not reached for, and that is not a test convenience: the spec calls the grid
 * engine a provider slot, so swapping it is part of the contract. These cases swap in a fake and assert what
 * the module writes — and, when the engine fails, what it does *not*.
 *
 * (The rules the core enforces — undeclared writes, clobber, the required gate — are demonstrated in the
 * example module's tests, where the module that exists to show the frame lives. This file is about *this*
 * module.)
 */
import { describe, expect, it } from "vitest";
import { contractIssues, runInScratch, type Coordinates, type ModelData } from "@model-builder/core";
import gridGeneration, {
  needsConfirmation,
  setGridEngine,
  type GridEngine,
  type GridRequest,
  type GridResult,
} from "./index";

/** Karlsruhe-ish; small on purpose, so nothing here depends on a real network. */
const RING: Coordinates = [
  [
    [8.50, 49.30],
    [8.51, 49.30],
    [8.51, 49.31],
    [8.50, 49.31],
    [8.50, 49.30],
  ],
];

/** A region chosen in `model-start`; a grid is generated inside one. */
const REGION = { country: "DE", state: "BW" };

/** What a run starts from: the drawn area and the region. Everything else is what the run adds. */
const DRAWN: Partial<ModelData> = { region: REGION, coordinates: RING };

/** Every port this module produces, in one place, so a case cannot silently stop covering one. */
const PRODUCED = ["buildings", "grids", "lines", "mvLines", "transformers"] as const;

/** A grid with one distinguishable feature per port, so a case can tell which port a value landed on. */
function fakeGrid(): GridResult {
  const point = (id: string): GeoJSON.Feature => ({
    type: "Feature",
    properties: { osm_id: id },
    geometry: { type: "Point", coordinates: [8.50, 49.30] },
  });

  return {
    buildings: { type: "FeatureCollection", features: [point("building-1")] },
    transformers: { type: "FeatureCollection", features: [point("transformer-1")] },
    lines: { type: "FeatureCollection", features: [point("lv-1")] },
    mvLines: { type: "FeatureCollection", features: [point("mv-1")] },
    grids: { transformerCount: 1 },
  };
}

/** The ids of a collection, so a case can assert *which* grid landed on *which* port. */
function ids(collection: GeoJSON.FeatureCollection | undefined): unknown[] {
  return (collection?.features ?? []).map((feature) => feature.properties?.osm_id);
}

/** An engine that remembers what it was asked for. */
function recordingEngine(result: GridResult = fakeGrid()): GridEngine & { requests: GridRequest[] } {
  const requests: GridRequest[] = [];
  return {
    requests,
    generate(request: GridRequest): Promise<GridResult> {
      requests.push(request);
      return Promise.resolve(result);
    },
  };
}

describe("grid-generation's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(gridGeneration)).toEqual([]);
  });

  it("requires the drawn area and the region it sits in", () => {
    const required = gridGeneration.module.params
      .filter((param) => param.required === true)
      .map((param) => param.port);

    expect([...required].sort()).toEqual(["coordinates", "region"]);
  });

  it("declares the five ports of the grid it produces, and nothing beyond what it needs", () => {
    const required = new Set(
      gridGeneration.module.params.filter((param) => param.required === true).map((param) => param.port),
    );
    const produced = gridGeneration.module.params
      .map((param) => param.port)
      .filter((port) => !required.has(port));

    expect([...produced].sort()).toEqual([...PRODUCED]);
  });

  it("says either input invalidates the entire output, not part of it", () => {
    expect([...gridGeneration.module.affect.coordinates!].sort()).toEqual([...PRODUCED]);
    expect([...gridGeneration.module.affect.region!].sort()).toEqual([...PRODUCED]);
  });
});

describe("grid-generation's run", () => {
  it("asks the engine for the drawn area and the region", async () => {
    const engine = recordingEngine();
    setGridEngine(engine);

    await runInScratch({ module: gridGeneration.module, mock: DRAWN });

    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toEqual({ coordinates: RING, region: REGION });
  });

  it("writes all five ports, each with its own part of the grid", async () => {
    setGridEngine(recordingEngine());

    const { store, error } = await runInScratch({ module: gridGeneration.module, mock: DRAWN });

    expect(error).toBeUndefined();
    expect(ids(store.data.buildings)).toEqual(["building-1"]);
    expect(ids(store.data.transformers)).toEqual(["transformer-1"]);
    expect(ids(store.data.lines)).toEqual(["lv-1"]);
    expect(ids(store.data.mvLines)).toEqual(["mv-1"]);
    expect(store.data.grids).toEqual({ transformerCount: 1 });
  });

  it("writes them as one transaction — a grid arrives whole or not at all", async () => {
    // `seal` stays at its `at-completion` default: five ports in one sealed transaction, so no consumer can
    // ever observe a grid with its lines missing. One log entry, carrying all five paths, is the proof.
    setGridEngine(recordingEngine());

    const { store } = await runInScratch({ module: gridGeneration.module, mock: DRAWN });

    expect(gridGeneration.module.seal).toBe("at-completion");
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path).sort()).toEqual([
      "/buildings",
      "/grids",
      "/lines",
      "/mvLines",
      "/transformers",
    ]);
  });

  it("writes nothing when the engine fails", async () => {
    // A failed generation must leave no half-built grid behind: no buildings without their lines, no lines
    // pointing at transformers that were never written.
    setGridEngine({
      generate: () => Promise.reject(new Error("pylovo is unreachable")),
    });

    const { store, error } = await runInScratch({ module: gridGeneration.module, mock: DRAWN });

    expect(error?.message).toBe("pylovo is unreachable");
    expect(store.data.buildings).toBeUndefined();
    expect(store.data.transformers).toBeUndefined();
    expect(store.data.lines).toBeUndefined();
    expect(store.data.mvLines).toBeUndefined();
    expect(store.data.grids).toBeUndefined();
    expect(store.log).toHaveLength(0);
  });

  it("reports what is missing rather than running with nothing to generate from", async () => {
    // The verdict a host acts on: this is what makes the node show as incomplete, and what the save node
    // would turn into "what is missing".
    const { issues } = await runInScratch({
      module: gridGeneration.module,
      mock: { region: REGION },
    });

    expect(issues.map((issue) => issue.port).sort()).toEqual(["coordinates"]);
  });
});

describe("grid-generation's data-loss rule", () => {
  it("asks nothing of a store that has no grid yet", () => {
    expect(needsConfirmation(DRAWN)).toBe(false);
  });

  it("warns when a grid is already there, because generating replaces it", () => {
    expect(needsConfirmation({ ...DRAWN, buildings: fakeGrid().buildings })).toBe(true);
  });

  it("warns when demand or technology work stands on the grid that would go", () => {
    // This is the loss that actually matters, and the one the user cannot see from the button: regenerating
    // invalidates the work *downstream* of the grid.
    expect(needsConfirmation({ ...DRAWN, technologies: { electricity: [] } })).toBe(true);
    expect(needsConfirmation({ ...DRAWN, buildingParams: { electricity: {} } })).toBe(true);
  });
});
