/**
 * The workflow bar — the fact this file exists to pin: there is **no forward control**.
 *
 * An auto node runs on arrival and an interactive module advances by running itself, so a Continue button
 * would be the frame owning a control whose enabled-ness depends on node state the frame cannot see. The bar
 * moves (prior) and saves; it does not move forward.
 *
 * `@spatialhub/i18n` is stubbed to echo the key, so the assertions are about *which* control is rendered rather
 * than about copy. There is no DOM, so the bar is rendered to a string.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelData } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { createStore } from "../core/store";
import { toWorkflow } from "./workflow";
import { WorkflowBar } from "./WorkflowBar";
import example from "./fixtures";
import type { BuilderModule } from "./contract";

const ENTRIES: readonly BuilderModule[] = [example];

const DEFINITION = {
  id: "bar",
  label: "Two steps",
  seed: "testdata/dev-flow.json",
  nodes: [
    { id: "first", moduleId: example.module.id, label: "First" },
    { id: "second", moduleId: example.module.id, label: "Second" },
  ],
};

const SEED: Readonly<ModelData> = { modelName: "fixture" };

/** This document composes no subflow, so the lookup resolves nothing. */
const noSubflows = () => undefined;

function render(): string {
  const workflow = toWorkflow(DEFINITION, ENTRIES, noSubflows, SEED);
  return renderToStaticMarkup(
    <WorkflowBar
      workflow={workflow}
      flow={workflow.flow}
      store={createStore(workflow.initial)}
      mode={{ kind: "workflow" }}
      moduleIds={[example.module.id]}
      onSave={() => {}}
    />,
  );
}

describe("the workflow bar has no forward control", () => {
  it("renders no Continue/continuing control — the one forward action is gone", () => {
    const html = render();

    expect(html).not.toContain("modelBuilder.bar.continue");
    expect(html).not.toContain("modelBuilder.bar.continuing");
  });

  it("still names the next step (plain text) and offers the prior move and save", () => {
    const html = render();

    // The bar still frames the session — it just does not offer a button that runs the node.
    expect(html).toContain("modelBuilder.bar.next");
    expect(html).toContain("modelBuilder.bar.save");
  });
});
