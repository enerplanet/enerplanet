/**
 * The node union's discriminant. `moduleId` xor `workflows` is the
 * structural rule every consumer branches on, so the two failures — a node with neither field, and one with
 * both — are pinned here rather than left to whatever a reader infers.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import { isSubflowNode, nodeProblem, type WorkflowNodeDocument } from "./types";

const MODULE: WorkflowNodeDocument = { id: "m", moduleId: "m", label: "M" };
const SUBFLOW: WorkflowNodeDocument = { id: "s", workflows: ["a", "b"], label: "S" };

describe("nodeProblem — which way the discriminant fails", () => {
  it("accepts a module node and a subflow node", () => {
    expect(nodeProblem(MODULE)).toBeUndefined();
    expect(nodeProblem(SUBFLOW)).toBeUndefined();
  });

  it("names a node that carries neither field", () => {
    const bare = { id: "x" } as unknown as WorkflowNodeDocument;
    expect(nodeProblem(bare)).toMatch(/neither moduleId nor workflows/);
  });

  it("names a node that carries both", () => {
    const both = { id: "x", moduleId: "m", workflows: ["w"] } as unknown as WorkflowNodeDocument;
    expect(nodeProblem(both)).toMatch(/both moduleId and workflows/);
  });
});

describe("isSubflowNode", () => {
  it("recognises the subflow kind structurally, so a stored module node is never mistaken for one", () => {
    expect(isSubflowNode(SUBFLOW)).toBe(true);
    expect(isSubflowNode(MODULE)).toBe(false);
  });
});
