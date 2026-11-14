/**
 * The example module's tests — the shape a module's tests should have.
 *
 * Two things are asserted, and they are the two things worth asserting about any module: that its
 * **declaration** is consistent (`contractIssues`), and that its **behaviour** is what it claims
 * (`runInScratch`, through the real engine). Everything below the last test also documents the rules
 * the core enforces, by trying to break them.
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
import example from "./index";

describe("the example module's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(example)).toEqual([]);
  });

  it("declares the ports it actually writes, and requires the one it depends on", () => {
    const declared = example.module.params.map((param) => param.port);

    expect(declared).toContain("modelName"); // written by run()
    expect(declared).toContain("resolution"); // read by the UI, seeded by the mock
    expect(example.module.params.filter((param) => param.required === true).map((p) => p.port)).toEqual([
      "resolution",
    ]);
  });

  it("presents every slot the frame offers — it is the demonstration of the frame", () => {
    // Not a rule for modules in general (most declare two or three), but this one exists to show how the
    // frame is used, so it must not quietly stop covering a slot the host has grown.
    expect([...example.module.layout].sort()).toEqual([...REGIONS].sort());
  });
});

describe("the example module's behaviour", () => {
  it("normalises the model name and leaves a readable store behind", async () => {
    const { store, error, issues } = await runInScratch(example);

    expect(error).toBeUndefined();
    expect(store.data.modelName).toBe("Example fixture"); // the mock's padding was trimmed
    expect(issues).toEqual([]);
    expect(store.log).toHaveLength(1);
    expect(store.log[0].nodeId).toBe("example");
  });

  it("can run twice — the re-read licences the rewrite", async () => {
    const store = createStore({ ...example.mock });
    const engine = createEngine(store);

    await engine.runModule(example.module, { id: "example" });
    // The second run reads the name before writing it, which is what keeps anti-clobber quiet. It
    // changes nothing, though — and a run that changes nothing seals no transaction, by design.
    await expect(engine.runModule(example.module, { id: "example" })).resolves.toBeUndefined();
    expect(store.log).toHaveLength(1);
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
});
