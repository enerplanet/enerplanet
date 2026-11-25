/** `grid-generation`'s tests: its declaration, and its injected engine. */
import { describe, expect, it } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type Coordinates,
  type ModelData,
} from "@model-builder/core";
import gridGeneration, {
  layerOrderFor,
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
    // `seal` stays at `at-completion`: five ports in one sealed transaction.
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
    // A failed generation leaves no half-built grid behind.
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
    // The verdict a host acts on: what makes the node show as incomplete.
    const { issues } = await runInScratch({
      module: gridGeneration.module,
      mock: { region: REGION },
    });

    expect(issues.map((issue) => issue.port).sort()).toEqual(["coordinates"]);
  });

  it("reports an empty result as unfinished, not as a grid", async () => {
    // An empty grid is reported, not thrown: the node simply never reads as done.
    const empty: GridResult = {
      buildings: { type: "FeatureCollection", features: [] },
      transformers: { type: "FeatureCollection", features: [] },
      lines: { type: "FeatureCollection", features: [] },
      mvLines: { type: "FeatureCollection", features: [] },
      grids: { transformerCount: 0 },
    };
    setGridEngine(recordingEngine(empty));

    const store = createStore({ ...DRAWN });
    await createEngine(store).runModule(gridGeneration.module, { id: gridGeneration.module.id, moduleId: gridGeneration.module.id });

    expect(store.data.buildings?.features).toHaveLength(0); // it did write — the result is real
    // Asked after the run, when this judgement has something to judge.
    expect(gridGeneration.module.validate?.({ store: store.data })).toEqual([
      { port: "buildings", message: "The area yielded no buildings — nothing to model." },
    ]);
  });

  it("asks for nothing once the grid holds buildings", async () => {
    // The gate must not fire on a healthy grid.
    setGridEngine(recordingEngine());

    const store = createStore({ ...DRAWN });
    await createEngine(store).runModule(gridGeneration.module, { id: gridGeneration.module.id, moduleId: gridGeneration.module.id });

    expect(gridGeneration.module.validate?.({ store: store.data })).toEqual([]);
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
    // Regenerating invalidates the work downstream of the grid.
    expect(needsConfirmation({ ...DRAWN, technologies: { electricity: [] } })).toBe(true);
    expect(needsConfirmation({ ...DRAWN, buildingParams: { electricity: {} } })).toBe(true);
  });
});

describe("the layer order", () => {
  // The contract hands back the full layer order, not only this module's layers.
  const AREA = "area-draw-polygons";
  const MINE = ["buildings", "lines", "mvLines", "transformers"];

  it("keeps another module's layer, with ours on top", () => {
    expect(layerOrderFor([AREA])).toEqual([AREA, ...MINE]);
  });

  it("does not name our own layers twice when they are already on the map", () => {
    expect(layerOrderFor([MINE[0], AREA, MINE[3]])).toEqual([AREA, ...MINE]);
  });

  it("is just our own order when nothing else is on the map", () => {
    expect(layerOrderFor([])).toEqual(MINE);
  });
});
