/** The editor's palette, rendered: an unavailable module is greyed and names the port it waits for, and a host module is not offered. `@spatialhub/i18n` is stubbed; there is no DOM, so the editor renders to a string. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";

vi.mock("@spatialhub/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars?.[name] ?? ""));
    },
  }),
}));

import { WorkflowEditor } from "./WorkflowEditor";
import type { WorkflowDocument } from "./types";

function entry(id: string, name: string, params: Param[], layout: Module["layout"] = ["sidebar"]): BuilderModule {
  const module: Module = { id, name, params, affect: {}, layout };
  return { module, Component: () => null };
}

const BASE = entry("base", "Base", [{ port: "modelName" }]);
const PRODUCER = entry("producer", "Producer", [{ port: "buildings" }]);
const CONSUMER = entry("consumer", "Consumer", [{ port: "buildings", required: true }]);
/** In the catalogue — the frame mounts it — but not in the palette, which offers steps. */
const HOST = entry("host", "Provider Host", [], []);

const CATALOGUE = [BASE, PRODUCER, CONSUMER, HOST];

function render(document: WorkflowDocument, dirty = false, workflows: WorkflowDocument[] = []): string {
  return renderToStaticMarkup(
    <WorkflowEditor
      document={document}
      catalogue={CATALOGUE}
      workflows={workflows}
      persisted
      dirty={dirty}
      saving={false}
      error={null}
      onChange={() => {}}
      onSave={() => {}}
      onBack={() => {}}
    />,
  );
}

const empty: WorkflowDocument = { id: "x", version: 1, label: "X", nodes: [] };

describe("the palette reflects the gate", () => {
  it("marks a module whose required port is unmet, naming the port it waits for", () => {
    const html = render(empty);

    expect(html).toContain("Consumer");
    expect(html).toContain("needs"); // the refusal is present...
    expect(html).toContain("buildings"); // ...and names the port it is waiting for
  });

  it("stops refusing once the chain produces the port", () => {
    const satisfied: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [
        { id: "base", moduleId: "base" },
        { id: "producer", moduleId: "producer" },
      ],
    };

    expect(render(satisfied)).not.toContain("needs");
  });

  it("lists every node module, and does not offer the host", () => {
    const html = render(empty);
    for (const module of ["Base", "Producer", "Consumer"]) expect(html).toContain(module);
    expect(html).not.toContain("Provider Host");
  });
});

describe("a fragment", () => {
  const label = "Fragment flow";
  const fragment: WorkflowDocument = { id: "frag", version: 1, label, isSubflow: true, nodes: [] };

  it("badges that a fragment is being edited, not a flow", () => {
    // Precise: the warning also contains the word "fragment", so the assertion targets the badge element.
    expect(render(fragment)).toContain(">fragment</span>");
  });

  it("warns that validation is off, and why — its requirements are read where it is inserted", () => {
    const html = render(fragment);

    // A clear warning panel, not the muted palette hint it replaced.
    expect(html).toContain("Validation is off");
    expect(html).toContain("read where it is inserted");
  });

  it("offers every module without gating", () => {
    const html = render(fragment);

    expect(html).toContain("Consumer");
    expect(html).not.toContain(">needs<");
  });

  it("lists the ports the fragment needs from the flow that inserts it", () => {
    const needsInput: WorkflowDocument = {
      id: "frag",
      version: 1,
      label,
      isSubflow: true,
      nodes: [{ id: "c", moduleId: "consumer" }], // needs `buildings`, unproduced within the fragment
    };
    const html = render(needsInput);

    expect(html).toContain("Needs from the flow that inserts it:");
    expect(html).toContain("buildings"); // the unmet required port, named by the section
    expect(html).not.toContain("This fragment needs nothing from the flow around it.");
  });

  it("says plainly when the fragment needs nothing from around it", () => {
    const selfContained: WorkflowDocument = {
      id: "frag",
      version: 1,
      label,
      isSubflow: true,
      nodes: [{ id: "b", moduleId: "base" }], // requires nothing
    };
    const html = render(selfContained);

    expect(html).toContain("This fragment needs nothing from the flow around it.");
    expect(html).not.toContain("Needs from the flow that inserts it:");
  });
});

