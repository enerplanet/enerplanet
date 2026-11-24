/** The subflow picker's data: every stored workflow judged, fragments first. */
import { describe, expect, it } from "vitest";
import type { ModuleRegistry } from "../core/flow";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import type { WorkflowLookup } from "./expand";
import { subflowCandidates } from "./subflow";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

function entry(id: string, params: Param[] = []): BuilderModule {
  const module: Module = { id, name: id, params, affect: {}, layout: ["sidebar"] };
  return { module, Component: () => null };
}

const BASE = entry("base", [{ port: "modelName" }]);
const CONSUMER = entry("consumer", [{ port: "buildings", required: true }]);
const CATALOGUE = [BASE, CONSUMER];
const REGISTRY: ModuleRegistry = Object.fromEntries(
  CATALOGUE.map((e) => [e.module.id, e.module]),
);

const node = (id: string, moduleId: string): WorkflowNodeDocument => ({ id, moduleId });

const doc = (
  id: string,
  nodes: WorkflowNodeDocument[],
  extra: Partial<WorkflowDocument> = {},
): WorkflowDocument => ({ id, version: 1, label: id, nodes, ...extra });

const lookupFrom = (...documents: WorkflowDocument[]): WorkflowLookup => {
  const byId = new Map(documents.map((d) => [d.id, d]));
  return (workflowId) => byId.get(workflowId);
};

const noLookup: WorkflowLookup = () => undefined;

describe("the subflow picker's candidates", () => {
  it("lists every stored workflow with its verdict — nothing hidden", () => {
    const ok = doc("ok", [node("b", "base")]);
    const needs = doc("needs", [node("c", "consumer")]);

    const candidates = subflowCandidates(
      [ok, needs],
      new Set(),
      REGISTRY,
      lookupFrom(ok, needs),
      "editing",
    );

    expect(candidates.map((c) => c.document.id)).toEqual(["ok", "needs"]);
    expect(candidates[0].verdict).toEqual({ ok: true });
    expect(candidates[1].verdict).toEqual({ ok: false, reason: "missing", missing: ["buildings"] });
  });

  it("offers the fragment workflows first, keeping the rest in list order", () => {
    const plainA = doc("plain-a", [node("b", "base")]);
    const fragment = doc("frag", [node("b", "base")], { isSubflow: true });
    const plainB = doc("plain-b", [node("b", "base")]);

    const candidates = subflowCandidates(
      [plainA, fragment, plainB],
      new Set(),
      REGISTRY,
      lookupFrom(plainA, fragment, plainB),
      "editing",
    );

    expect(candidates.map((c) => c.document.id)).toEqual(["frag", "plain-a", "plain-b"]);
    expect(candidates[0].fragment).toBe(true);
    expect(candidates[1].fragment).toBe(false);
  });

  it("leaves the workflow being edited in, judged recursive rather than filtered out", () => {
    const editing = doc("editing", [node("b", "base")]);

    const candidates = subflowCandidates([editing], new Set(), REGISTRY, noLookup, "editing");

    expect(candidates.map((c) => c.document.id)).toEqual(["editing"]);
    expect(candidates[0].verdict).toEqual({ ok: false, reason: "recursive" });
  });

  it("refuses an unresolvable candidate — a document naming an undeclared module", () => {
    const broken = doc("broken", [node("x", "undeclared")]);

    const candidates = subflowCandidates([broken], new Set(), REGISTRY, lookupFrom(broken), "editing");

    expect(candidates[0].verdict).toEqual({ ok: false, reason: "unresolved" });
  });

  it("judges against the given prefix — a port the chain already produces makes it addable", () => {
    const needs = doc("needs", [node("c", "consumer")]);

    const candidates = subflowCandidates(
      [needs],
      new Set(["buildings"]),
      REGISTRY,
      lookupFrom(needs),
      "editing",
    );

    expect(candidates[0].verdict).toEqual({ ok: true });
  });
});
