/**
 * `model-start`'s tests.
 *
 * The declaration cases carry most of the weight here, because this module's whole job *is* its declaration:
 * it requires nothing (which is what makes it an entry node), and it owns the model's identity and metadata
 * surface. The behaviour cases then show what a gesture seeds and what `validate()` refuses to start with.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type RegionRef,
} from "@model-builder/core";
import modelStart, {
  DEFAULT_COOKING_CARRIER,
  DEFAULT_RUN_MODE,
  NO_OWN_PRICES,
  hold,
} from "./index";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = modelStart.module.id;

/** A region one of the module's own options offers. */
const REGION: RegionRef = { country: "DE", state: "BW" };

/** The name a user types, padded — so a commit that trims it is a visible change. */
const NAME = "  Karlsruhe  ";

/** An ISO period. Ordered here as `FROM → TO`, since the module's validation compares them as strings. */
const FROM = "2026-01-01";
const TO = "2026-12-31";

describe("model-start's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(modelStart)).toEqual([]);
  });

  it("requires nothing — that is what makes it the workflow's entry node", () => {
    const required = modelStart.module.params.filter((param) => param.required === true);

    expect(required).toEqual([]);
  });

  it("owns the model's identity and metadata surface, and nothing else", () => {
    const declared = modelStart.module.params.map((param) => param.port);

    expect([...declared].sort()).toEqual([
      "cookingCarrier",
      "electricityPrices",
      "fromDate",
      "mode",
      "modelName",
      "region",
      "resolution",
      "toDate",
      "userId",
      "workspaceId",
    ]);
    // It is the one module with no inputs, so nothing can invalidate its work.
    expect(modelStart.module.affect).toEqual({});
  });

  it("presents the two regions it actually uses", () => {
    // The form, and what it does to the map. The baselayer itself is the `map-provider` module's business.
    expect([...modelStart.module.layout].sort()).toEqual(["map", "sidebar"]);
  });
});

describe("model-start's behaviour", () => {
  it("seeds identity and metadata in one gesture — four ports, one transaction", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME, fromDate: FROM, toDate: TO, resolution: 15 });
    await engine.runModule(modelStart.module, { id: NODE });

    expect(store.data.modelName).toBe(NAME.trim()); // trimmed on the way in
    expect(store.data.fromDate).toBe(FROM);
    expect(store.data.toDate).toBe(TO);
    expect(store.data.resolution).toBe(15);

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path).sort()).toEqual([
      "/cookingCarrier",
      "/electricityPrices",
      "/fromDate",
      "/mode",
      "/modelName",
      "/resolution",
      "/toDate",
    ]);
    // The three settings no step produces ride along with the identity, rather than waiting for the save to
    // invent them.
    expect(store.data.cookingCarrier).toBe(DEFAULT_COOKING_CARRIER);
    expect(store.data.mode).toBe(DEFAULT_RUN_MODE);
    expect(store.data.electricityPrices).toEqual(NO_OWN_PRICES);
  });

  it("holds the chosen region as a RegionRef — the port downstream modules read", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    hold(NODE, { region: REGION });
    await engine.runModule(modelStart.module, { id: NODE });

    expect(store.data.region).toEqual(REGION);
  });

  it("leaves the session's own identity alone", async () => {
    const store = createStore({ workspaceId: 7, userId: "abc" });
    const engine = createEngine(store);

    // Declared, but never written: a form does not invent a workspace, and overwriting one would be this
    // module overreaching. An untouched port is the proof.
    hold(NODE, { modelName: NAME });
    await engine.runModule(modelStart.module, { id: NODE });

    expect(store.data.workspaceId).toBe(7);
    expect(store.data.userId).toBe("abc");
  });

  it("seals nothing when the hold would change nothing", async () => {
    // The store is seeded with the same defaults the module writes, so the only thing this run *could* say is
    // what the hold says — and that changes nothing.
    const store = createStore({
      modelName: NAME.trim(),
      cookingCarrier: DEFAULT_COOKING_CARRIER,
      mode: DEFAULT_RUN_MODE,
      electricityPrices: NO_OWN_PRICES,
    });
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME });
    await expect(engine.runModule(modelStart.module, { id: NODE })).resolves.toBeUndefined();

    expect(store.log).toHaveLength(0);
  });

  it("reports what is missing on an empty store — a model that has not started", async () => {
    // No test data at all, so the scratch store is empty: exactly the state this module exists to fill.
    const { issues } = await runInScratch({ module: modelStart.module });

    expect(issues.map((issue) => issue.port).sort()).toEqual(["fromDate", "modelName", "region"]);
  });

  it("stays finished when re-applied with every field untouched", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME, fromDate: FROM, toDate: TO, region: REGION });
    await engine.runModule(modelStart.module, { id: NODE });
    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);

    // The form omits whatever the user did not retype, so coming back to this node and pressing Apply again
    // holds *nothing*. That must not un-finish work the store already holds — the node is still done, and the
    // user is not asked to retype what they already set.
    hold(NODE, {});
    await engine.runModule(modelStart.module, { id: NODE });

    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);
    expect(store.data.modelName).toBe(NAME.trim());
  });

  it("stays finished after the region is changed on a revisit", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME, fromDate: FROM, toDate: TO, region: REGION });
    await engine.runModule(modelStart.module, { id: NODE });
    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);

    // Coming back to swap the region changes one field. The name and period are untouched and already in the
    // store, so the node must stay finished — the user should not have to retype what they already set.
    hold(NODE, { region: { country: "NL", state: "ZH" } });
    await engine.runModule(modelStart.module, { id: NODE });

    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);
  });

  it("reports a period that starts after it ends", async () => {
    const { issues } = await runInScratch({
      module: modelStart.module,
      mock: { modelName: NAME, fromDate: TO, toDate: FROM, region: REGION },
    });

    expect(issues).toEqual([{ port: "fromDate", message: "The period starts after it ends." }]);
  });
});
