/**
 * The expansion: the id-namespacing of a composed node, the disjoint ids of a subflow inserted twice, and the
 * three refusals (a cycle, an unresolved subflow, an undeclared module).
 */
import { describe, expect, it } from "vitest";
import type { ModuleRegistry } from "../core/flow";
import type { Module } from "../core/module";
import { expand, expansionCycle } from "./expand";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

/** A document with just the fields the expansion reads. */
const doc = (id: string, nodes: WorkflowNodeDocument[], label = id): WorkflowDocument => ({
  id,
  version: 1,
  label,
  nodes,
});

/** The documents an expansion resolves through — the caller's side of the `lookup` seam. */
const lookupFrom = (...documents: WorkflowDocument[]) => {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return (workflowId: string): WorkflowDocument | undefined => byId.get(workflowId);
};

/** A registry declaring the given module ids. */
const registryFor = (...ids: string[]): ModuleRegistry =>
  Object.fromEntries(ids.map((id) => [id, { id } as Module]));

/** A registry declaring every module the documents below place. */
const MODULES: ModuleRegistry = registryFor("a", "b", "f", "n", "s", "x", "y", "z");

describe("flattening a document", () => {
  it("emits a module-only document's nodes unchanged, in order", () => {
    const outer = doc("plain", [
      { id: "a", moduleId: "a", label: "A" },
      { id: "b", moduleId: "b" },
    ]);

    expect(expand(outer, lookupFrom(outer), MODULES)).toEqual([
      { id: "a", moduleId: "a", label: "A" },
      { id: "b", moduleId: "b" },
    ]);
  });

  it("replaces a subflow node with its expansion, spliced in at that position", () => {
    const inner = doc("adjust", [
      { id: "a", moduleId: "a", label: "A" },
      { id: "b", moduleId: "b", label: "B" },
    ], "Adjust");
    const outer = doc("outer", [
      { id: "x", moduleId: "x", label: "X" },
      { id: "y", workflows: ["adjust"], label: "Y" },
      { id: "z", moduleId: "z", label: "Z" },
    ]);

    expect(expand(outer, lookupFrom(outer, inner), MODULES)).toEqual([
      { id: "x", moduleId: "x", label: "X" },
      { id: "y/a", moduleId: "a", label: "Y / A" },
      { id: "y/b", moduleId: "b", label: "Y / B" },
      { id: "z", moduleId: "z", label: "Z" },
    ]);
  });

  it("composes a subflow inside a subflow, nesting the id and label prefixes", () => {
    const leaf = doc("leaf", [{ id: "n", moduleId: "n", label: "N" }], "Leaf");
    const mid = doc("mid", [{ id: "l", workflows: ["leaf"], label: "L" }], "Mid");
    const root = doc("root", [{ id: "m", workflows: ["mid"], label: "M" }], "Root");

    expect(expand(root, lookupFrom(root, mid, leaf), MODULES)).toEqual([
      { id: "m/l/n", moduleId: "n", label: "M / L / N" },
    ]);
  });

  it("gives the same subflow inserted twice disjoint ids, so neither insertion shares a log slot", () => {
    const adjust = doc("adjust", [{ id: "n", moduleId: "n", label: "N" }], "Adjust");
    const outer = doc("outer", [
      { id: "a", workflows: ["adjust"], label: "A" },
      { id: "b", workflows: ["adjust"], label: "B" },
    ]);

    const flow = expand(outer, lookupFrom(outer, adjust), MODULES);
    expect(flow.map((node) => node.id)).toEqual(["a/n", "b/n"]);
    expect(flow.map((node) => node.label)).toEqual(["A / N", "B / N"]);
  });

  it("names a subflow's group by the referenced workflow when the node carries no label", () => {
    const adjust = doc("adjust", [{ id: "n", moduleId: "n", label: "N" }], "Adjust");
    const outer = doc("outer", [{ id: "c", workflows: ["adjust"] }]);

    expect(expand(outer, lookupFrom(outer, adjust), MODULES)).toEqual([
      { id: "c/n", moduleId: "n", label: "Adjust / N" },
    ]);
  });

  it("leaves a node with no label unlabelled, rather than inventing one", () => {
    const inner = doc("adjust", [{ id: "n", moduleId: "n" }], "Adjust");
    const outer = doc("outer", [{ id: "c", workflows: ["adjust"], label: "C" }]);

    expect(expand(outer, lookupFrom(outer, inner), MODULES)).toEqual([{ id: "c/n", moduleId: "n" }]);
  });
});

