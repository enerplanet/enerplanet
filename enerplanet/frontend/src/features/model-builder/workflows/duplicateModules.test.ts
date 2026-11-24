/** The same module at two positions, one of them inside a subflow. */
import { describe, expect, it } from "vitest";

import { createEngine } from "../core/engine";
import { fc, building } from "../core/fixtures";
import type { ModuleRegistry } from "../core/flow";
import { defineModule, type Module } from "../core/module";
import type { MemeRun, PortKey } from "../core/ports";
import { nodeStates, position } from "../core/position";
import { createStore } from "../core/store";
import { expand } from "./expand";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

const NODE = (id: string): WorkflowNodeDocument => ({ id, moduleId: id });

const a = defineModule({
  id: "a",
  params: [{ port: "region" as PortKey }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const b = defineModule({
  id: "b",
  params: [{ port: "region" as PortKey, required: true }, { port: "coordinates" as PortKey }],
  affect: { region: ["coordinates"] },
  layout: [],
  run: (ctx) => {
    ctx.read("coordinates");
    ctx.commit({ coordinates: [[[8.6, 49.4]]] });
  },
  validate: () => [],
});

const c = defineModule({
  id: "c",
  params: [{ port: "coordinates" as PortKey, required: true }, { port: "buildings" as PortKey }],
  affect: { coordinates: ["buildings"] },
  layout: [],
  run: (ctx) => {
    ctx.read("buildings");
    ctx.commit({ buildings: fc([building("b1")]) });
  },
  validate: () => [],
});

/** Run-like, and the crux: one shared port, judged by whichever copy is asking. */
const d = defineModule({
  id: "d",
  params: [{ port: "buildings" as PortKey, required: true }, { port: "memeRun" as PortKey }],
  affect: { buildings: ["memeRun"] },
  layout: [],
  auto: true,
  run: (ctx) => {
    const current = ctx.read("memeRun");
    // The guard the real node carries: never re-submit on top of a live run.
    if (current?.status === "running") return;
    ctx.commit({ memeRun: { framework: "calliope", status: "running" } as MemeRun });
  },
  validate: (ctx) =>
    ctx.store.memeRun?.status === "running"
      ? [{ port: "memeRun" as PortKey, message: "the run is still going" }]
      : [],
});

const e = defineModule({
  id: "e",
  params: [{ port: "memeRun" as PortKey, required: true }, { port: "modelVariant" as PortKey }],
  affect: { memeRun: ["modelVariant"] },
  layout: [],
  run: (ctx) => {
    ctx.read("modelVariant");
    ctx.commit({ modelVariant: { variantModelId: 2, rootModelId: 1 } });
  },
  validate: () => [],
});

const g = defineModule({
  id: "g",
  params: [{ port: "memeRun" as PortKey, required: true }, { port: "modelName" as PortKey }],
  affect: {},
  layout: [],
  run: (ctx) => {
    ctx.read("modelName");
    ctx.commit({ modelName: "compared" });
  },
  validate: () => [],
});

const registry: ModuleRegistry = Object.fromEntries(
  ([a, b, c, d, e, g] as Module[]).map((module) => [module.id, module]),
);

const rerun: WorkflowDocument = {
  id: "rerun",
  version: 1,
  label: "Rerun",
  isSubflow: true,
  nodes: [NODE("b"), NODE("c"), NODE("d"), NODE("g")],
};

const outer: WorkflowDocument = {
  id: "outer",
  version: 1,
  label: "Outer",
  nodes: [
    NODE("a"),
    NODE("b"),
    NODE("c"),
    NODE("d"),
    NODE("e"),
    { id: "f", workflows: ["rerun"], label: "F" },
  ],
};

const lookup = (workflowId: string) => (workflowId === "rerun" ? rerun : undefined);

describe("the same module at two positions", () => {
  it("keeps a separate transaction slot for each copy", () => {
    const flow = expand(outer, lookup, registry);

    expect(flow.map((node) => node.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f/b",
      "f/c",
      "f/d",
      "f/g",
    ]);
  });

  it("leaves the shared value in place, and rests the session on the earlier copy", async () => {
    const flow = expand(outer, lookup, registry);
    const store = createStore({} as never);
    const engine = createEngine(store);
    // Awaited in order: a fire-and-forget loop interleaves the runs and the store mutates out of order.
    for (const node of flow) {
      await engine.runModule(registry[node.moduleId], { id: node.id, moduleId: registry[node.moduleId].id });
    }

    const states = nodeStates(flow, registry, store);
    const at = position(flow, registry, store);

    expect(store.data.memeRun).toBeDefined();
    expect(states.d).toBe("stale");
    expect(states["f/d"]).toBe("stale");
    // And the frontier is *the first node not done*, so it moves up to the earlier copy.
    expect(at.nodeId).toBe("d");
  });
});
