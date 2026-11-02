import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentType } from "react";
import { NodeEngine } from "./NodeEngine";
import { validateGraph } from "./WorkflowGraph";
import { BaseModule } from "../modules/base/BaseModule";
import type { ModuleProps } from "../types/module";
import type { ConfiguratorContext } from "../types/context";
import type { WorkflowDefinition } from "../types/workflow";
import { defaultModuleInventory } from "../modules/ModuleInventory";
import "../modules"; // barrel: populates the default inventory with real modules

const NoopComponent: ComponentType<ModuleProps> = () => null;

interface MakeModuleOpts {
  id: string;
  outputs?: string[];
  required?: string[];
  skippableIsIrrelevant?: never;
  run?: (ctx: ConfiguratorContext) => Promise<Partial<ConfiguratorContext>>;
  defaults?: Record<string, unknown>;
}

/** Build a test module with a unique id so the shared singleton stays clean. */
function makeModule(opts: MakeModuleOpts) {
  const { id, outputs = [], required = [], run, defaults } = opts;
  const M = class extends BaseModule {
    readonly meta = {
      id,
      name: id,
      description: id,
      icon: "bolt",
      category: "simulation" as const,
      defaultComplexity: "basic" as const,
    };
    readonly io = { inputs: required, outputs, required };
    readonly component = NoopComponent;
    readonly run = run;
    readonly defaults = defaults;
  };
  const instance = new M();
  defaultModuleInventory.register(instance);
  return { instance, id };
}

function workflow(overrides: {
  id: string;
  nodes: Parameters<typeof rawNode>[0][];
}): WorkflowDefinition {
  return {
    id: overrides.id,
    name: overrides.id,
    description: overrides.id,
    version: "1.0.0",
    steps: [],
    nodes: overrides.nodes.map(rawNode),
  };
}

/**
 * Cast a headless-implementation function to the `run` signature. Used in tests
 * to return context keys plus (deliberately) undeclared keys, so the engine's
 * output filtering can be exercised.
 */
const headless = (
  fn: (ctx: ConfiguratorContext) => Promise<Record<string, unknown>>,
) => fn as unknown as (ctx: ConfiguratorContext) => Promise<Partial<ConfiguratorContext>>;

function rawNode(n: {
  id: string;
  moduleId: string;
  auto?: boolean;
  skippable?: boolean;
  dependsOn?: string[];
}): NonNullable<WorkflowDefinition["nodes"]>[number] {
  return {
    id: n.id,
    moduleId: n.moduleId,
    label: n.id,
    auto: n.auto,
    skippable: n.skippable,
    dependsOn: n.dependsOn,
  };
}

beforeEach(() => {
  // The default inventory is a shared singleton; keep ids unique per test case
  // and don't assert on global state, so ordering between tests is harmless.
});

