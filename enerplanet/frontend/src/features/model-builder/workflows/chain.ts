/**
 * Chain operations — the editor's linear list, as pure functions over the document's `nodes`.
 *
 * A linear chain cannot have a hole. Removing an entry therefore drops it **and everything after it**:
 * a middle cut would either leave a gap or silently promote a module whose requirements the new tail no
 * longer satisfies, and both are worse than the honest answer that the tail is gone. The editor's confirm
 * states that consequence.
 */

import type { BuilderModule } from "../shell/contract";
import type { WorkflowNodeDocument } from "./types";

/** A node id not already taken, so `toWorkflow`'s uniqueness rule always holds for what we author. */
export function nodeIdFor(moduleId: string, chain: readonly WorkflowNodeDocument[]): string {
  const taken = new Set(chain.map((node) => node.id));
  if (!taken.has(moduleId)) return moduleId;
  let n = 2;
  while (taken.has(`${moduleId}-${n}`)) n += 1;
  return `${moduleId}-${n}`;
}

/** Append a module. The node's label is the module's own name, so a step reads as what it is. */
export function appendModule(
  chain: readonly WorkflowNodeDocument[],
  module: BuilderModule,
): WorkflowNodeDocument[] {
  const id = module.module.id;
  return [
    ...chain,
    { id: nodeIdFor(id, chain), moduleId: id, label: module.module.name ?? id },
  ];
}

/**
 * Remove the entry at `index`, and everything after it.
 *
 * The count the confirm reports is what this drops: `chain.length - index`.
 */
export function removeFrom(
  chain: readonly WorkflowNodeDocument[],
  index: number,
): WorkflowNodeDocument[] {
  return chain.slice(0, index);
}

/** How many entries removing `index` would drop — the number the confirm states. */
export function removedCount(chain: readonly WorkflowNodeDocument[], index: number): number {
  return Math.max(0, chain.length - index);
}
