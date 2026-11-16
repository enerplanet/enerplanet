/**
 * The document helpers (plan §9). The one that matters: the copy payload is the stored document,
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
