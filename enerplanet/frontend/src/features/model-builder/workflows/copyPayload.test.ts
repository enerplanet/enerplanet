/** The copy button's payload — what a developer pastes into the backend's seed file (`cmd/seed/default_workflow.json`). */
import { describe, it, expect } from "vitest";

import { copyPayload } from "./document";
import type { WorkflowDocument } from "./types";

describe("the copy payload", () => {
  it("writes the document in the order a person writes it, not the order jsonb returns", () => {
    const fromDatabase = {
      id: "dev-flow",
      seed: "testdata/dev-flow.json",
      label: "Development flow",
      version: 1,
      nodes: [{ moduleId: "model-start", label: "Model start", id: "model-start" }],
    } as unknown as WorkflowDocument;

    expect(copyPayload(fromDatabase)).toBe(
      [
        "{",
        '  "id": "dev-flow",',
        '  "version": 1,',
        '  "label": "Development flow",',
        '  "seed": "testdata/dev-flow.json",',
        '  "nodes": [',
        "    {",
        '      "id": "model-start",',
        '      "moduleId": "model-start",',
        '      "label": "Model start"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("keeps a field it does not recognise, after the ones it does", () => {
    const withUnknown = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [],
      somethingNew: { nested: true },
    } as unknown as WorkflowDocument;

    const copied = copyPayload(withUnknown);

    expect(copied).toContain('"somethingNew"');
    expect(copied.indexOf('"label"')).toBeLessThan(copied.indexOf('"somethingNew"'));
  });
});
