/**
 * The workflow document: its slug, how one is built from a chain, and how it is copied out (plan §6, §9).
 *
 * The copy button is one side of a pair whose other side is the backend's `default_workflow.json`: a
 * developer copies a workflow out of the app and pastes it into that file, which the seed inserts verbatim.
 * So the copied text is the stored document, pretty-printed, with **the document's own key order**.
 * `JSON.parse` keeps the order the server sent and `JSON.stringify` keeps it, so a paste into a source file
 * diffs as *your change* rather than as a reshuffle.
 */

import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

/** A definition's id, derived from its label: lowercase, runs of non-alphanumerics to single dashes. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A new document from a label. `version` starts at 1 — the only version there is until flows distribute. */
export function newDocument(label: string): WorkflowDocument {
  return { id: slugify(label), version: 1, label, nodes: [] };
}

/**
 * The document a save writes: the stored document (`base`) with the chain on screen as its `nodes`.
 *
 * Spreading `base` is deliberate — a field this editor does not author (`seed`) survives an edit, and the
 * key order of the stored document is kept, which is what makes an edited copy still diff cleanly.
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
 * The copy is **not** literal verbatim, and this is why. The definition lives in a `jsonb` column, and
 * `jsonb` does not preserve key order: it reorders by key length and then alphabetically, so what comes back
 * is `id, seed, label, nodes` rather than the `id, version, label, seed, nodes` a person writes. The paste
 * target is that person's file, so copying the stored order would reshuffle every line of it on the first
 * round trip — the diff would be the reordering, not the change. Re-imposing this order makes a copy of an
 * unchanged workflow paste back as a no-op.
 */
const DOCUMENT_KEY_ORDER = ["id", "version", "label", "seed", "nodes"] as const;

/** The same, per node. A node carries no execution flags — `auto` is the module's (`Module.auto`). */
const NODE_KEY_ORDER = ["id", "moduleId", "label"] as const;

/**
 * Keys in `order` first, then anything else in the order it arrived.
 *
 * A key this build does not know about is kept rather than dropped: the document belongs to whichever client
 * wrote it, and a copy that silently discarded a field it did not recognise would be a data loss disguised as
 * a formatting choice.
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
 * The text the copy button writes: the stored document, pretty-printed, in the order a person writes it.
 *
 * A developer pastes this over the seed file in the backend repo, so the thing that matters is that an
 * unchanged workflow pastes back byte-identically. See `DOCUMENT_KEY_ORDER` for why the stored order cannot be
 * used for that. The trailing newline is there because the paste target is a source file.
 */
export function copyPayload(document: WorkflowDocument): string {
  const nodes = (document.nodes ?? []).map((node) =>
    ordered(node as unknown as Record<string, unknown>, NODE_KEY_ORDER),
  );
  const canonical = ordered(
    { ...(document as unknown as Record<string, unknown>), nodes },
    DOCUMENT_KEY_ORDER,
  );
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
