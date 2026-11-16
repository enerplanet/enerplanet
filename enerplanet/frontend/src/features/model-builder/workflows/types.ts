/**
 * The workflow document, and the shape the API hands back (plan §4).
 *
 * The document is exactly the one `shell/workflow.ts`'s `toWorkflow` consumes — `{id, version, label,
 * seed, nodes}` — and the editor edits this and nothing else. Nothing here reshapes it: the stored
 * document travels as the document's own bytes, so the two sides of the clipboard pair (`document.ts`)
 * stay equal by construction rather than by a rule someone has to remember.
 */

/** One node of the chain: a module placed at a position, named the way history names a position. */
export interface WorkflowNodeDocument {
  id: string;
  moduleId: string;
  label?: string;
}

export interface WorkflowDocument {
  id: string;
  version: number;
  label: string;
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
 * session references a workflow by that id, not by the row's serial (plan §4).
 */
export interface WorkflowSummary {
  workflow_id: string;
  version: number;
  label: string;
  definition: WorkflowDocument;
  is_default: boolean;
}
