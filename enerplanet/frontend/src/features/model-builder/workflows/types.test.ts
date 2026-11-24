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

describe("documentProblem — a recommended list is untrusted input", () => {
  it("accepts a document with no list, an empty list, and a well-formed one", () => {
    expect(documentProblem(docWith(undefined))).toBeUndefined();
    expect(documentProblem(docWith([]))).toBeUndefined();
    expect(documentProblem(docWith([OK_SECTION, { ...OK_SECTION, key: "other" }]))).toBeUndefined();
  });

  it("names a suggestion with a blank key", () => {
    expect(documentProblem(docWith([{ ...OK_SECTION, key: "  " }]))).toMatch(/blank key/);
  });

  it("names two suggestions that share a title within the workflow", () => {
    expect(documentProblem(docWith([OK_SECTION, { ...OK_SECTION }]))).toMatch(/share the title "Insulate"/);
  });

  it("falls back to the key when the second suggestion's title is blank", () => {
    expect(documentProblem(docWith([OK_SECTION, { ...OK_SECTION, key: "insulate", label: "" }]))).toMatch(
      /share the title "insulate"/,
    );
  });

  it("names a section whose node fails the discriminant", () => {
    const bad = { id: "x" } as unknown as WorkflowNodeDocument;
    expect(documentProblem(docWith([{ ...OK_SECTION, nodes: [bad] }]))).toMatch(/malformed node/);
  });

  it("names a recommended value that is not a list", () => {
    const notList = { insulate: [OK_SECTION] } as unknown as RecommendedSection[];
    expect(documentProblem(docWith(notList))).toMatch(/not a list/);
  });
});
