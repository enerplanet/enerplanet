/**
 * The editor's palette, rendered. The pure gate is proven in `gate.test.ts`; these pin that the
 * *rendered* palette reflects it — an unavailable module is greyed and names the port it waits for, and it
 * becomes addable once the chain produces that port. A host module is not offered at all, and a stored node
 * naming one — or naming an unknown module — is reported rather than fatal.
 *
 * `@spatialhub/i18n` is stubbed to echo a fallback with its variables filled, so the assertions are about
 * which controls are rendered rather than about copy. There is no DOM, so the editor is rendered to a string.
 */
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
  // A fragment is authored to be spliced into another flow, so the editor must not gate it on its own
  // prefix. `render` passes no workflows, so the only signal read here is `isSubflow` on the document.
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

    // The same Consumer the flow test greys and marks `needs` is addable here — the palette's refusal marker
    // (`>needs<`) is absent, and nothing is greyed.
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
    // The catalogue holds the module, so this is not the unknown-module case: the node is naming something
    // real that simply was never a step, which is the mistake the palette's exclusion exists to prevent.
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

    // The child node as `expand` composes it inside this document: id namespaced by the subflow node,
    // label prefixed with the container's — and marked as belonging to the other workflow, not editable here.
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
    // The first row cannot move up and the last cannot move down; the four interior directions are all safe,
    // so exactly two controls are disabled and no refusal is shown.
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
    // The same breaking order, but a fragment is judged where it is inserted, so the data-flow check is off:
    // only the two boundaries are disabled, and no refusal appears.
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
