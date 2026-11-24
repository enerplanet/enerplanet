/** Editing the `recommended` map: what each helper authors (a new map, the old one untouched). */
import { describe, expect, it } from "vitest";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import { copyPayload } from "./document";
import type { RecommendedSection, WorkflowDocument } from "./types";
import {
  recommendedNode,
  renamedTerminal,
  updatedSection,
  withSection,
  withSectionNode,
  withTerminal,
  withoutSection,
  withoutSectionNode,
  withoutTerminal,
  type RecommendedMap,
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

const MAP: RecommendedMap = { "model-start": [INSULATE] };

function entry(id: string, name: string, params: Param[] = []): BuilderModule {
  const module: Module = { id, name, params, affect: {}, layout: ["sidebar"] };
  return { module, Component: () => null };
}

describe("naming a terminal", () => {
  it("adds an empty entry for a name the map does not carry", () => {
    expect(withTerminal(MAP, "run-pypsa")).toEqual({ "model-start": [INSULATE], "run-pypsa": [] });
  });

  it("leaves an existing name as it is and ignores a blank one", () => {
    expect(withTerminal(MAP, "model-start")).toBe(MAP);
    expect(withTerminal(MAP, "")).toBe(MAP);
  });

  it("reads an absent map as empty", () => {
    expect(withTerminal(undefined, "run-pypsa")).toEqual({ "run-pypsa": [] });
  });
});

describe("removing a terminal", () => {
  it("drops the named entry and leaves the rest", () => {
    const map: RecommendedMap = { a: [INSULATE], b: [COMPARE] };
    expect(withoutTerminal(map, "a")).toEqual({ b: [COMPARE] });
  });

  it("returns the map unchanged for a name it does not carry", () => {
    expect(withoutTerminal(MAP, "nope")).toBe(MAP);
  });
});

describe("renaming a terminal key", () => {
  it("moves the sections under the new name, keeping position", () => {
    const map: RecommendedMap = { a: [INSULATE], b: [COMPARE] };
    const renamed = renamedTerminal(map, "a", "start");
    expect(Object.keys(renamed)).toEqual(["start", "b"]);
    expect(renamed.start).toEqual([INSULATE]);
  });

  it("merges the two section lists when the target name already exists", () => {
    const map: RecommendedMap = { a: [INSULATE], b: [COMPARE] };
    const renamed = renamedTerminal(map, "a", "b");
    expect(Object.keys(renamed)).toEqual(["b"]);
    expect(renamed.b).toEqual([COMPARE, INSULATE]);
  });

  it("returns the map unchanged for a blank new name or an unchanged one", () => {
    expect(renamedTerminal(MAP, "model-start", "")).toBe(MAP);
    expect(renamedTerminal(MAP, "model-start", "model-start")).toBe(MAP);
    expect(renamedTerminal(MAP, "ghost", "x")).toBe(MAP);
  });
});

describe("sections under a terminal", () => {
  it("appends a section, naming the terminal if it is not there yet", () => {
    expect(withSection(MAP, "model-start", COMPARE)).toEqual({
      "model-start": [INSULATE, COMPARE],
    });
    expect(withSection(undefined, "model-start", COMPARE)).toEqual({ "model-start": [COMPARE] });
  });

  it("removes a section by key, and drops a terminal left with none", () => {
    expect(withoutSection(MAP, "model-start", "insulate")).toEqual({});
    const two: RecommendedMap = { "model-start": [INSULATE, COMPARE] };
    expect(withoutSection(two, "model-start", "insulate")).toEqual({ "model-start": [COMPARE] });
  });

  it("returns the map unchanged for a section or terminal it does not carry", () => {
    expect(withoutSection(MAP, "model-start", "nope")).toBe(MAP);
    expect(withoutSection(MAP, "ghost", "insulate")).toBe(MAP);
  });

  it("patches a section's own fields, and can rename its key in place", () => {
    expect(updatedSection(MAP, "model-start", "insulate", { label: "Insulate walls" })).toEqual({
      "model-start": [{ ...INSULATE, label: "Insulate walls" }],
    });
    const renamed = updatedSection(MAP, "model-start", "insulate", { key: "insulation" });
    expect(renamed["model-start"][0].key).toBe("insulation");
  });

  it("returns the map unchanged when nothing matches", () => {
    expect(updatedSection(MAP, "model-start", "nope", { label: "x" })).toBe(MAP);
  });
});

describe("nodes of a section", () => {
  const node = { id: "run", moduleId: "run-pypsa" };

  it("appends a node to the named section", () => {
    expect(withSectionNode(MAP, "model-start", "insulate", node)).toEqual({
      "model-start": [{ ...INSULATE, nodes: [...INSULATE.nodes, node] }],
    });
  });

  it("removes a node by position", () => {
    const two: RecommendedMap = {
      "model-start": [{ ...INSULATE, nodes: [INSULATE.nodes[0], node] }],
    };
    expect(withoutSectionNode(two, "model-start", "insulate", 0)).toEqual({
      "model-start": [{ ...INSULATE, nodes: [node] }],
    });
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
});

describe("purity", () => {
  it("does not mutate the map it is handed", () => {
    const before = JSON.parse(JSON.stringify(MAP)) as RecommendedMap;
    withSection(MAP, "model-start", COMPARE);
    withoutSection(MAP, "model-start", "insulate");
    renamedTerminal(MAP, "model-start", "renamed");
    withSectionNode(MAP, "model-start", "insulate", { id: "x", moduleId: "x" });

    expect(MAP).toEqual(before);
  });
});

describe("a map authored here round-trips through copyPayload", () => {
  it("survives the copy's canonicalisation unchanged — the map, its sections and its nodes", () => {
    const map = withSectionNode(
      withSection(withTerminal(undefined, "model-start"), "model-start", INSULATE),
      "model-start",
      "insulate",
      { id: "run", moduleId: "run-pypsa", label: "Run" },
    );
    const document = { id: "x", version: 1, label: "X", nodes: [{ id: "model-start", moduleId: "model-start" }], recommended: map };

    const round = JSON.parse(copyPayload(document)) as WorkflowDocument;
    expect(round).toEqual(document);
    expect(Object.keys(round.recommended?.["model-start"]?.[0] ?? {})).toEqual([
      "key",
      "label",
      "description",
      "nodes",
    ]);
  });
});
