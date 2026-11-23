/**
 * Recommended sections (§6): the follow-up node groups a workflow offers once a run finishes, and how taking
 * one grows the placed flow.
 *
 * Pure — no store, no commit, no run. `sectionsFor` answers what a terminal node offers; `appendRecommended`
 * returns a new `Flow` with a section's nodes appended as **fresh placements**. Appending is a **plan
 * addition**: it grows the transcript of what will be enacted, so the appended nodes are `pending` until a
 * module runs them. The flow is immutable (`core/flow.ts`), so this returns a new list rather than editing the
 * one it is given.
 *
 * The lookup key is the terminal node's **stable name** — a module's `moduleId`, or a seed node's own `id` —
 * never the placement id (`"<n>-<name>"`), which changes on every re-run (`nodeName`, `core/flow.ts`).
 */

import { placementId, type Flow, type FlowNode } from "../core/flow";
import { isSubflowNode, type RecommendedSection, type WorkflowDocument, type WorkflowNodeDocument } from "./types";

/**
 * The sections offered for a terminal node, by its stable name — `[]` when the name matches nothing (an
 * unknown terminal, or a document that declares no `recommended` map at all).
 *
 * A terminal the document does not name offers nothing rather than throwing: a workflow without follow-ups is
 * a normal workflow, and a caller asking about a name it read off a placement should get "nothing here", not
 * a failure.
 */
export function sectionsFor(document: WorkflowDocument, terminalName: string): RecommendedSection[] {
  return document.recommended?.[terminalName] ?? [];
}

/**
 * A node's name for a placement id: its own `id`, or its `moduleId` when it has none (§2).
 *
 * A well-formed module node has an `id`, so the fallback is the exceptional case the core's `nodeName`
 * documents as well. A subflow node names no module and is out of scope for a recommended section today, so it
 * falls back to the empty name rather than inventing one.
 */
function nameOf(node: WorkflowNodeDocument): string {
  if (node.id.length > 0) return node.id;
  return isSubflowNode(node) ? "" : node.moduleId;
}

/**
 * The flow with `section`'s nodes appended as fresh placements, in order — a new list; the input is untouched.
 *
 * Each appended node is a placement at the next position: its id is minted with the core's
 * `placementId(index, name)`, `index` counting up from **the number of placements already present**, so ids
 * stay monotonic and are never reused (the flow never shrinks). The name is the node's own `id` (or its
 * `moduleId` when it has none), which is what a section is keyed by and what a later re-run will re-use. The
 * node's `moduleId` is carried over as-is, so the appended placement is walkable exactly like any other.
 */
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
