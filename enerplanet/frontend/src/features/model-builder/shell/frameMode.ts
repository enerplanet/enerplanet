/**
 * Which module the frame shows, and what its session starts from.
 *
 * Two modes — `workflow` (the node the session sits on, seeded from the workflow) and `test` (one module on
 * its own test data, no workflow and no position).
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
  /** The id a module's UI is handed: the node id in a workflow, the module id in test mode. */
  labelId: string;
  /** The node a run is stamped with. Absent in test mode: there is no position to stamp. */
  nodeId?: string;
  /** The module of the node on screen — what a run stamps alongside the placement id. */
  moduleId?: string;
  /** Whether the module on screen is an automatic step (`autoRun.ts`). */
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
  /** A node to show instead of the derived one, while its run is in flight and until its effects have landed. */
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

  // The session's frontier: the first node that is not done, or the last node when complete.
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
