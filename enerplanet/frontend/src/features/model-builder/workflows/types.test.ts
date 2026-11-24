/** The node union's discriminant: `moduleId` xor `workflows`. */
import { describe, expect, it } from "vitest";
import { documentProblem, isSubflowNode, nodeProblem, type RecommendedSection, type WorkflowDocument, type WorkflowNodeDocument } from "./types";

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

const OK_SECTION: RecommendedSection = {
  key: "insulate",
  label: "Insulate",
  description: "Add insulation.",
  nodes: [MODULE],
};

const docWith = (recommended: WorkflowDocument["recommended"]): WorkflowDocument => ({
  id: "x",
  version: 1,
  label: "X",
  nodes: [MODULE],
  recommended,
});

describe("documentProblem — a recommended map is untrusted input", () => {
  it("accepts a document with no recommended map, and one that is well-formed", () => {
    expect(documentProblem(docWith(undefined))).toBeUndefined();
    expect(documentProblem(docWith({ m: [OK_SECTION], "seed-node": [{ ...OK_SECTION, key: "other" }] }))).toBeUndefined();
  });

  it("names a blank terminal name", () => {
    expect(documentProblem(docWith({ "": [OK_SECTION] }))).toMatch(/blank terminal name/);
  });

  it("names a section with a blank key", () => {
    expect(documentProblem(docWith({ m: [{ ...OK_SECTION, key: "  " }] }))).toMatch(/blank key/);
  });

  it("names two sections that share a key within the workflow", () => {
    const dup = { m: [OK_SECTION], "seed-node": [{ ...OK_SECTION, key: "insulate" }] };
    expect(documentProblem(docWith(dup))).toMatch(/share the key "insulate"/);
  });

  it("names a section whose node fails the discriminant", () => {
    const bad = { id: "x" } as unknown as WorkflowNodeDocument;
    expect(documentProblem(docWith({ m: [{ ...OK_SECTION, nodes: [bad] }] }))).toMatch(/malformed node/);
  });
});
