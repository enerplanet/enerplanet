/**
 * Recommended sections: the follow-up node groups a workflow offers once a run finishes, and how taking
 * one grows the placed flow. Pure — no commit, no run.
 */

import { nodeName, placementId, type Flow, type FlowNode } from "../core/flow";
import type { PortKey } from "../core/ports";
import { lastActionOf, writtenPortsOf } from "../core/replay";
import type { Store } from "../core/store";
import { isSubflowNode, type RecommendedSection, type WorkflowDocument, type WorkflowNodeDocument } from "./types";

/** The sections offered for a terminal node, by its stable name — `[]` when the name matches nothing. */
export function sectionsFor(document: WorkflowDocument, terminalName: string): RecommendedSection[] {
  return document.recommended?.[terminalName] ?? [];
}

/** A node's name for a placement id: its own `id`, or its `moduleId` when it has none. */
function nameOf(node: WorkflowNodeDocument): string {
  if (node.id.length > 0) return node.id;
  return isSubflowNode(node) ? "" : node.moduleId;
}

/** The flow with `section`'s nodes appended as fresh placements, in order — a new list; the input is untouched. */
export function appendRecommended(flow: Flow, section: RecommendedSection): Flow {
  const appended: FlowNode[] = section.nodes.map((node, offset) => {
    const name = nameOf(node);
    const flowNode: FlowNode = {
      id: placementId(flow.length + offset, name),
      moduleId: isSubflowNode(node) ? "" : node.moduleId,
      ...(node.label === undefined ? {} : { label: node.label }),
    };
    return flowNode;
  });
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

/** The sections on offer right now — the workflow's follow-ups for the terminal that has finished running, or `[]` when there is none. */
export function recommendedFor(flow: Flow, store: Store, document: WorkflowDocument): RecommendedSection[] {
  if (flow.length === 0) return [];

  let terminal: FlowNode | undefined;
  for (let index = flow.length - 1; index >= 0; index -= 1) {
    if (isDone(flow[index], store)) {
      terminal = flow[index];
      break;
    }
  }
  if (terminal === undefined) return [];

  if (terminal !== flow[flow.length - 1]) return [];

  return sectionsFor(document, nodeName(terminal));
}
