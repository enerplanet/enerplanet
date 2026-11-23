/**
 * The workflow document, and the shape the API hands back.
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

/**
 * A follow-up node group a workflow offers **after a run finishes** — the malleable-flow side of "we start
 * with a predefined workflow and add to it". Appending one is a **plan addition** (§6): it grows the placed
 * flow by these nodes as fresh placements, and nothing runs until a module does.
 *
 * A section's `key` is unique **within its own workflow only** — not globally — because it is a local handle
 * the workflow builder assigns and the user picks one of. Its `description` states the goal, so the user knows
 * *why* to append it rather than only *what* it is.
 */
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
 * The map is **untrusted input** the moment the document stops being a local literal — it arrives over the
 * wire with everything else — so it is checked the way a node is (`nodeProblem`), not trusted because the
 * editor happened to author it. Four ways it fails, each named:
 *
 * - a **blank terminal name**: the map is keyed by a node's stable name, and an empty key names nothing;
 * - a value that is **not a list of sections**: the shape is a list per terminal, by construction;
 * - a section whose own **`key` is blank or repeats another's** in the same workflow — the key is a
 *   workflow-local handle the user picks one of, so a blank one names nothing and a duplicate is ambiguous;
 * - a section naming a **node the discriminant refuses** (`nodeProblem`).
 *
 * Every section's key is compared against every other's, across the whole map, because the rule is
 * "unique within its workflow" and a workflow is the whole document.
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
  /**
   * The follow-up node groups a run of this workflow may offer, keyed by the terminal node's **stable name**
   * (§6). Each value is the list of sections offered for that terminal.
   *
   * The key is the terminal node's **stable name** — a module's `moduleId`, or a seed node's own `id` — the
   * same name `nodeName` recovers from a placement (`core/flow.ts`). It is deliberately **not** the placement
   * id (`"<n>-<name>"`), which changes on every re-run: a recommendation must survive the flow growing.
   * Optional; absent means the workflow offers no follow-ups.
   */
  recommended?: Record<string, RecommendedSection[]>;
}

/**
 * One row of `GET /workflows`: the thin scalar surface the table queries on, plus the whole document.
 *
 * The scalar fields mirror the definition's own — `workflow_id` is the definition's `id` — because a
 * session references a workflow by that id, not by the row's serial. `description` and
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
