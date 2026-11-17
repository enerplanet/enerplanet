/**
 * Chain operations — the editor's linear list, as pure functions over the document's `nodes`.
 *
 * A linear chain cannot have a hole. Removing an entry therefore drops it **and everything after it**:
 * a middle cut would either leave a gap or silently promote a module whose requirements the new tail no
 * longer satisfies, and both are worse than the honest answer that the tail is gone. The editor's confirm
 * states that consequence.
 */

import type { BuilderModule } from "../shell/contract";
import { isSubflowNode, type WorkflowNodeDocument } from "./types";

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
 * Append a subflow node referencing `workflowId`. No label is set: `expand` falls back to the referenced
 * workflow's own label (`node.label ?? child.label ?? child.id`), so the composed step reads correctly and
 * keeps reading correctly if the reference is later switched — a label copied in here would go stale the
 * moment the choice changes. The id is minted like a module's, off the workflow id, so it stays unique in
 * the document.
 */
export function appendSubflow(
  chain: readonly WorkflowNodeDocument[],
  workflowId: string,
): WorkflowNodeDocument[] {
  return [...chain, { id: nodeIdFor(workflowId, chain), workflows: [workflowId] }];
}

/**
 * Point the subflow node at `index` at `workflowId` — the choice changed, so nothing is appended and the
 * chain's length and the node's position are untouched. A non-subflow node at `index` is left as it is.
 */
export function chooseSubflowWorkflow(
  chain: readonly WorkflowNodeDocument[],
  index: number,
  workflowId: string,
): WorkflowNodeDocument[] {
  return chain.map((node, at) =>
    at === index && isSubflowNode(node) ? { ...node, workflows: [workflowId] } : node,
  );
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
