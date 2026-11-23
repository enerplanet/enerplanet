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
  nextRange,
  periodDates,
  periodPreview,
  quartersIn,
  type PeriodKey,
  type PeriodRange,
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

/** The scenario year every period part lands in — the legacy's fixed reference year. */
const SCENARIO_YEAR = 2023;
/** The scenario year's first and last day, which Q1/Q4 share a bound with. */
const YEAR_START = `${SCENARIO_YEAR}-01-01`;
const YEAR_END = `${SCENARIO_YEAR}-12-31`;

/** The quarter keys, hoisted so the cases read as the clicks a user makes. */
const Q1: PeriodKey = "q1";
const Q2: PeriodKey = "q2";
const Q3: PeriodKey = "q3";
const Q4: PeriodKey = "q4";
/** A key that names no quarter. */
const NOPE = "nope";

/** Each quarter's outer days, so the mapping cases name bounds rather than repeat ISO strings. */
const Q1_END = `${SCENARIO_YEAR}-03-31`;
const Q2_START = `${SCENARIO_YEAR}-04-01`;

/** A single-quarter range, the shape a first click produces. */
const single = (key: PeriodKey): PeriodRange => ({ start: key, end: key });

/** The language the preview cases format in — English, so the month names are pinned. */
const EN = "en";

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
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.data.modelName).toBe(NAME.trim()); // trimmed on the way in
    expect(store.data.fromDate).toBe(FROM);
    expect(store.data.toDate).toBe(TO);
    // A hold asking for 15 gets 60: only 60-minute steps are supported, and this node states the one value the
    // system takes rather than offering a picker that would be overwritten on save.
    expect(store.data.resolution).toBe(60);

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
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.data.region).toEqual(REGION);
  });

  it("leaves the session's own identity alone", async () => {
    const store = createStore({ workspaceId: 7, userId: "abc" });
    const engine = createEngine(store);

    // Declared, but never written: a form does not invent a workspace, and overwriting one would be this
    // module overreaching. An untouched port is the proof.
    hold(NODE, { modelName: NAME });
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.data.workspaceId).toBe(7);
    expect(store.data.userId).toBe("abc");
  });

  it("changes no data but still records the run when the hold would change nothing", async () => {
    // The store is seeded with the same defaults the module writes, so the only thing this run *could* say is
    // what the hold says — and that changes nothing. It still seals one zero-diff transaction: a placement is
    // `done` only once it has a commit, so a no-op run must still leave its trace.
    const store = createStore({
      modelName: NAME.trim(),
      // 60, because that is the one resolution this module accepts and it will otherwise correct the store — a
      // write that is real work, not noise, and this test is about the run that has nothing to say.
      resolution: 60,
      cookingCarrier: DEFAULT_COOKING_CARRIER,
      mode: DEFAULT_RUN_MODE,
      electricityPrices: NO_OWN_PRICES,
    });
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME });
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(NAME.trim());
  });

  it("corrects a resolution the model already holds, instead of clobbering it", async () => {
    // The store holds 15 and the module holds 60. Writing it is a *read-then-write*, which is what the engine's
    // anti-clobber rule asks for — write a port the store already fills without reading it first and the whole
    // run is refused with `clobber`, taking the region choice down with it.
    const store = createStore({ resolution: 15 });
    const engine = createEngine(store);

    hold(NODE, { region: REGION });
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.data.resolution).toBe(60);
    // And the region the user chose landed in the same transaction, rather than being lost to the refusal.
    expect(store.data.region).toEqual(REGION);
  });

  it("leaves a resolution of 60 alone", async () => {
    // Already correct is not a reason to write. The store still gets the three settings this module seeds, but
    // `resolution` is not among the ports it touches.
    const store = createStore({ resolution: 60 });
    const engine = createEngine(store);

    hold(NODE, {});
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.log[0].primary.map((op) => op.path)).not.toContain("/resolution");
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
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });
    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);

    // The form omits whatever the user did not retype, so coming back to this node and pressing Apply again
    // holds *nothing*. That must not un-finish work the store already holds — the node is still done, and the
    // user is not asked to retype what they already set.
    hold(NODE, {});
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);
    expect(store.data.modelName).toBe(NAME.trim());
  });

  it("stays finished after the region is changed on a revisit", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    hold(NODE, { modelName: NAME, fromDate: FROM, toDate: TO, region: REGION });
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });
    expect(modelStart.module.validate?.({ store: store.data })).toEqual([]);

    // Coming back to swap the region changes one field. The name and period are untouched and already in the
    // store, so the node must stay finished — the user should not have to retype what they already set.
    hold(NODE, { region: { country: "NL", state: "ZH" } });
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

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

