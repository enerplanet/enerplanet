/**
 * Recommended sections: the follow-up node groups a workflow offers once a run finishes, and how taking
 * one grows the placed flow. Pure — no commit, no run.
 */

import { nodeName, placementId, type Flow, type FlowNode, type ModuleRegistry } from "../core/flow";
import type { PortKey } from "../core/ports";
import { lastActionOf, writtenPortsOf } from "../core/replay";
import type { Store } from "../core/store";
import { expand, type WorkflowLookup } from "./expand";
import { isSubflowNode, type RecommendedSection, type WorkflowDocument, type WorkflowNodeDocument } from "./types";

/** The synthetic container id a suggested subflow expands under. */
const SUGGESTION_ID = "__recommended";

/** A node's name for a placement id: its own `id`, or its `moduleId` when it has none. */
function nameOf(node: WorkflowNodeDocument): string {
  if (node.id.length > 0) return node.id;
  return isSubflowNode(node) ? "" : node.moduleId;
}

/** The module placements a section node flattens to: a module node this build declares, or a subflow spliced through `expand`. */
function flattenNode(
  node: WorkflowNodeDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): FlowNode[] {
  if (!isSubflowNode(node)) {
    if (registry[node.moduleId] === undefined) return [];
    return [
      {
        id: nameOf(node),
        moduleId: node.moduleId,
        ...(node.label === undefined ? {} : { label: node.label }),
      },
    ];
  }
  try {
    return expand({ id: SUGGESTION_ID, version: 1, label: SUGGESTION_ID, nodes: [node] }, lookup, registry);
  } catch {
    return [];
  }
}

/** The placements a section contributes — empty when this build can run none of its steps. */
function flattenSection(
  section: RecommendedSection,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): FlowNode[] {
  return section.nodes.flatMap((node) => flattenNode(node, lookup, registry));
}

/** The suggestions that can still be taken: the ones whose steps this build can actually run. */
export function takeableSections(
  sections: readonly RecommendedSection[],
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): RecommendedSection[] {
  return sections.filter((section) => flattenSection(section, lookup, registry).length > 0);
}

/** The flow with `section`'s nodes appended as fresh placements, in order — a new list; the input is untouched. */
export function appendRecommended(
  flow: Flow,
  section: RecommendedSection,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): Flow {
  const flattened = flattenSection(section, lookup, registry);
  const appended: FlowNode[] = flattened.map((node, offset) => ({
    id: placementId(flow.length + offset, nodeName(node)),
    moduleId: node.moduleId,
    ...(node.label === undefined ? {} : { label: node.label }),
  }));
  return [...flow, ...appended];
}

/**
 * Whether a placement has finished: it has its own commit and the work that commit wrote still stands in the
 * store.
 */
function isDone(node: FlowNode, store: Store): boolean {
  if (lastActionOf(store.log, node.id) === undefined) return false;
  return (writtenPortsOf(store.log, node.id) as PortKey[]).every((port) => store.data[port] !== undefined);
}

/** The suggestions on offer right now — the workflow's follow-ups once its last node has finished, or `[]`. */
export function recommendedFor(flow: Flow, store: Store, document: WorkflowDocument): RecommendedSection[] {
  if (flow.length === 0) return [];
  if (!isDone(flow[flow.length - 1], store)) return [];
  return document.recommended ?? [];
}
