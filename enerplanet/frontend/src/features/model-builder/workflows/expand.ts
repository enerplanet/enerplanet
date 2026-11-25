/**
 * The expansion: a workflow document, flattened into the node list the runtime walks.
 *
 * A subflow node references another stored workflow. It is not a module, so the runtime must never see it:
 * `expand` replaces it, at its position and recursively, with the referenced workflow's nodes. This is the
 * one flattening the loader and the editor's gate share.
 */

import type { FlowNode, ModuleRegistry } from "../core/flow";
import {
  isSubflowNode,
  nodeProblem,
  type SubflowNodeDocument,
  type WorkflowDocument,
  type WorkflowNodeDocument,
} from "./types";

/** Resolves a workflow id to its document; the caller owns which documents exist. */
export type WorkflowLookup = (workflowId: string) => WorkflowDocument | undefined;

/** Which workflow a subflow node expands to, when a position offers several. Must be pure (a cycle is checked then walked). */
export type SubflowChoice = (node: SubflowNodeDocument) => string;

/** How a composed node's id and label read: the container's, then the child's. */
const ID_SEPARATOR = "/";
const LABEL_SEPARATOR = " / ";

/** The default choice: a node's first candidate, which is the whole of the single-candidate case. */
const firstCandidate: SubflowChoice = (node) => node.workflows[0] ?? "";

/**
 * Flatten a document into the node list the runtime walks, subflows included. Synchronous and pure.
 * Throws on a cycle, an unresolved subflow, or a node naming a module the registry does not declare.
 */
export function expand(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
  choose: SubflowChoice = firstCandidate,
): FlowNode[] {
  const cycle = expansionCycle(document, lookup, choose);
  if (cycle !== undefined) {
    throw new Error(cycleMessage(cycle));
  }

  const flow: FlowNode[] = [];
  splice(document.id, document.nodes, "", "", lookup, registry, choose, flow);
  return flow;
}

/** The workflow ids a cyclic expansion would revisit, or `undefined` when the expansion is acyclic. */
export function expansionCycle(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  choose: SubflowChoice = firstCandidate,
): readonly string[] | undefined {
  return revisit(document.nodes, [document.id], lookup, choose);
}

function revisit(
  nodes: readonly WorkflowNodeDocument[],
  ancestry: readonly string[],
  lookup: WorkflowLookup,
  choose: SubflowChoice,
): readonly string[] | undefined {
  for (const node of nodes) {
    if (!isSubflowNode(node)) continue;
    const next = choose(node);
    if (next.length === 0) continue;
    if (ancestry.includes(next)) return [...ancestry, next];
    const child = lookup(next);
    if (child === undefined) continue;
    const found = revisit(child.nodes, [...ancestry, next], lookup, choose);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Walk the nodes in order, emitting each module node and splicing each subflow's expansion in its place,
 * checking each module against `registry` first.
 */
function splice(
  workflowId: string,
  nodes: readonly WorkflowNodeDocument[],
  idPrefix: string,
  labelPrefix: string,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
  choose: SubflowChoice,
  flow: FlowNode[],
): void {
  for (const node of nodes) {
    const problem = nodeProblem(node);
    if (problem !== undefined) {
      throw new Error(`[model-builder] workflow "${workflowId}" node "${node.id}": ${problem}`);
    }

    if (isSubflowNode(node)) {
      const next = choose(node);
      const child = lookup(next);
      if (child === undefined) {
        throw new Error(
          `[model-builder] workflow "${workflowId}" node "${node.id}": subflow workflow "${next}" is not a stored workflow`,
        );
      }
      const container = node.label ?? child.label ?? child.id;
      splice(
        child.id,
        child.nodes,
        `${idPrefix}${node.id}${ID_SEPARATOR}`,
        `${labelPrefix}${container}${LABEL_SEPARATOR}`,
        lookup,
        registry,
        choose,
        flow,
      );
      continue;
    }

    const moduleId = node.moduleId;
    if (registry[moduleId] === undefined) {
      throw new Error(
        `[model-builder] workflow "${workflowId}" node "${node.id}": moduleId "${moduleId}" is not declared`,
      );
    }

    const label = node.label === undefined ? undefined : `${labelPrefix}${node.label}`;
    flow.push({
      id: `${idPrefix}${node.id}`,
      moduleId,
      ...(label === undefined ? {} : { label }),
    });
  }
}

/** The cycle refusal, naming the workflow the expansion re-enters and the path it took to get there. */
function cycleMessage(cycle: readonly string[]): string {
  return `[model-builder] subflow expansion revisits workflow "${cycle[cycle.length - 1]}" (${cycle.join(" -> ")}) — a subflow cannot contain itself, directly or transitively`;
}
