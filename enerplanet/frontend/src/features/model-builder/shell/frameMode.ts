/**
 * Which module the frame shows, and what its session starts from (`spec/frame.md` §5, step 3b).
 *
 * Two modes:
 *
 *   workflow   the module is the node the session sits on, and the data is the workflow's seed
 *   test       one module on its own, seeded from its own test data, with no workflow and no position
 *
 * Test mode is what lets a module be built and *seen* before it is placed in anything — which is why this is
 * a derivation with its own cases rather than conditionals in the JSX: the module it shows is precisely the
 * one a workflow does not place.
 *
 * It also owns one lookup the rest of the frame cannot do. The core's registry maps a module id to the
 * contract (`Module`) and knows nothing about UI, so a host that needs to *render* a module keeps its own
 * lookup into the module entries. That lookup lives here, next to the decision that needs it.
 *
 * `required` is not enforced in test mode — not because the rule is relaxed, but because nothing can be
 * missing: a module's own test data is what seeds the store, and the module's contract test asserts that
 * data covers every port it declares required.
 */

import type { ModelData } from "@model-builder/core";
import { currentId } from "../core/rerun";
import type { Store } from "../core/store";
import type { BuilderModule } from "./contract";
import type { Workflow } from "./workflow";

/** How the frame is being used: following a workflow, or showing a single module on its own. */
export type FrameMode = { kind: "workflow" } | { kind: "test"; moduleId: string };

export interface FrameView {
  /** The module to render, or nothing when there is nothing to show. */
  entry?: BuilderModule;
  /**
   * The id a module's UI is handed. In a workflow that is the **node** id — history names positions, and one
   * module can be placed more than once. In test mode there is no position, so it is the module id, and it
   * exists only as a label.
   */
  labelId: string;
  /** The node a run is stamped with. Absent in test mode: there is no position to stamp. */
  nodeId?: string;
  /** What the session's store starts from. */
  seed: Readonly<ModelData>;
}

export function frameView(
  mode: FrameMode,
  workflow: Workflow,
  entries: readonly BuilderModule[],
  store: Store,
): FrameView {
  const byModuleId = new Map(entries.map((entry) => [entry.module.id, entry]));

  if (mode.kind === "test") {
    const entry = byModuleId.get(mode.moduleId);
    return {
      ...(entry === undefined ? {} : { entry }),
      labelId: mode.moduleId,
      // The module's own test data is the whole seed: in test mode nothing has to pre-exist.
      seed: entry?.mock ?? {},
    };
  }

  // Complete flows keep the last node (`currentId`'s rule), so the frame stays on the module that finished
  // rather than emptying out.
  const nodeId = currentId(workflow.flow, workflow.registry, store);
  const node = workflow.flow.find((candidate) => candidate.id === nodeId);
  if (node === undefined) return { labelId: "", seed: workflow.initial };

  const entry = byModuleId.get(node.moduleId);

  return {
    ...(entry === undefined ? {} : { entry }),
    labelId: node.id,
    nodeId: node.id,
    seed: workflow.initial,
  };
}
