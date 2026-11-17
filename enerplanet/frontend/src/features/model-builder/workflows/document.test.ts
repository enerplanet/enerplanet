/**
 * The document helpers. The one that matters: the copy payload is the stored document,
 * **pretty-printed with its own key order** — the paste target is a source file, so a diff after a paste
 * must be the change, not a reshuffle.
 *
 * Written failing first.
 */
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
    // The document comes back from Postgres reordered — jsonb sorts by key length and then alphabetically — so
    // `seed` arrives before `version`. Preserving the order it arrives in is not possible for the document and
    // would reshuffle the seed file on the first paste, so the copy stamps the order a person writes instead.
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
    // The fixture the byte-identity claim was missing: a description (the field step 1 added after `label`)
    // and a subflow node (the second kind). Before these keys were ordered, a copy reshuffled the seed file
    // on the first paste — the exact defect this pins.
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
