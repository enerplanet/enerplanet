/**
 * The example module's tests — the shape a module's tests should have.
 *
 * Two things are asserted, and they are the two things worth asserting about any module: that its
 * **declaration** is consistent (`contractIssues`), and that its **behaviour** is what it claims
 * (`runInScratch`, through the real engine). Everything below the last test also documents the rules
 * the core enforces, by trying to break them.
 *
 * The behaviour cases hand the module values through `hold()` — the same door its regions use — and then run
 * the real engine. There is no test-only path into the module: the values a UI collects are the module's own
 * model, and `hold` is how they are handed over.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  defineModule,
  MissingRequiredPorts,
  PortWriteRejected,
  REGIONS,
  runInScratch,
  type BuilderModule,
} from "@model-builder/core";
import example, { hold } from "./index";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = example.module.id;

/**
 * The module's own test data, read back rather than retyped — so this file cannot drift from the mock it is
 * asserting against, and the padded/trimmed pair below stays meaningful if the mock ever changes.
 */
const MOCK_NAME = String(example.mock?.modelName);

describe("the example module's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(example)).toEqual([]);
  });

  it("declares exactly the ports it writes, and requires the one it depends on", () => {
    const declared = example.module.params.map((param) => param.port);

    // Nothing declared "just in case": every one of these is written by run(), from a region's interface.
    expect([...declared].sort()).toEqual(["coordinates", "modelName", "resolution"]);
    expect(example.module.params.filter((param) => param.required === true).map((p) => p.port)).toEqual([
      "resolution",
    ]);
  });

  it("presents every slot the frame offers — it is the demonstration of the frame", () => {
    // Not a rule for modules in general (most declare two or three), but this one exists to show how the
    // frame is used, so it must not quietly stop covering a slot the host has grown.
    expect([...example.module.layout].sort()).toEqual([...REGIONS].sort());
  });

  it("declares how its work reaches the log: per-commit, because its ports are independent", () => {
    // One atomic transaction per `commit()` (`spec/core.md` T16). A module whose writes must land together
    // would leave `seal` at the default, `at-completion`, and commit once.
    expect(example.module.seal).toBe("per-commit");
  });

  it("is not an automatic step — it has a forward action, so `auto` stays absent", () => {
    // Whether a step runs itself is the module's declaration (`Module.auto`), and this one is interactive:
    // a form the user fills in and submits.
    expect(example.module.auto).toBeUndefined();
  });
});