describe("a stored node naming an unknown module", () => {
  it("is reported by node and module rather than taking the surface down", () => {
    const broken: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [{ id: "ghost-node", moduleId: "ghost-module" }],
    };
    const html = render(broken);

    expect(html).toContain("Unknown module");
    expect(html).toContain("ghost-module");
    expect(html).toContain("ghost-node");
  });
});

describe("a stored node naming a host module", () => {
  it("is reported as not a node rather than shown as a step", () => {
    const withHost: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [{ id: "host-node", moduleId: "host" }],
    };
    const html = render(withHost);

    expect(html).toContain("is not a node");
    expect(html).toContain("host-node");
  });
});

describe("the header", () => {
  it("shows unsaved changes when the chain is dirty", () => {
    expect(render(empty, true)).toContain("Unsaved changes");
  });
});

describe("a subflow node", () => {
  const GRID: WorkflowDocument = {
    id: "grid",
    version: 1,
    label: "Grid",
    description: "Builds the grid from the buildings.",
    nodes: [{ id: "gen", moduleId: "producer", label: "Producer" }],
  };
  const withSubflow: WorkflowDocument = {
    id: "x",
    version: 1,
    label: "X",
    nodes: [{ id: "s", workflows: ["grid"] }],
  };

  it("offers a control to insert a workflow, apart from the module palette", () => {
    expect(render(empty)).toContain("Insert a workflow");
  });

  it("renders as a bracket naming the referenced workflow and its description", () => {
    const html = render(withSubflow, false, [GRID]);

    expect(html).toContain("subflow");
    expect(html).toContain("Change workflow");
    expect(html).toContain("Grid");
    expect(html).toContain("Builds the grid from the buildings.");
  });

  it("renders the referenced workflow's expansion inside it, ids namespaced and labels prefixed", () => {
    const html = render(withSubflow, false, [GRID]);

    expect(html).toContain("Grid / Producer");
    expect(html).toContain("s/gen");
    expect(html).toContain("Steps from");
  });

  it("says so rather than blanking the bracket when the referenced workflow cannot be expanded", () => {
    const ghost: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [{ id: "s", workflows: ["nope"] }],
    };
    const html = render(ghost, false, [GRID]);

    expect(html).toContain("subflow");
    expect(html).toContain("This workflow cannot be expanded here.");
  });
});

describe("reordering a chain", () => {
  /** How many buttons render disabled — the boolean attribute, not the `disabled:` class. */
  const disabledCount = (html: string): number => (html.match(/disabled=""/g) ?? []).length;

  // A valid three-node flow: `producer` produces `buildings`, `base` nothing, `consumer` reads `buildings`.
  const valid: WorkflowDocument = {
    id: "x",
    version: 1,
    label: "X",
    nodes: [
      { id: "p", moduleId: "producer" },
      { id: "b", moduleId: "base" },
      { id: "c", moduleId: "consumer" },
    ],
  };

  it("offers an up and a down control on every chain row", () => {
    const html = render(valid);

    expect(html).toContain("Move up");
    expect(html).toContain("Move down");
  });

  it("disables only the boundary controls when every move is safe", () => {
    const html = render(valid);

    expect(disabledCount(html)).toBe(2);
    expect(html).not.toContain("unmet");
  });

  it("refuses a move that would break the data flow, naming the port it would leave unmet", () => {
    // `[producer, consumer]` is valid; moving either across the other reads `buildings` before it is produced.
    const flow: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      nodes: [
        { id: "p", moduleId: "producer" },
        { id: "c", moduleId: "consumer" },
      ],
    };
    const html = render(flow);

    expect(html).toContain("unmet"); // the refusal is present...
    expect(html).toContain("buildings"); // ...and names the port it would leave unmet
    expect(disabledCount(html)).toBe(4); // both moves are refused, and both boundaries are disabled
  });

  it("allows every move in a fragment, showing no refusal", () => {
    const fragment: WorkflowDocument = {
      id: "x",
      version: 1,
      label: "X",
      isSubflow: true,
      nodes: [
        { id: "p", moduleId: "producer" },
        { id: "c", moduleId: "consumer" },
      ],
    };
    const html = render(fragment);

    expect(html).toContain("Move up");
    expect(html).not.toContain("unmet");
    expect(disabledCount(html)).toBe(2);
  });
});

