/**
 * The workflow document: its slug, how one is built from a chain, and how it is copied out.
 *
 * The copy button is one side of a pair whose other side is the backend's `default_workflow.json`: a
 * developer pastes a copied workflow into that file, which the seed inserts verbatim.
 */

import { isSubflowNode, type WorkflowDocument, type WorkflowNodeDocument } from "./types";

/** A definition's id, derived from its label: lowercase, runs of non-alphanumerics to single dashes. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A new document from a label. `version` starts at 1.
 *
 * `isSubflow` authors a fragment — a document spliced into another flow and validated where it is inserted,
 * not on its own.
 */
export function newDocument(label: string, isSubflow = false): WorkflowDocument {
  return {
    id: slugify(label),
    version: 1,
    label,
    // Written where a person puts it (`DOCUMENT_KEY_ORDER`), so a created fragment diffs like any other.
    ...(isSubflow ? { isSubflow: true } : {}),
    nodes: [],
  };
}

/**
 * The document a save writes: the stored document (`base`) with the chain on screen as its `nodes`.
 *
 * Spreading `base` is deliberate — a field this editor does not author (`seed`) survives an edit, and the
 * key order of the stored document is kept.
 */
export function documentWithNodes(
  base: WorkflowDocument,
  nodes: readonly WorkflowNodeDocument[],
): WorkflowDocument {
  return { ...base, nodes: [...nodes] };
}

/**
 * The order a document is written in — for people and for diffs.
 *
 * The definition lives in a `jsonb` column, which does not preserve key order (it reorders by key length,
 * then alphabetically), so the stored order would reshuffle the paste target on every round trip.
 * Re-imposing this order makes a copy of an unchanged workflow paste back as a no-op.
 *
 * `description` and `isSubflow` sit where a person writes them — after `label`, before `seed` — because the
 * seed file places them there.
 */
const DOCUMENT_KEY_ORDER = ["id", "version", "label", "description", "isSubflow", "seed", "nodes", "recommended"] as const;

/** The same, per node, for a module node. A node carries no execution flags — `auto` is the module's (`Module.auto`). */
const NODE_KEY_ORDER = ["id", "moduleId", "label"] as const;

/** The same, per node, for a subflow node: its kind's fields, ordered as a person writes them. */
const SUBFLOW_NODE_KEY_ORDER = ["id", "workflows", "label"] as const;

/** The same, per recommended section: its fields, ordered as the workflow builder writes them. */
const SECTION_KEY_ORDER = ["key", "label", "description", "nodes"] as const;

/**
 * Keys in `order` first, then anything else in the order it arrived.
 *
 * A key this build does not know about is kept rather than dropped.
 */
function ordered(record: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of order) {
    if (key in record) result[key] = record[key];
  }
  for (const [key, value] of Object.entries(record)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
}

/**
 * The text the copy button writes: the stored document, pretty-printed, in the order a person writes it, so
 * an unchanged workflow pastes back byte-identically. The trailing newline is there because the paste target
 * is a source file.
 */
export function copyPayload(document: WorkflowDocument): string {
  // Each node is ordered by its kind: the two kinds carry different fields, so one list cannot place both.
  const orderedNode = (node: WorkflowNodeDocument): Record<string, unknown> => {
    const record = node as unknown as Record<string, unknown>;
    return ordered(record, isSubflowNode(node) ? SUBFLOW_NODE_KEY_ORDER : NODE_KEY_ORDER);
  };
  const nodes = (document.nodes ?? []).map(orderedNode);
  // A section nests nodes of its own, ordered in turn; the map's terminal-name keys are left in arrival order.
  const recommended =
    document.recommended === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(document.recommended).map(([terminalName, sections]) => [
            terminalName,
            sections.map((section) =>
              ordered(
                {
                  ...(section as unknown as Record<string, unknown>),
                  nodes: (section.nodes ?? []).map(orderedNode),
                },
                SECTION_KEY_ORDER,
              ),
            ),
          ]),
        );
  const canonical = ordered(
    {
      ...(document as unknown as Record<string, unknown>),
      nodes,
      ...(recommended === undefined ? {} : { recommended }),
    },
    DOCUMENT_KEY_ORDER,
  );
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
