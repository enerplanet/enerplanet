/**
 * Chain operations — the editor's linear list, as pure functions over the document's `nodes`.
 */

import type { BuilderModule } from "../shell/contract";
import { isSubflowNode, type WorkflowNodeDocument } from "./types";

/** Which way a node moves within the chain: toward the start, or toward the end. */
export type MoveDirection = "up" | "down";

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

/** Append a subflow node referencing `workflowId`; no label is set, so `expand` reads the referenced workflow's own. */
export function appendSubflow(
  chain: readonly WorkflowNodeDocument[],
  workflowId: string,
): WorkflowNodeDocument[] {
  return [...chain, { id: nodeIdFor(workflowId, chain), workflows: [workflowId] }];
}

/** Point the subflow node at `index` at `workflowId`; a non-subflow node at `index` is left as it is. */
export function chooseSubflowWorkflow(
  chain: readonly WorkflowNodeDocument[],
  index: number,
  workflowId: string,
): WorkflowNodeDocument[] {
  return chain.map((node, at) =>
    at === index && isSubflowNode(node) ? { ...node, workflows: [workflowId] } : node,
  );
}

/** Move the entry at `index` one position, swapping with its neighbour; a boundary or out-of-range index is returned unchanged. */
export function moveNode(
  chain: readonly WorkflowNodeDocument[],
  index: number,
  direction: MoveDirection,
): WorkflowNodeDocument[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= chain.length || target < 0 || target >= chain.length) return [...chain];
  const next = [...chain];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Remove the entry at `index` and everything after it. */
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