describe("authoring suggested next steps", () => {
  const SECTION = {
    key: "insulate",
    label: "Insulate",
    description: "Add insulation and re-run.",
    nodes: [{ id: "buildings", moduleId: "producer", label: "Producer" }],
  };
  const withRecommended: WorkflowDocument = {
    id: "x",
    version: 1,
    label: "X",
    nodes: [{ id: "pv-step", moduleId: "producer", label: "Solar PV" }],
    recommended: [SECTION],
  };
  const GRID: WorkflowDocument = { id: "grid", version: 1, label: "Grid build", nodes: [] };

  it("renders the panel under its own wording and the suggestion's fields", () => {
    const html = render(withRecommended);

    expect(html).toContain("Suggested next steps"); // the panel heading
    expect(html).toContain("Insulate"); // the suggestion's title
    expect(html).toContain("Add insulation and re-run."); // its why (the goal)
    expect(html).toContain("Add a suggestion"); // a control to author more
    expect(html).toContain("Title"); // the title field's label
    expect(html).toContain("Why (the goal)"); // the why field's label
  });

  it("has no step picker — a suggestion always belongs to the chain's tail", () => {
    const html = render(withRecommended);

    expect(html).not.toContain("After which step");
    expect(html).not.toContain("Add suggestions for a step…");
  });

  it("renders no Key field — a suggestion's key is derived, never shown", () => {
    const html = render(withRecommended);

    expect(html).not.toContain(">Key</span>");
  });

  it("names a suggestion's nodes, so the author sees what it appends", () => {
    const html = render(withRecommended);

    // The node reads as its label and its module — the same pair the chain rows show.
    expect(html).toContain("Producer</span>");
  });

  it("offers modules and workflows in a suggestion's step picker", () => {
    const html = render(withRecommended, false, [GRID]);

    expect(html).toContain("Modules");
    expect(html).toContain("Workflows");
    expect(html).toContain("Grid build");
    expect(html).toContain('value="module:producer"');
    expect(html).toContain('value="workflow:grid"');
  });

  it("renders a suggestion whose step is a workflow", () => {
    const subflow: WorkflowDocument = {
      ...withRecommended,
      recommended: [{ ...SECTION, nodes: [{ id: "adjust", workflows: ["grid"], label: "Grid" }] }],
    };
    const html = render(subflow, false, [GRID]);

    expect(html).toContain("Grid");
  });

  it("surfaces a malformed list before a save is attempted, naming the defect", () => {
    const malformed: WorkflowDocument = {
      ...withRecommended,
      recommended: [{ ...SECTION, key: "" }],
    };
    const html = render(malformed);

    expect(html).toContain("malformed");
    expect(html).toContain("blank key");
  });

  it("prompts to author a suggestion when the workflow declares none", () => {
    const html = render(empty);

    expect(html).toContain("Suggested next steps");
    expect(html).toContain("No suggestions yet");
  });

  it("starts folded: the heading is all it shows until it is opened", () => {
    const html = render(withRecommended);

    // Folded by default, so the panel is out of the way — but the heading stays and announces the
    // state, so the follow-ups a workflow offers are still discoverable.
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Suggested next steps</span>");
    expect(html).toContain("hidden px-3 pb-3");
  });
});
