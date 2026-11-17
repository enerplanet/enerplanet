/**
 * The workflow document, and the shape the API hands back (plan §4).
 *
 * The document is exactly the one `shell/workflow.ts`'s `toWorkflow` consumes — `{id, version, label,
 * seed, nodes}` — and the editor edits this and nothing else. Nothing here reshapes it: the stored
 * document travels as the document's own bytes, so the two sides of the clipboard pair (`document.ts`)
 * stay equal by construction rather than by a rule someone has to remember.
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
 * Not a module — it declares no ports and no `run()` — so the runtime never sees it. `expand` replaces it
 * with the chosen workflow's nodes at that position, which is why a node of this kind has no `moduleId`.
 * The value is a list even when it holds one entry, because a position may offer several candidates.
 */
export interface SubflowNodeDocument {
  id: string;
  workflows: readonly string[];
  label?: string;
}

/**
 * A node is a module **xor** a subflow. `moduleId` xor `workflows` is the discriminant, and it is
 * structural, so every document stored before subflows existed is a module node untouched.
 */
export type WorkflowNodeDocument = ModuleNodeDocument | SubflowNodeDocument;

/** Whether a node places a subflow rather than a module. */
export function isSubflowNode(node: WorkflowNodeDocument): node is SubflowNodeDocument {
  return "workflows" in node;
}

/**
 * Why a node is neither a module nor a subflow, or `undefined` when it is exactly one of them.
 *
 * The editor reports the answer, and the loader refuses on it, because a node is untrusted input the moment
 * it stops being a local literal. The two conditions are the two ways the discriminant fails: a node with
 * neither field names nothing to place, and one with both does not say which kind it is.
 */
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

export interface WorkflowDocument {
  id: string;
  version: number;
  label: string;
  /**
   * A human line for wherever a user has to choose a workflow. Optional: a document may carry one or
   * leave it out, and the column is derived from it the way `label` is.
   */
  description?: string;
  /**
   * Marks the document as a fragment inserted into another flow — authored without standalone
   * validation and never offered as a flow of its own. Optional; absent means a normal flow, and the
   * column is derived from it the way `label` is.
   */
  isSubflow?: boolean;
  /**
   * The seed file the definition names. Part of the stored shape, and preserved across an edit, but absent
   * for a workflow authored here — there is no seed file for one yet, and inventing a path would be a lie.
   */
  seed?: string;
  nodes: WorkflowNodeDocument[];
}

/**
 * One row of `GET /workflows`: the thin scalar surface the table queries on, plus the whole document.
 *
 * The scalar fields mirror the definition's own — `workflow_id` is the definition's `id` — because a
 * session references a workflow by that id, not by the row's serial (plan §4). `description` and
 * `is_subflow` mirror the document's optional `description`/`isSubflow` for the same reason.
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
