/**
 * Which module the frame shows, and what its session starts from.
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

import { isAutoModule, type ModelData } from "@model-builder/core";
import { position } from "../core/position";
import type { Flow } from "../core/flow";
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
  /** The module of the node on screen — what a run stamps alongside the placement id. */
  moduleId?: string;
  /**
   * Whether the module on screen is an **automatic** step (`autoRun.ts`). The module declares it
   * (`Module.auto`), so this is read from `entry.module` — the frame forces the full-screen slot open for one,
   * because that is where an automatic step shows its own run state and there is no forward action to press.
   */
  auto?: boolean;
  /** What the session's store starts from. */
  seed: Readonly<ModelData>;
}

export function frameView(
  mode: FrameMode,
  workflow: Workflow,
  entries: readonly BuilderModule[],
  store: Store,
  /** The effective flow the frame walks — the session's placed flow over its log, not the seed. */
  flow: Flow,
  /**
   * A node to show instead of the derived one, while its run is in flight and until its effects have landed.
   *
   * The position is *derived* — the first node that is not done — so a run would move the frame off the node that
   * just ran in the same React commit that delivers its outputs. A module's effects run with that commit, so one
   * that draws from the new data never drew at all. **The module's run is what moves the session on**, not the
   * store write, and this is where that is honoured.
   */
  hold?: string,
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

  // The session's frontier: the first node that is not done, or the last node when complete, so the frame
  // stays on the module that finished rather than emptying out.
  const at = position(flow, workflow.registry, store);
  const derivedId = at.complete ? flow[flow.length - 1]?.id : flow[at.index]?.id;
  const nodeId = hold ?? derivedId;
  const node = flow.find((candidate) => candidate.id === nodeId);
  if (node === undefined) return { labelId: "", seed: workflow.initial };

  const entry = byModuleId.get(node.moduleId);

  return {
    ...(entry === undefined ? {} : { entry }),
    labelId: node.id,
    nodeId: node.id,
    moduleId: node.moduleId,
    ...(entry !== undefined && isAutoModule(entry.module) ? { auto: true } : {}),
    seed: workflow.initial,
  };
}
