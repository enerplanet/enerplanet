/** Chain operations: removing an entry drops it and everything after it. */
import { describe, expect, it } from "vitest";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import { appendModule, appendSubflow, chooseSubflowWorkflow, moveNode, nodeIdFor, removeFrom, removedCount } from "./chain";
import type { WorkflowNodeDocument } from "./types";

function entry(id: string, name?: string, params: Param[] = []): BuilderModule {
  const module: Module = { id, name, params, affect: {}, layout: [] };
  return { module, Component: () => null };
}

const chain: WorkflowNodeDocument[] = [
  { id: "a", moduleId: "a" },
  { id: "b", moduleId: "b" },
  { id: "c", moduleId: "c" },
];

describe("appending a module", () => {
  it("appends a node named by the module, with its id and label", () => {
    const id = "model-start";
    const next = appendModule([], entry(id, "Model start"));

    expect(next).toEqual([{ id, moduleId: id, label: "Model start" }]);
  });

  it("keeps node ids unique when the same module is placed twice — a node id is how history names a position", () => {
    const once = appendModule([], entry("weather", "Weather"));
    const twice = appendModule(once, entry("weather", "Weather"));

    expect(twice.map((n) => n.id)).toEqual(["weather", "weather-2"]);
  });

  it("derives a free node id against the ids already taken", () => {
    expect(nodeIdFor("weather", [{ id: "weather", moduleId: "weather" }])).toBe("weather-2");
    expect(nodeIdFor("weather", [])).toBe("weather");
  });
});

describe("appending a subflow", () => {
  it("appends a node referencing the workflow, with no label and an id minted off the workflow id", () => {
    expect(appendSubflow([], "grid")).toEqual([{ id: "grid", workflows: ["grid"] }]);
  });

  it("keeps node ids unique when the same workflow is inserted twice", () => {
    const once = appendSubflow([], "grid");
    const twice = appendSubflow(once, "grid");

    expect(twice.map((n) => n.id)).toEqual(["grid", "grid-2"]);
  });

  it("mints the id against the ids already taken, module and subflow alike", () => {
    const taken: WorkflowNodeDocument[] = [{ id: "grid", moduleId: "grid" }];
    expect(appendSubflow(taken, "grid")).toEqual([
      { id: "grid", moduleId: "grid" },
      { id: "grid-2", workflows: ["grid"] },
    ]);
  });
});

describe("changing a subflow's workflow", () => {
  it("points the node at the new workflow and appends nothing", () => {
    const withSub: WorkflowNodeDocument[] = [
      { id: "a", moduleId: "a" },
      { id: "grid", workflows: ["grid"] },
      { id: "c", moduleId: "c" },
    ];
    const next = chooseSubflowWorkflow(withSub, 1, "other");

    expect(next).toEqual([
      { id: "a", moduleId: "a" },
      { id: "grid", workflows: ["other"] },
      { id: "c", moduleId: "c" },
    ]);
    expect(next).toHaveLength(withSub.length);
  });

  it("leaves a module node at that position untouched", () => {
    const onlyModule: WorkflowNodeDocument[] = [{ id: "a", moduleId: "a" }];
    expect(chooseSubflowWorkflow(onlyModule, 0, "other")).toEqual(onlyModule);
  });
});

describe("removing an entry drops it and everything after it", () => {
  it("keeps only the entries before the cut", () => {
    expect(removeFrom(chain, 1).map((n) => n.id)).toEqual(["a"]);
  });

  it("drops nothing before the cut — a head removal is a full clear", () => {
    expect(removeFrom(chain, 0)).toEqual([]);
  });

  it("removing the last entry drops only itself", () => {
    expect(removeFrom(chain, 2).map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("reports how many entries a cut removes, for the confirm", () => {
    expect(removedCount(chain, 1)).toBe(2);
    expect(removedCount(chain, 2)).toBe(1);
  });
});

describe("moving an entry one position", () => {
  it("moves an entry up by swapping it with the one before it, and nothing else", () => {
    expect(moveNode(chain, 2, "up").map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("moves an entry down by swapping it with the one after it", () => {
    expect(moveNode(chain, 0, "down").map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("leaves the first entry where it is when asked to move up — it has no neighbour to trade with", () => {
    expect(moveNode(chain, 0, "up").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves the last entry where it is when asked to move down", () => {
    expect(moveNode(chain, 2, "down").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("moves a subflow entry like any other node", () => {
    const mixed: WorkflowNodeDocument[] = [
      { id: "a", moduleId: "a" },
      { id: "grid", workflows: ["grid"] },
    ];
    expect(moveNode(mixed, 1, "up").map((n) => n.id)).toEqual(["grid", "a"]);
  });

  it("returns a new list and never mutates the one it was given", () => {
    const next = moveNode(chain, 0, "down");
    expect(chain.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(next).not.toBe(chain);
  });
});
