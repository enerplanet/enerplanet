/**
 * The workflow document, and the shape the API hands back. The editor edits this and nothing else.
 */

/** One node of the chain that places a module: a module at a position, named the way history names a position. */
export interface ModuleNodeDocument {
  id: string;
  moduleId: string;
  label?: string;
}

/** One node of the chain that places a subflow: one or more workflows, any of which may be inserted here. */
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

/** Why a document's `recommended` list is malformed, or `undefined` when it is well-formed. */
export function documentProblem(document: WorkflowDocument): string | undefined {
  const recommended = document.recommended;
  if (recommended === undefined) return undefined;
  if (!Array.isArray(recommended)) {
    return "suggested next steps are not a list of suggestions";
  }

  const seenKeys = new Set<string>();
  for (const section of recommended) {
    const key = typeof section?.key === "string" ? section.key : "";
    if (key.trim().length === 0) {
      return "a suggestion has a blank key; keys are derived from a suggestion's title";
    }
    if (seenKeys.has(key)) {
      const title = typeof section?.label === "string" && section.label.trim().length > 0 ? section.label : key;
      return `two suggestions share the title "${title}"; a title must be unique within its workflow`;
    }
    seenKeys.add(key);

    const nodes = section.nodes;
    if (!Array.isArray(nodes)) {
      return `suggestion "${key}" has no nodes`;
    }
    for (const node of nodes) {
      const problem = nodeProblem(node);
      if (problem !== undefined) {
        return `suggestion "${key}" has a malformed node: ${problem}`;
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
   * Marks the document as a fragment inserted into another flow — authored without standalone validation
   * and never offered as a flow of its own. Optional; absent means a normal flow.
   */
  isSubflow?: boolean;
  /** The seed file the definition names; preserved across an edit, absent for a workflow authored here. */
  seed?: string;
  nodes: WorkflowNodeDocument[];
  /**
   * The follow-up node groups a run of this workflow may offer once its last node finishes. Optional;
   * an absent or empty list is well-formed.
   */
  recommended?: RecommendedSection[];
}

/**
 * One row of `GET /workflows`: the thin scalar surface the table queries on, plus the whole document
 * (`workflow_id` is the definition's own `id`).
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
