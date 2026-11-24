/** `example-auto`'s tests: its declaration, and its behaviour through the real engine. */
import { describe, expect, it, beforeEach } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type Coordinates,
} from "@model-builder/core";
import exampleAuto, { AREA_SUMMARY_KEY, issuesFor } from "./index";
import { setAreaSummarySource } from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = exampleAuto.module.id;

/** The module's own test data, read back rather than retyped — so this file cannot drift from the mock. */
const MOCK_RINGS: Coordinates = exampleAuto.mock?.coordinates ?? [];

/** A second drawn area, different enough that summarising it produces a different value. */
const OTHER_RINGS: Coordinates = [
  [
    [9.0, 50.0],
    [9.1, 50.0],
    [9.1, 50.1],
  ],
];

/** The one message the module's gate reports, named once so the cases speak about the same thing. */
const MISSING_AREA = "No area has been drawn yet.";

beforeEach(() => {
  // Every case starts from the example's own source; a case that wants another installs one.
  setAreaSummarySource(null);
});

describe("example-auto's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(exampleAuto)).toEqual([]);
  });

  it("declares itself an automatic step — the module's fact, not the node's", () => {
    expect(exampleAuto.module.auto).toBe(true);
  });

  it("declares exactly the ports it writes, and requires the one it depends on", () => {
    const declared = exampleAuto.module.params.map((param) => param.port);

    expect([...declared].sort()).toEqual(["advancedParams", "coordinates"]);
    expect(
      exampleAuto.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["coordinates"]);
  });

  it("declares the one real edge, and not the port it reads only to merge", () => {
    // A different drawn area invalidates the summary.
    expect([...exampleAuto.module.affect.coordinates!]).toEqual(["advancedParams"]);
    // Reading `advancedParams` to merge into it is not an invalidation edge.
    expect(exampleAuto.module.affect.advancedParams).toBeUndefined();
  });

  it("declares the two regions an auto node shows into, and no forward action", () => {
    expect([...exampleAuto.module.layout].sort()).toEqual(["bottom", "overlay"]);
  });

  it("leaves seal at its default — one writer, one transaction", () => {
    // `at-completion` is the default, so the module does not declare it and does not opt into `per-commit`.
    expect(exampleAuto.module.seal).toBeUndefined();
  });
});

describe("example-auto's behaviour", () => {
  it("commits a summary derived from the drawn area", async () => {
    const { store, error, issues } = await runInScratch(exampleAuto);

    expect(error).toBeUndefined();
    expect(issues).toEqual([]);
    expect(store.data.advancedParams?.[AREA_SUMMARY_KEY]).toMatchObject({
      ringCount: 2,
      pointCount: 7, // 3 + 4 points across the two rings
      bounds: { minLon: 8.5, minLat: 49.3, maxLon: 8.8, maxLat: 49.4 },
    });
  });

  it("merges into advancedParams rather than replacing it", async () => {
    const { store, error } = await runInScratch({
      ...exampleAuto,
      mock: { ...exampleAuto.mock, advancedParams: { keep: "me" } },
    });

    expect(error).toBeUndefined();
    // The bag is shared: replacing the whole port would throw another module's key away.
    expect(store.data.advancedParams?.keep).toBe("me");
    expect(store.data.advancedParams?.[AREA_SUMMARY_KEY]).toBeDefined();
  });

  it("commits nothing on a second run with the same input, but still records the run", async () => {
    const store = createStore({ ...exampleAuto.mock });
    const engine = createEngine(store);

    await engine.runModule(exampleAuto.module, { id: NODE, moduleId: exampleAuto.module.id });
    await engine.runModule(exampleAuto.module, { id: NODE, moduleId: exampleAuto.module.id });

    // Two runs, two traces: the second is a zero-diff transaction.
    expect(store.log).toHaveLength(2);
    expect(store.log[1].primary).toHaveLength(0);
  });

  it("reads the port before writing it — two runs with different areas both succeed", async () => {
    const store = createStore({ coordinates: MOCK_RINGS });
    const engine = createEngine(store);

    await engine.runModule(exampleAuto.module, { id: NODE, moduleId: exampleAuto.module.id });
    const first = store.data.advancedParams?.[AREA_SUMMARY_KEY];

    // A new area arrives as an ordinary change to the input port — what a redraw would seal.
    store.applyTransaction([
      { op: "replace", path: "/coordinates", prev: MOCK_RINGS, next: OTHER_RINGS },
    ]);

    // The second run rewrites `advancedParams`; succeeding proves run() read the port first.
    await engine.runModule(exampleAuto.module, { id: NODE, moduleId: exampleAuto.module.id });
    const second = store.data.advancedParams?.[AREA_SUMMARY_KEY];

    expect(first).toMatchObject({ ringCount: 2 });
    expect(second).toMatchObject({ ringCount: 1, pointCount: 3 });
  });

  it("reports the missing area rather than pretending there is something to summarise", async () => {
    // `validate()` is asked against the store before the run, so a mock without an area is caught.
    const { issues } = await runInScratch({ ...exampleAuto, mock: {} });

    expect(issues).toEqual([{ port: "coordinates", message: MISSING_AREA }]);
  });

  it("takes its answer from an installed source, and the default comes back on null", async () => {
    const asked: Coordinates[] = [];
    setAreaSummarySource({
      async summarise(rings) {
        asked.push(rings);
        return { ringCount: 99, pointCount: 99, bounds: null, centroid: null };
      },
    });

    const { store } = await runInScratch(exampleAuto);
    expect(asked).toHaveLength(1);
    expect(store.data.advancedParams?.[AREA_SUMMARY_KEY]).toEqual({
      ringCount: 99,
      pointCount: 99,
      bounds: null,
      centroid: null,
    });

    // `null` restores the example's own deterministic source.
    setAreaSummarySource(null);
    const { store: again } = await runInScratch(exampleAuto);
    expect(again.data.advancedParams?.[AREA_SUMMARY_KEY]).toMatchObject({ ringCount: 2 });
  });
});

describe("example-auto's gate", () => {
  it("says nothing once an area is drawn", () => {
    expect(issuesFor({ coordinates: MOCK_RINGS })).toEqual([]);
  });

  it("names the port it needs when no area is drawn", () => {
    expect(issuesFor({})).toEqual([{ port: "coordinates", message: MISSING_AREA }]);
    expect(issuesFor({ coordinates: [] })).toEqual([
      { port: "coordinates", message: MISSING_AREA },
    ]);
  });
});