describe("C1 — auto nodes execute", () => {
  it("calls run() and merges its declared outputs", async () => {
    const runSpy = vi.fn(headless(async () => ({ modelName: "hello" })));
    const { id } = makeModule({ id: "c1-run", outputs: ["modelName"], run: runSpy });

    const engine = new NodeEngine(
      workflow({
        id: "c1-wf",
        nodes: [{ id: "n", moduleId: id, auto: true }],
      }),
      {},
    );

    await engine.updateContext({});

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(engine.getNodeStates().n).toBe("done");
    expect(engine.getContext().modelName).toBe("hello");
    expect(engine.isComplete()).toBe(true);
  });

  it("filters run() outputs not declared in io.outputs", async () => {
    const { id } = makeModule({
      id: "c1-leak",
      outputs: ["modelName"],
      run: headless(async () => ({ modelName: "ok", leaked: 2 })),
    });

    const engine = new NodeEngine(
      workflow({
        id: "c1-leak-wf",
        nodes: [{ id: "n", moduleId: id, auto: true }],
      }),
      {},
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await engine.updateContext({});

    expect(engine.getContext().modelName).toBe("ok");
    expect((engine.getContext() as Record<string, unknown>).leaked).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("completes via the legacy path when run() is absent (back-compat)", async () => {
    // e.g. an auto module whose work happens to already be in context (the old
    // "grid-generation adopts gridData written by region-select" behaviour).
    const { id } = makeModule({ id: "c1-legacy", outputs: ["modelName"] });

    const engine = new NodeEngine(
      workflow({
        id: "c1-legacy-wf",
        nodes: [{ id: "n", moduleId: id, auto: true }],
      }),
      { modelName: "seeded" },
    );

    await engine.updateContext({});

    expect(engine.getNodeStates().n).toBe("done");
    expect(engine.getContext().modelName).toBe("seeded");
  });
});

describe("C2 — skipping a dependency does not deadlock", () => {
  it("unblocks a consumer when another producer supplied the key", async () => {
    const { id: importer } = makeModule({
      id: "c2-importer",
      outputs: ["polygons"],
    });
    const { id: region } = makeModule({
      id: "c2-region",
      outputs: ["polygons"],
    });
    const { id: grid } = makeModule({
      id: "c2-consumer",
      outputs: ["out"],
      required: ["polygons"],
    });

    const engine = new NodeEngine(
      workflow({
        id: "c2-wf",
        nodes: [
          { id: "importer-node", moduleId: importer, skippable: true },
          { id: "region-node", moduleId: region },
          { id: "grid-node", moduleId: grid },
        ],
      }),
      {},
    );

    // Skip the importer (mirrors skipping model-load).
    await engine.activateNode("importer-node");
    await engine.skipNode("importer-node");

    // Complete the region node, which actually writes polygons.
    await engine.activateNode("region-node");
    await engine.updateContext({ polygons: [[[0, 0], [1, 0], [1, 1]]] });
    await engine.completeNode("region-node");

    // Consumer is now ready: importer skipped (satisfied) + region done + key present.
    expect(engine.getReadyNodes().map((n) => n.id)).toContain("grid-node");
  });

  it("still gates a hard requirement when the ONLY producer was skipped", async () => {
    const { id: producer } = makeModule({
      id: "c2-only-prod",
      outputs: ["gridData"],
    });
    const { id: consumer } = makeModule({
      id: "c2-only-cons",
      outputs: ["out"],
      required: ["gridData"],
    });

    const engine = new NodeEngine(
      workflow({
        id: "c2-only-wf",
        nodes: [
          { id: "producer-node", moduleId: producer, skippable: true },
          { id: "consumer-node", moduleId: consumer },
        ],
      }),
      {},
    );

    await engine.activateNode("producer-node");
    await engine.skipNode("producer-node");

    // Dependency satisfied, but gridData never produced -> consumer stays pending.
    expect(engine.getReadyNodes().map((n) => n.id)).not.toContain("consumer-node");
  });

  it("unblocks a plain dependsOn edge when the dependency is skipped", async () => {
    const { id: dep } = makeModule({ id: "c2-dep", outputs: ["x"] });
    const { id: node } = makeModule({ id: "c2-after", outputs: ["y"] });

    const engine = new NodeEngine(
      workflow({
        id: "c2-dep-wf",
        nodes: [
          { id: "dep-node", moduleId: dep, skippable: true },
          { id: "after-node", moduleId: node, dependsOn: ["dep-node"] },
        ],
      }),
      {},
    );

    await engine.activateNode("dep-node");
    await engine.skipNode("dep-node");

    expect(engine.getReadyNodes().map((n) => n.id)).toContain("after-node");
  });
});

describe("M3 — invalidation on redo", () => {
  /** Test modules write ad-hoc keys; the engine contract is typed to
      ConfiguratorContext, so tests cast their partial patches. */
  const patch = (d: Record<string, unknown>) =>
    d as unknown as Partial<ConfiguratorContext>;
  const get = (engine: NodeEngine) =>
    engine.getContext() as Record<string, unknown>;

  function buildChain() {
    const runSpy = vi.fn(
      headless(async (ctx: ConfiguratorContext) => ({
        midOut: `m-${(ctx as Record<string, unknown>).wg as string}`,
      })),
    );
    const { id: pid } = makeModule({ id: "m3-prod", outputs: ["wg"] });
    const { id: mid } = makeModule({
      id: "m3-mid",
      outputs: ["midOut"],
      required: ["wg"],
      run: runSpy,
    });
    const { id: cid } = makeModule({
      id: "m3-cons",
      outputs: [],
      required: ["midOut"],
    });

    const engine = new NodeEngine(
      workflow({
        id: "m3-wf",
        nodes: [
          { id: "p", moduleId: pid },
          { id: "m", moduleId: mid, auto: true },
          { id: "c", moduleId: cid },
        ],
      }),
      {},
    );
    return { engine, runSpy };
  }

  it("redoing a node with changed output resets and re-runs downstream", async () => {
    const { engine, runSpy } = buildChain();

    // First pass: p -> auto m -> c.
    await engine.activateNode("p");
    await engine.updateContext(patch({ wg: "v1" }));
    await engine.completeNode("p");
    expect(engine.getNodeStates().m).toBe("done");
    expect(get(engine).midOut).toBe("m-v1");
    await engine.activateNode("c");
    await engine.completeNode("c");
    expect(engine.getNodeStates().c).toBe("done");
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Redo p with a real change (e.g. the user redrew the region).
    await engine.activateNode("p");
    await engine.updateContext(patch({ wg: "v2" }));
    await engine.completeNode("p");

    // Auto m re-ran with the new input; interactive consumer c was reset.
    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(engine.getNodeStates().m).toBe("done");
    expect(get(engine).midOut).toBe("m-v2");
    expect(engine.getNodeStates().c).toBe("pending");
    // c is available again (its required key was reproduced).
    expect(engine.getReadyNodes().map((n) => n.id)).toContain("c");
  });

  it("a redo that changes nothing does not invalidate downstream", async () => {
    const { engine, runSpy } = buildChain();

    await engine.activateNode("p");
    await engine.updateContext(patch({ wg: "v9" }));
    await engine.completeNode("p");
    await engine.activateNode("c");
    await engine.completeNode("c");
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Redo p with the SAME value — fingerprint unchanged, pipeline must stay.
    await engine.activateNode("p");
    await engine.updateContext(patch({ wg: "v9" }));
    await engine.completeNode("p");

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(engine.getNodeStates().m).toBe("done");
    expect(engine.getNodeStates().c).toBe("done");
    expect(get(engine).midOut).toBe("m-v9");
  });
});

describe("M4 — one-writer-per-key validation", () => {
  it("rejects a workflow with two producers of the same key", async () => {
    const { id: a } = makeModule({ id: "m4-a", outputs: ["shared"] });
    const { id: b } = makeModule({ id: "m4-b", outputs: ["shared"] });

    const result = validateGraph(
      workflow({
        id: "m4-wf",
        nodes: [
          { id: "a-node", moduleId: a },
          { id: "b-node", moduleId: b },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"shared"'))).toBe(true);
  });

  it("accepts a single-producer workflow and implicit io.required edges", async () => {
    const { id: prod } = makeModule({ id: "m4-prod", outputs: ["shared"] });
    const { id: cons } = makeModule({
      id: "m4-cons",
      outputs: [],
      required: ["shared"],
    });

    const result = validateGraph(
      workflow({
        id: "m4-ok",
        nodes: [
          { id: "prod-node", moduleId: prod },
          // No explicit dependsOn — the consumer's io.required edge is enough.
          { id: "cons-node", moduleId: cons },
        ],
      }),
    );

    expect(result.valid).toBe(true);
  });
});

describe("m6 — activation readiness gate", () => {
  it("rejects activating a node whose required inputs are missing", async () => {
    const { id: cons } = makeModule({
      id: "m6-cons",
      outputs: [],
      required: ["gridData"],
    });

    const engine = new NodeEngine(
      workflow({
        id: "m6-wf",
        nodes: [{ id: "c", moduleId: cons }],
      }),
      {},
    );

    await expect(engine.activateNode("c")).rejects.toThrow(/not ready/);
  });

  it("still allows re-activating a done node (M3 redo path)", async () => {
    const { id: prod } = makeModule({ id: "m6-redo", outputs: ["modelName"] });

    const engine = new NodeEngine(
      workflow({
        id: "m6-redo-wf",
        nodes: [{ id: "p", moduleId: prod }],
      }),
      {},
    );

    await engine.activateNode("p");
    await engine.completeNode("p");
    await expect(engine.activateNode("p")).resolves.toBeUndefined();
  });
});

describe("defaults-on-skip", () => {
  it("seeds declared output defaults on skip and filters undeclared keys", async () => {
    const { id } = makeModule({
      id: "skip-defaults",
      outputs: ["modelName"],
      defaults: { modelName: "Default Model", leaked: 123 },
    });

    const engine = new NodeEngine(
      workflow({
        id: "skip-defaults-wf",
        nodes: [{ id: "n", moduleId: id, skippable: true }],
      }),
      {},
    );

    await engine.activateNode("n");
    await engine.skipNode("n");

    expect(engine.getNodeStates().n).toBe("skipped");
    expect(engine.getContext().modelName).toBe("Default Model");
    expect((engine.getContext() as Record<string, unknown>).leaked).toBeUndefined();
  });

  it("does not clobber an existing output value on skip", async () => {
    const { id } = makeModule({
      id: "skip-defaults-keep",
      outputs: ["modelName"],
      defaults: { modelName: "Default Model" },
    });

    const engine = new NodeEngine(
      workflow({
        id: "skip-defaults-keep-wf",
        nodes: [{ id: "n", moduleId: id, skippable: true }],
      }),
      { modelName: "Already Set" },
    );

    await engine.activateNode("n");
    await engine.skipNode("n");

    expect(engine.getContext().modelName).toBe("Already Set");
  });
});