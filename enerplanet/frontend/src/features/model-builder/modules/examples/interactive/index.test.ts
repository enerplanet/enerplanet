/** The example module's tests — the shape a module's tests should have. */
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
import exampleInteractive, { hold } from "./index";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = exampleInteractive.module.id;

/** The module's own test data, read back rather than retyped. */
const MOCK_NAME = String(exampleInteractive.mock?.modelName);

describe("the example module's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(exampleInteractive)).toEqual([]);
  });

  it("declares exactly the ports it writes, and requires the one it depends on", () => {
    const declared = exampleInteractive.module.params.map((param) => param.port);

    // Nothing declared "just in case": every one of these is written by run(), from a region's interface.
    expect([...declared].sort()).toEqual(["coordinates", "modelName", "resolution"]);
    expect(exampleInteractive.module.params.filter((param) => param.required === true).map((p) => p.port)).toEqual([
      "resolution",
    ]);
  });

  it("presents every slot the frame offers — it is the demonstration of the frame", () => {
    // Declares all four slots, so it must keep covering any slot the host grows.
    expect([...exampleInteractive.module.layout].sort()).toEqual([...REGIONS].sort());
  });

  it("declares how its work reaches the log: per-commit, because its ports are independent", () => {
    // `per-commit` seals one transaction per `commit()`.
    expect(exampleInteractive.module.seal).toBe("per-commit");
  });

  it("is not an automatic step — it has a forward action, so `auto` stays absent", () => {
    // Interactive: a form the user fills in and submits.
    expect(exampleInteractive.module.auto).toBeUndefined();
  });
});

describe("the example module's behaviour", () => {
  it("writes what the form collected — two ports in one run", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "  Karlsruhe  ", resolution: 15 });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    expect(store.data.modelName).toBe("Karlsruhe"); // trimmed on the way in
    expect(store.data.resolution).toBe(15);

    // One gesture, one transaction — carrying both ports.
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path).sort()).toEqual(["/modelName", "/resolution"]);
  });

  it("writes the drawn area through the same run — a third port", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    hold(NODE, { coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5]]] });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    expect(store.data.coordinates).toEqual([[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5]]]);
    expect(store.log).toHaveLength(1);
  });

  it("accumulates holds for the same node — a gesture may arrive in parts", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "Karlsruhe" });
    hold(NODE, { resolution: 15 });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    expect(store.data.modelName).toBe("Karlsruhe");
    expect(store.data.resolution).toBe(15);
    expect(store.log).toHaveLength(1);
  });

  it("drops what another node collected — a hold belongs to the node it is for", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    // A later hold for a different node drops the first node's value rather than merging it.
    hold("an-earlier-node", { modelName: "  Wrong node  " });
    hold(NODE);
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    // Nothing to commit, but one zero-diff transaction keeps the placement `done`.
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME);
  });

  it("can run twice with different values — the re-read licences the rewrite", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    hold(NODE, { modelName: "First" });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });
    hold(NODE, { modelName: "Second" });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    // Two transactions prove run() read the port before overwriting it.
    expect(store.data.modelName).toBe("Second");
    expect(store.log).toHaveLength(2);
  });

  it("changes no data but still records the run when the hold would change nothing", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    // The mock's name is padded, so committing it trims to a value the store does not hold yet: a real change.
    hold(NODE, { modelName: MOCK_NAME });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });
    expect(store.log).toHaveLength(1);

    // Already trimmed: nothing differs, so the transaction carries no ops.
    hold(NODE, { modelName: MOCK_NAME.trim() });
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });
    expect(store.log).toHaveLength(2);
    expect(store.log[1].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME.trim());
  });

  it("changes nothing on a bare run, but still records that it ran", async () => {
    const store = createStore({ ...exampleInteractive.mock });
    const engine = createEngine(store);

    // A bare run with nothing held seals one zero-diff transaction.
    await engine.runModule(exampleInteractive.module, { id: NODE, moduleId: exampleInteractive.module.id });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.modelName).toBe(MOCK_NAME);
  });

  it("reports what is missing rather than pretending the model is complete", async () => {
    // `validate()` before the run catches a mock without a name.
    const { issues } = await runInScratch({ ...exampleInteractive, mock: { resolution: 60 } });

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
    const entry: BuilderModule = { module: exampleInteractive.module, Component: () => null, mock: {} };

    expect(contractIssues(entry)).toContain(
      'required port "resolution" is missing from mock — the module cannot run in isolation',
    );
  });

  it("flags an automatic module with no run() — an automatic step that does nothing", () => {
    // `auto` modules must have something to run; `overlay` is deliberately not required.
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