describe("model-start's period range", () => {
  it("maps a range to the two quarters' outer bounds onto the scenario's fixed year", () => {
    // A range is the earlier quarter's `start` bound to the later quarter's `end`, both on `SCENARIO_DATE_YEAR`
    // — a non-leap year keeps the days in line with the 365-day scenario series.
    expect(periodDates(Q1, Q1)).toEqual({ fromDate: YEAR_START, toDate: Q1_END });
    expect(periodDates(Q2, Q4)).toEqual({ fromDate: Q2_START, toDate: YEAR_END });
    expect(periodDates(Q1, Q4)).toEqual({ fromDate: YEAR_START, toDate: YEAR_END });
    // The range is chronological whatever order the two clicks arrived in: Q4→Q2 spans the same as Q2→Q4.
    expect(periodDates(Q4, Q2)).toEqual({ fromDate: Q2_START, toDate: YEAR_END });
  });

  it("refuses a key that names no quarter", () => {
    expect(periodDates(NOPE, Q1)).toBeUndefined();
    expect(periodDates(Q1, NOPE)).toBeUndefined();
  });

  it("derives the quarters a stored period covers, so the buttons reflect the model", () => {
    expect(quartersIn(Q2_START, YEAR_END)).toEqual({ start: Q2, end: Q4 });
    expect(quartersIn(YEAR_START, Q1_END)).toEqual(single(Q1));
    // Unset, or dates that land on no quarter's bounds (a legacy year's own dates), claim nothing.
    expect(quartersIn(undefined, YEAR_END)).toBeUndefined();
    expect(quartersIn(FROM, TO)).toBeUndefined();
  });

  it("behaves as the four-click decision says", () => {
    // click Q2 → Q2 alone; click Q4 → Q2–Q4 …
    expect(nextRange(undefined, Q2)).toEqual(single(Q2));
    expect(nextRange(single(Q2), Q4)).toEqual({ start: Q2, end: Q4 });
    // … clicking an endpoint of the span collapses it back to that quarter alone.
    expect(nextRange({ start: Q2, end: Q4 }, Q2)).toEqual(single(Q2));
    expect(nextRange({ start: Q2, end: Q4 }, Q4)).toEqual(single(Q4));
    // Whatever the click order, the span is chronological: Q4 then Q1 is Q1–Q4, not Q4–Q1.
    expect(nextRange(single(Q4), Q1)).toEqual({ start: Q1, end: Q4 });
    // A click inside a span that is not an endpoint begins a fresh single quarter.
    expect(nextRange({ start: Q2, end: Q4 }, Q3)).toEqual(single(Q3));
  });

  it("renders the period's months from the stored dates, in the given language", () => {
    // The months come from `Intl` on the actual stored dates, so the preview cannot disagree with the model.
    // No year: a scenario has none of its own, so printing one would claim a calendar year the weather lacks.
    expect(periodPreview(Q2_START, YEAR_END, EN)).toBe("April – December");
    expect(periodPreview(YEAR_START, Q1_END, EN)).toBe("January – March");
    // No period, no line — the caller says so instead of printing an empty one.
    expect(periodPreview(undefined, undefined, EN)).toBeUndefined();
    expect(periodPreview(Q2_START, undefined, EN)).toBeUndefined();
  });

  it("commits a picked range as the model's period — the same fromDate/toDate path as before", async () => {
    const store = createStore({});
    const engine = createEngine(store);

    // A range is picked through the module's own hold/run path, exactly as the panel's buttons do.
    hold(NODE, periodDates(Q2, Q4) ?? {});
    await engine.runModule(modelStart.module, { id: NODE, moduleId: modelStart.module.id });

    expect(store.data.fromDate).toBe(Q2_START);
    expect(store.data.toDate).toBe(YEAR_END);
  });
});