describe("the example module's behaviour", () => {
  it("writes what the form collected — two ports in one run", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "  Karlsruhe  ", resolution: 15 });
    await engine.runModule(example.module, { id: NODE });

    expect(store.data.modelName).toBe("Karlsruhe"); // trimmed on the way in
    expect(store.data.resolution).toBe(15);

    // One gesture, one transaction — carrying both ports.
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path).sort()).toEqual(["/modelName", "/resolution"]);
  });

  it("writes the drawn area through the same run — a third port", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    hold(NODE, { coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5]]] });
    await engine.runModule(example.module, { id: NODE });

    expect(store.data.coordinates).toEqual([[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5]]]);
    expect(store.log).toHaveLength(1);
  });

  it("accumulates holds for the same node — a gesture may arrive in parts", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "Karlsruhe" });
    hold(NODE, { resolution: 15 });
    await engine.runModule(example.module, { id: NODE });

    expect(store.data.modelName).toBe("Karlsruhe");
    expect(store.data.resolution).toBe(15);
    expect(store.log).toHaveLength(1);
  });

  it("drops what another node collected — a hold belongs to the node it is for", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    // The frame can move the session mid-edit. The second hold is for a different node, so the first node's
    // value is dropped — not merged, and never committed against a node that did not collect it.
    hold("an-earlier-node", { modelName: "  Wrong node  " });
    hold(NODE);
    await engine.runModule(example.module, { id: NODE });

    // The run had nothing to commit, but it still leaves a trace: one zero-diff transaction, so a node the
    // session jumped back to can clear its re-arm without an edit.
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME);
  });

  it("can run twice with different values — the re-read licences the rewrite", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "First" });
    await engine.runModule(example.module, { id: NODE });
    hold(NODE, { modelName: "Second" });
    await engine.runModule(example.module, { id: NODE });

    // A blind second write would be rejected as `clobber`. Two transactions is the proof that run() read
    // the port before overwriting it.
    expect(store.data.modelName).toBe("Second");
    expect(store.log).toHaveLength(2);
  });

  it("changes no data but still records the run when the hold would change nothing", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    // The mock's name is padded, so committing it trims to a value the store does not hold yet: a real change.
    hold(NODE, { modelName: MOCK_NAME });
    await engine.runModule(example.module, { id: NODE });
    expect(store.log).toHaveLength(1);

    // The same value again — already trimmed this time: nothing differs, so the transaction carries no ops.
    // It is sealed all the same, so a jump's re-arm cannot outlive a forward press that edited nothing.
    hold(NODE, { modelName: MOCK_NAME.trim() });
    await engine.runModule(example.module, { id: NODE });
    expect(store.log).toHaveLength(2);
    expect(store.log[1].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME.trim());
  });

  it("changes nothing on a bare run, but still records that it ran", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    // A bare run: a region that called run() with nothing held — a button pressed with no edit behind it.
    // It seals one zero-diff transaction, so returning to this node and continuing clears the re-arm.
    await engine.runModule(example.module, { id: NODE });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME);
  });

  it("reports what is missing rather than pretending the model is complete", async () => {
    // `validate()` is asked before the run, so a mock without a name is exactly what it should catch —
    // and this is the verdict the save node would turn into "what is missing".
    const { issues } = await runInScratch({ ...example, mock: { resolution: 60 } });

    expect(issues).toEqual([{ port: "modelName", message: "The model needs a name." }]);
  });
});

describe("the rules the core enforces, demonstrated", () => {
  it("rejects a write to a port the module never declared", async () => {
    const undeclared = defineModule({
      id: "undeclared",
      params: [{ port: "modelName" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit({ resolution: 42 }),
      validate: () => [],
    });

    const { error } = await runInScratch({ module: undeclared, mock: { modelName: "x" } });

    expect(error).toBeInstanceOf(PortWriteRejected);
    expect((error as PortWriteRejected).reason).toBe("undeclared");
  });

  it("rejects a blind overwrite of a value the module never read", async () => {
    const clobber = defineModule({
      id: "clobber",
      params: [{ port: "modelName" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit({ modelName: "replaced without looking" }),
      validate: () => [],
    });

    const { error } = await runInScratch({ module: clobber, mock: { modelName: "original" } });

    expect(error).toBeInstanceOf(PortWriteRejected);
    expect((error as PortWriteRejected).reason).toBe("clobber");
  });

  it("refuses to run a module whose required port the store does not hold", async () => {
    const needs = defineModule({
      id: "needs",
      params: [{ port: "coordinates", required: true }, { port: "modelName" }],
      affect: {},
      layout: [],
      run: () => undefined,
      validate: () => [],
    });

    const { error } = await runInScratch({ module: needs, mock: { modelName: "x" } });

    expect(error).toBeInstanceOf(MissingRequiredPorts);
  });

  it("flags a mock that cannot satisfy the module's own requirements", () => {
    const entry: BuilderModule = { module: example.module, Component: () => null, mock: {} };

    expect(contractIssues(entry)).toContain(
      'required port "resolution" is missing from mock — the module cannot run in isolation',
    );
  });

  it("flags an automatic module with no run() — an automatic step that does nothing", () => {
    // `auto` says the module runs itself, so it must have something to run. `overlay` is deliberately not
    // required — a headless automatic module is legal — which is why only `run()` is checked here.
    const hollow = defineModule({
      id: "hollow-auto",
      params: [{ port: "modelName" }],
      affect: {},
      layout: [],
      auto: true,
      validate: () => [],
    });

    expect(contractIssues({ module: hollow, mock: { modelName: "x" } })).toContain(
      "the module is declared auto but has no run() — an automatic step that does nothing",
    );
  });
});