describe("the choice of which workflow a subflow expands to", () => {
  it("defaults to the first candidate — the whole of the single-candidate case", () => {
    const first = doc("first", [{ id: "f", moduleId: "f", label: "F" }], "First");
    const second = doc("second", [{ id: "s", moduleId: "s", label: "S" }], "Second");
    const outer = doc("outer", [{ id: "c", workflows: ["first", "second"], label: "C" }]);

    const flow = expand(outer, lookupFrom(outer, first, second), MODULES);
    expect(flow.map((node) => node.moduleId)).toEqual(["f"]);
  });

  it("honours a `choose` when given, so the several-candidate case resolves through the seam", () => {
    const first = doc("first", [{ id: "f", moduleId: "f", label: "F" }], "First");
    const second = doc("second", [{ id: "s", moduleId: "s", label: "S" }], "Second");
    const outer = doc("outer", [{ id: "c", workflows: ["first", "second"], label: "C" }]);

    const flow = expand(outer, lookupFrom(outer, first, second), MODULES, (node) => node.workflows[1] ?? "");
    expect(flow.map((node) => node.moduleId)).toEqual(["s"]);
  });
});

describe("the refusals", () => {
  it("throws on a subflow that resolves back to a workflow already being expanded", () => {
    const root = doc("root", [{ id: "loop", workflows: ["root"], label: "Loop" }]);

    expect(() => expand(root, lookupFrom(root), MODULES)).toThrow(
      /revisits workflow "root" \(root -> root\)/,
    );
  });

  it("throws on a cycle that is transitive, not immediate", () => {
    const a = doc("a", [{ id: "to-b", workflows: ["b"], label: "To B" }], "A");
    const b = doc("b", [{ id: "to-a", workflows: ["a"], label: "To A" }], "B");

    expect(() => expand(a, lookupFrom(a, b), MODULES)).toThrow(/revisits workflow "a" \(a -> b -> a\)/);
  });

  it("reports the cycle path without throwing, for the editor's candidate exclusion", () => {
    const root = doc("root", [{ id: "loop", workflows: ["root"], label: "Loop" }]);

    expect(expansionCycle(root, lookupFrom(root))).toEqual(["root", "root"]);
  });

  it("reports an acyclic expansion as no cycle", () => {
    const inner = doc("adjust", [{ id: "n", moduleId: "n" }], "Adjust");
    const root = doc("root", [{ id: "c", workflows: ["adjust"], label: "C" }]);

    expect(expansionCycle(root, lookupFrom(root, inner))).toBeUndefined();
  });

  it("throws, naming the node and the workflow, on a subflow nobody stores", () => {
    const outer = doc("outer", [{ id: "ghost", workflows: ["nope"], label: "Ghost" }]);

    expect(() => expand(outer, lookupFrom(outer), MODULES)).toThrow(
      /workflow "outer" node "ghost": subflow workflow "nope" is not a stored workflow/,
    );
  });

  it("throws, naming the node, on a node whose module nobody declared", () => {
    const outer = doc("outer", [{ id: "n", moduleId: "not-a-module", label: "N" }]);

    expect(() => expand(outer, lookupFrom(outer), MODULES)).toThrow(
      /workflow "outer" node "n": moduleId "not-a-module" is not declared/,
    );
  });

  it("holds a child workflow to the same module check, naming the child's own node", () => {
    const inner = doc("adjust", [{ id: "n", moduleId: "not-a-module", label: "N" }], "Adjust");
    const outer = doc("outer", [{ id: "c", workflows: ["adjust"], label: "C" }]);

    expect(() => expand(outer, lookupFrom(outer, inner), MODULES)).toThrow(
      /workflow "adjust" node "n": moduleId "not-a-module" is not declared/,
    );
  });

  it("refuses a node carrying both fields, rather than reading it as a subflow", () => {
    const inner = doc("adjust", [{ id: "n", moduleId: "n" }], "Adjust");
    const outer = doc("outer", [
      { id: "x", moduleId: "a", workflows: ["adjust"] } as WorkflowNodeDocument,
    ]);

    expect(() => expand(outer, lookupFrom(outer, inner), MODULES)).toThrow(
      /workflow "outer" node "x": a node carries both moduleId and workflows/,
    );
  });

  it("refuses a node carrying neither field", () => {
    const outer = doc("outer", [{ id: "x" } as WorkflowNodeDocument]);

    expect(() => expand(outer, lookupFrom(outer), MODULES)).toThrow(
      /workflow "outer" node "x": a node carries neither moduleId nor workflows/,
    );
  });
});
