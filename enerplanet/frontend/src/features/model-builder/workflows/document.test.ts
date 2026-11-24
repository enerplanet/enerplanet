/** The document helpers: the copy payload is the stored document, pretty-printed in its own key order. */
import { describe, expect, it } from "vitest";
import { copyPayload, documentWithNodes, newDocument, slugify } from "./document";
import type { WorkflowDocument } from "./types";

describe("slugify — the id derived from a label", () => {
  it("lowercases and joins runs of non-alphanumerics with single dashes", () => {
    expect(slugify("My Development Flow")).toBe("my-development-flow");
    expect(slugify("  Weird --  name!! ")).toBe("weird-name");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  A/B test  ")).toBe("a-b-test");
  });

  it("transliterates umlauts rather than dropping them", () => {
    expect(slugify("Öl-Kessel")).toBe("oel-kessel");
    expect(slugify("Änderung der Größe")).toBe("aenderung-der-groesse");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("strips accents it has no transliteration for", () => {
    expect(slugify("Café Écologie")).toBe("cafe-ecologie");
  });
});

describe("a new document", () => {
  it("derives its id from the label and starts at version 1", () => {
    expect(newDocument("Heat pump study")).toEqual({
      id: "heat-pump-study",
      version: 1,
      label: "Heat pump study",
      nodes: [],
    });
  });

  it("authors a fragment the same way — marked isSubflow, still version 1 and no nodes", () => {
    expect(newDocument("Adjust model", true)).toEqual({
      id: "adjust-model",
      version: 1,
      label: "Adjust model",
      isSubflow: true,
      nodes: [],
    });
  });
});

describe("the copy payload", () => {
  it("is the stored document, pretty-printed with two-space indentation", () => {
    const doc: WorkflowDocument = { id: "dev-flow", version: 1, label: "Development flow", nodes: [] };
    const payload = copyPayload(doc);

    expect(payload).toContain("\n  \"id\": \"dev-flow\",");
    // A source file: the paste target ends its line.
    expect(payload.endsWith("\n")).toBe(true);
  });

  it("imposes the canonical order, because jsonb cannot preserve the document's", () => {
    const stored = JSON.parse('{"id":"x","version":2,"label":"X","seed":"a.json","nodes":[]}') as WorkflowDocument;
    const round = JSON.parse(copyPayload(stored)) as Record<string, unknown>;

    expect(Object.keys(round)).toEqual(["id", "version", "label", "seed", "nodes"]);
  });

  it("orders each node's keys too, rather than trusting the order they arrive in", () => {
    const stored = JSON.parse(
      '{"id":"x","version":1,"label":"X","nodes":[{"moduleId":"m","label":"L","id":"n"}]}',
    ) as WorkflowDocument;
    const round = JSON.parse(copyPayload(stored)) as { nodes: Record<string, unknown>[] };

    expect(Object.keys(round.nodes[0])).toEqual(["id", "moduleId", "label"]);
  });

  it("places description and isSubflow after label, where the seed file writes them", () => {
    const stored = JSON.parse(
      '{"seed":"a.json","nodes":[],"isSubflow":true,"label":"X","description":"A flow.","version":1,"id":"x"}',
    ) as WorkflowDocument;
    const round = JSON.parse(copyPayload(stored)) as Record<string, unknown>;

    expect(Object.keys(round)).toEqual(["id", "version", "label", "description", "isSubflow", "seed", "nodes"]);
  });

  it("orders a subflow node's keys by its own kind, not the module kind's", () => {
    const stored = JSON.parse(
      '{"id":"x","version":1,"label":"X","nodes":[{"label":"Y","workflows":["a","b"],"id":"y"}]}',
    ) as WorkflowDocument;
    const round = JSON.parse(copyPayload(stored)) as { nodes: Record<string, unknown>[] };

    expect(Object.keys(round.nodes[0])).toEqual(["id", "workflows", "label"]);
  });

  it("writes a document with a description and a subflow node byte-identically, so an unchanged one pastes back as a no-op", () => {
    const stored = JSON.parse(
      `{
      "id": "dev-flow",
      "version": 1,
      "label": "Development flow",
      "description": "The default development flow.",
      "seed": "testdata/dev-flow.json",
      "nodes": [
        { "id": "model-start", "moduleId": "model-start", "label": "Model start" },
        { "id": "adjust", "workflows": ["adjust-flow", "cheap-flow"], "label": "Adjust" }
      ]
    }`,
    ) as WorkflowDocument;

    expect(copyPayload(stored)).toBe(
      [
        "{",
        '  "id": "dev-flow",',
        '  "version": 1,',
        '  "label": "Development flow",',
        '  "description": "The default development flow.",',
        '  "seed": "testdata/dev-flow.json",',
        '  "nodes": [',
        "    {",
        '      "id": "model-start",',
        '      "moduleId": "model-start",',
        '      "label": "Model start"',
        "    },",
        "    {",
        '      "id": "adjust",',
        '      "workflows": [',
        '        "adjust-flow",',
        '        "cheap-flow"',
        "      ],",
        '      "label": "Adjust"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("a saved document", () => {
  it("keeps a field the editor does not author (the seed) and its position", () => {
    const base: WorkflowDocument = { id: "x", version: 1, label: "X", seed: "a.json", nodes: [] };
    const saved = documentWithNodes(base, [{ id: "n", moduleId: "m" }]);

    expect(saved.seed).toBe("a.json");
    expect(Object.keys(saved)).toEqual(["id", "version", "label", "seed", "nodes"]);
    expect(saved.nodes).toEqual([{ id: "n", moduleId: "m" }]);
  });
});

describe("a copy of a document with recommended sections", () => {
  const SECTION = {
    key: "insulate",
    label: "Insulate",
    description: "Add insulation.",
    nodes: [{ id: "b", moduleId: "building-configurator" }],
  };
  const doc: WorkflowDocument = {
    id: "dev-flow",
    version: 1,
    label: "Development flow",
    nodes: [{ id: "model-start", moduleId: "model-start" }],
    recommended: [SECTION],
  };

  it("round-trips the recommended list, so a copy pastes back with its follow-ups intact", () => {
    const round = JSON.parse(copyPayload(doc)) as WorkflowDocument;
    expect(round.recommended).toEqual(doc.recommended);
  });

  it("orders the list after nodes and each section's own keys, rather than trusting arrival order", () => {
    const shuffled = JSON.parse(
      '{"id":"x","version":1,"label":"X","nodes":[],"recommended":[{"description":"D","label":"L","nodes":[{"moduleId":"m","id":"b"}],"key":"k"}]}',
    ) as WorkflowDocument;
    const round = JSON.parse(copyPayload(shuffled)) as Record<string, unknown> & {
      recommended: Array<Record<string, unknown> & { nodes: Array<Record<string, unknown>> }>;
    };

    expect(Object.keys(round)).toEqual(["id", "version", "label", "nodes", "recommended"]);
    expect(Object.keys(round.recommended[0])).toEqual(["key", "label", "description", "nodes"]);
    expect(Object.keys(round.recommended[0].nodes[0])).toEqual(["id", "moduleId"]);
  });
});
