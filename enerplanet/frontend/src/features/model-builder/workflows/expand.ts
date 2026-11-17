/**
 * The expansion: a workflow document, flattened into the node list the runtime walks.
 *
 * A subflow node references another stored workflow. It is not a module — no ports, no `run()` — so the
 * runtime must never see it: here it is **replaced** by the expansion of the workflow it stands for,
 * spliced in at its position, recursively, because a subflow may itself contain a subflow. This is the one
 * place that knows how a document composes, so the loader and the editor's gate have a single flattening to
 * share rather than each deriving its own.
 *
 * Two properties are correctness, not tidiness. A node's id is namespaced by the container it sits in
 * (`<container id>/<child id>`), because the flat transaction log keys by node id — the same subflow
 * inserted twice must yield disjoint ids or the two insertions would share a slot. And a node's label is
 * prefixed with its container's, so a composed step still reads as what it is in the steps panel.
 *
 * It also holds the one check that needs the module registry: every module a node names must be declared,
 * at any depth, in the same shape the loader once used. A child workflow naming an undeclared module is the
 * same defect as the root naming one, so it is caught here rather than only where the root happens to sit.
 */

import type { FlowNode, ModuleRegistry } from "../core/flow";
import {
  isSubflowNode,
  nodeProblem,
  type SubflowNodeDocument,
  type WorkflowDocument,
  type WorkflowNodeDocument,
} from "./types";

/**
 * Resolves a workflow id to its document. The caller supplies the documents, so *which* one a subflow
 * expands to is a decision it owns — the seam a future "which pathway?" choice resolves through without the
 * walk below changing.
 */
export type WorkflowLookup = (workflowId: string) => WorkflowDocument | undefined;

/**
 * Which workflow a subflow node expands to, when a position offers several. The several-candidate choice is a
 * later step; the seam is here so it resolves through this rather than a rewrite.
 *
 * Must be **pure**: `expand` checks for a cycle once and then walks, and a choice that returned different
 * answers to the two calls could slip a cycle past the check.
 */
export type SubflowChoice = (node: SubflowNodeDocument) => string;

/** How a composed node's id and label read: the container's, then the child's. */
const ID_SEPARATOR = "/";
const LABEL_SEPARATOR = " / ";

/** The default choice: a node's first candidate, which is the whole of the single-candidate case. */
const firstCandidate: SubflowChoice = (node) => node.workflows[0] ?? "";

/**
 * Flatten a document into the node list the runtime walks, subflows included.
 *
 * Synchronous and pure. Throws on a document whose expansion revisits a workflow — a composition with a
 * cycle has no valid expansion — on a subflow naming a workflow the lookup does not resolve, and on a node
 * naming a module the registry does not declare, the last in the same shape the loader uses for the root.
 * A document that could not be walked fails here, precisely, rather than half-working later.
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

/**
 * The workflow ids a cyclic expansion would revisit — the root first, the revisited id last — or `undefined`
 * when the expansion is acyclic.
 *
 * Exported because the editor asks the same question of a candidate before offering it: a subflow whose
 * expansion would contain the workflow being edited has no valid expansion. A workflow the lookup cannot
 * resolve is skipped — a missing workflow is a different, later refusal, not a cycle.
 */
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
 * Walk the nodes in order, emitting each module node and splicing each subflow's expansion in its place.
 *
 * The cycle check above has already excluded a revisit, so the recursion terminates; `choose` being pure is
 * what keeps this walk and that check agreeing on which workflow each subflow stands for.
 *
 * Each module node is checked against `registry` before it is emitted: a node naming a module nobody declared
 * cannot be walked, and the check sits here so the same refusal catches a module named inside a child
 * workflow. The message names the workflow the node is actually in — the child, for a composed node — so it
 * points at the document that is wrong.
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
    // The discriminant, asked before any kind is read off the node. `isSubflowNode` answers from the mere
    // presence of `workflows`, so a node carrying both fields would be walked as a subflow and its
    // `moduleId` silently ignored; `nodeProblem` is the authority the two kinds are defined by, so the walk
    // refuses on it rather than letting whichever check happens to run first decide.
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
      // The children sit under this node: its id namespaces them, its label names their group. The
      // container's own name falls back to the referenced workflow's label, so a node with no label of its
      // own still composes readably.
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
