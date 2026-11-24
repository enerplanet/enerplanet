/** Editing the `recommended` list: what each helper authors (a new list, the old one untouched). */
import { describe, expect, it } from "vitest";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import { copyPayload } from "./document";
import type { RecommendedSection, WorkflowDocument } from "./types";
import {
  recommendedNode,
  recommendedSubflow,
  sectionKey,
  updatedSection,
  withSection,
  withSectionNode,
  withoutSection,
  withoutSectionNode,
} from "./recommendedEdit";

const INSULATE: RecommendedSection = {
  key: "insulate",
  label: "Insulate",
  description: "Add insulation.",
  nodes: [{ id: "buildings", moduleId: "building-configurator" }],
};
const COMPARE: RecommendedSection = {
  key: "compare",
  label: "Compare",
  description: "Compare two runs.",
  nodes: [{ id: "compare", moduleId: "compare-variant" }],
};

const LIST: RecommendedSection[] = [INSULATE];

function entry(id: string, name: string, params: Param[] = []): BuilderModule {
  const module: Module = { id, name, params, affect: {}, layout: ["sidebar"] };
  return { module, Component: () => null };
}

describe("a section key derived from its title", () => {
  it("slugifies the title, transliterating umlauts", () => {
    expect(sectionKey("Hello world", [])).toBe("hello-world");
    expect(sectionKey("Öl-Kessel", [])).toBe("oel-kessel");
  });

  it("suffixes a key already taken, so two titles that slug alike both get one", () => {
    expect(sectionKey("Öl Kessel", ["oel-kessel"])).toBe("oel-kessel-2");
    expect(sectionKey("Öl Kessel", ["oel-kessel", "oel-kessel-2"])).toBe("oel-kessel-3");
  });

  it("falls back to a fixed key when the title slugs to nothing", () => {
    expect(sectionKey("!!!", [])).toBe("suggestion");
    expect(sectionKey("···", ["suggestion"])).toBe("suggestion-2");
  });
});

describe("a list of suggestions", () => {
  it("appends a section, and reads an absent list as empty", () => {
    expect(withSection(LIST, COMPARE)).toEqual([INSULATE, COMPARE]);
    expect(withSection(undefined, COMPARE)).toEqual([COMPARE]);
  });

  it("removes a section by key", () => {
    expect(withoutSection([INSULATE, COMPARE], "insulate")).toEqual([COMPARE]);
    expect(withoutSection(LIST, "insulate")).toEqual([]);
  });

  it("returns the list unchanged for a key it does not carry", () => {
    expect(withoutSection(LIST, "nope")).toEqual(LIST);
  });

  it("patches a section's own fields, and can replace its key in place", () => {
    expect(updatedSection(LIST, "insulate", { label: "Insulate walls" })).toEqual([
      { ...INSULATE, label: "Insulate walls" },
    ]);
    const renamed = updatedSection(LIST, "insulate", { key: "insulation" });
    expect(renamed[0].key).toBe("insulation");
  });

  it("returns the list unchanged when nothing matches", () => {
    expect(updatedSection(LIST, "nope", { label: "x" })).toEqual(LIST);
  });
});

describe("nodes of a section", () => {
  const node = { id: "run", moduleId: "run-pypsa" };

  it("appends a node to the named section", () => {
    expect(withSectionNode(LIST, "insulate", node)).toEqual([{ ...INSULATE, nodes: [...INSULATE.nodes, node] }]);
  });

  it("removes a node by position", () => {
    const two = [{ ...INSULATE, nodes: [INSULATE.nodes[0], node] }];
    expect(withoutSectionNode(two, "insulate", 0)).toEqual([{ ...INSULATE, nodes: [node] }]);
  });

  it("reads a module into a node, minting a unique id against the section's existing nodes", () => {
    const module = entry("building-configurator", "Building configurator");
    expect(recommendedNode(module, [])).toEqual({
      id: "building-configurator",
      moduleId: "building-configurator",
      label: "Building configurator",
    });
    expect(recommendedNode(module, [{ id: "building-configurator", moduleId: "building-configurator" }])).toEqual({
      id: "building-configurator-2",
      moduleId: "building-configurator",
      label: "Building configurator",
    });
  });

  it("reads a workflow into a subflow node, minting a unique id against the section's existing nodes", () => {
    expect(recommendedSubflow("adjust-flow", [])).toEqual({ id: "adjust-flow", workflows: ["adjust-flow"] });
    expect(recommendedSubflow("adjust-flow", [{ id: "adjust-flow", workflows: ["adjust-flow"] }])).toEqual({
      id: "adjust-flow-2",
      workflows: ["adjust-flow"],
    });
  });
});

describe("purity", () => {
  it("does not mutate the list it is handed", () => {
    const before = JSON.parse(JSON.stringify(LIST)) as RecommendedSection[];
    withSection(LIST, COMPARE);
    withoutSection(LIST, "insulate");
    updatedSection(LIST, "insulate", { label: "x" });
    withSectionNode(LIST, "insulate", { id: "x", moduleId: "x" });
    withoutSectionNode(LIST, "insulate", 0);

    expect(LIST).toEqual(before);
  });
});

describe("a list authored here round-trips through copyPayload", () => {
  it("survives the copy's canonicalisation unchanged — the list, its sections and its nodes", () => {
    const list = withSectionNode(
      withSection(undefined, INSULATE),
      "insulate",
      { id: "run", moduleId: "run-pypsa", label: "Run" },
    );
    const document = { id: "x", version: 1, label: "X", nodes: [{ id: "model-start", moduleId: "model-start" }], recommended: list };

    const round = JSON.parse(copyPayload(document)) as WorkflowDocument;
    expect(round).toEqual(document);
    expect(Object.keys(round.recommended?.[0] ?? {})).toEqual(["key", "label", "description", "nodes"]);
  });
});
