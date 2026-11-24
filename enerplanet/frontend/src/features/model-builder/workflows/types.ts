/**
 * The workflow document, and the shape the API hands back.
 *
 * The document is exactly the one `shell/workflow.ts`'s `toWorkflow` consumes — `{id, version, label,
 * seed, nodes}` — and the editor edits this and nothing else.
 */

/** One node of the chain that places a module: a module at a position, named the way history names a position. */
export interface ModuleNodeDocument {
  id: string;
  moduleId: string;
  label?: string;
}

/**
 * One node of the chain that places a subflow: one or more workflows, any of which may be inserted here.
 *
 * Not a module — it declares no ports and no `run()` — so the runtime never sees it: `expand` replaces it
 * with the chosen workflow's nodes at that position. The value is a list even when it holds one entry.
 */
export interface SubflowNodeDocument {
  id: string;
  workflows: readonly string[];
  label?: string;
}

/** A node is a module xor a subflow: `moduleId` xor `workflows` is the discriminant, and it is structural. */
export type WorkflowNodeDocument = ModuleNodeDocument | SubflowNodeDocument;

/** Whether a node places a subflow rather than a module. */
export function isSubflowNode(node: WorkflowNodeDocument): node is SubflowNodeDocument {
  return "workflows" in node;
}

/** Why a node is neither a module nor a subflow, or `undefined` when it is exactly one of them. */
export function nodeProblem(node: WorkflowNodeDocument): string | undefined {
  const record = node as unknown as Record<string, unknown>;
  const hasModule = record.moduleId !== undefined;
  const hasWorkflows = record.workflows !== undefined;
  if (hasModule && hasWorkflows) {
    return "a node carries both moduleId and workflows; a step is a module or a subflow, never both";
  }
  if (!hasModule && !hasWorkflows) {
    return "a node carries neither moduleId nor workflows; every step is a module or a subflow";
  }
  return undefined;
}

/** A follow-up node group a workflow offers after a run finishes, appended to the placed flow as fresh placements. */
export interface RecommendedSection {
  /** A workflow-local handle for this section; unique within the document, not across documents. */
  key: string;
  /** A short title, e.g. for the button that offers it. */
  label: string;
  /** The goal, so the user knows why to append it. */
  description: string;
  /** The nodes appended as one unit when the section is taken. */
  nodes: WorkflowNodeDocument[];
}

/**
 * Why a document's `recommended` map is malformed, or `undefined` when it is well-formed.
 *
 * Four failures, each named: a blank terminal name, a value that is not a list of sections, a section `key`
 * that is blank or repeats another's, and a node the discriminant refuses (`nodeProblem`).
 */
export function documentProblem(document: WorkflowDocument): string | undefined {
  const recommended = document.recommended;
  if (recommended === undefined) return undefined;

  const seenKeys = new Set<string>();
  for (const [terminalName, sections] of Object.entries(recommended)) {
    if (terminalName.trim().length === 0) {
      return "a recommended map has a blank terminal name; sections are keyed by a node's stable name";
    }
    if (!Array.isArray(sections)) {
      return `recommended["${terminalName}"] is not a list of sections`;
    }
    for (const section of sections) {
      const key = typeof section?.key === "string" ? section.key : "";
      if (key.trim().length === 0) {
        return `a recommended section for "${terminalName}" has a blank key; a section's key is how a user picks it`;
      }
      if (seenKeys.has(key)) {
        return `two recommended sections share the key "${key}"; a section key is unique within its workflow`;
      }
      seenKeys.add(key);

      const nodes = section.nodes;
      if (!Array.isArray(nodes)) {
        return `recommended section "${key}" has no nodes`;
      }
      for (const node of nodes) {
        const problem = nodeProblem(node);
        if (problem !== undefined) {
          return `recommended section "${key}" has a malformed node: ${problem}`;
        }
      }
    }
  }
  return undefined;
}

export interface WorkflowDocument {
  id: string;
  version: number;
  label: string;
  /** A human line for wherever a user has to choose a workflow. Optional. */
  description?: string;
  /**
   * Marks the document as a fragment inserted into another flow — authored without standalone
   * validation and never offered as a flow of its own. Optional; absent means a normal flow.
   */
  isSubflow?: boolean;
  /** The seed file the definition names. Part of the stored shape, preserved across an edit; absent for a workflow authored here. */
  seed?: string;
  nodes: WorkflowNodeDocument[];
  /**
   * The follow-up node groups a run of this workflow may offer, keyed by the terminal node's stable name
   * (a module's `moduleId`, or a seed node's own `id`) — never the placement id, which changes on every
   * re-run. Each value is the list of sections offered for that terminal. Optional.
   */
  recommended?: Record<string, RecommendedSection[]>;
}

/**
 * One row of `GET /workflows`: the thin scalar surface the table queries on, plus the whole document.
 *
 * The scalar fields mirror the definition's own — `workflow_id` is the definition's `id`.
 */
export interface WorkflowSummary {
  workflow_id: string;
  version: number;
  label: string;
  description?: string;
  definition: WorkflowDocument;
  is_default: boolean;
  is_subflow?: boolean;
}
