import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentType } from "react";
import { NodeEngine } from "./NodeEngine";
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
}

/** Build a test module with a unique id so the shared singleton stays clean. */
function makeModule(opts: MakeModuleOpts) {
  const { id, outputs = [], required = [], run } = opts;
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