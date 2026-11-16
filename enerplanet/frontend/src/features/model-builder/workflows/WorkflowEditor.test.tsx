/**
 * The editor's palette, rendered (plan §9). The pure gate is proven in `gate.test.ts`; these pin that the
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

function render(document: WorkflowDocument, dirty = false): string {
  return renderToStaticMarkup(
    <WorkflowEditor
      document={document}
      catalogue={CATALOGUE}
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
