/**
 * Editing a workflow's `recommended` list — the pure half of the editor's suggestion authoring. Every
 * function returns a new list and accepts `undefined` wherever a list is read.
 */

import { nodeIdFor } from "./chain";
import { slugify } from "./document";
import type { BuilderModule } from "../shell/contract";
import type { RecommendedSection, WorkflowNodeDocument } from "./types";

/** The section fields a person edits in place — everything but the node list, which is grown per node. */
export type SectionFields = Partial<Pick<RecommendedSection, "key" | "label" | "description">>;

/** A section's key derived from its title, unique among `taken` (every key already in the document). */
export function sectionKey(title: string, taken: readonly string[]): string {
  const base = slugify(title) || "suggestion";
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** The list with `section` appended; a list that is absent reads as empty. */
export function withSection(
  list: readonly RecommendedSection[] | undefined,
  section: RecommendedSection,
): RecommendedSection[] {
  return [...(list ?? []), section];
}

/** The list without the section whose `key` matches; a key the list does not carry returns it unchanged. */
export function withoutSection(
  list: readonly RecommendedSection[] | undefined,
  key: string,
): RecommendedSection[] {
  const base = list ?? [];
  const remaining = base.filter((section) => section.key !== key);
  return remaining.length === base.length ? [...base] : remaining;
}

/**
 * The list with the section whose `key` matches patched with `fields`; whether the new key stays unique is
 * `documentProblem`'s call, not this helper's.
 */
export function updatedSection(
  list: readonly RecommendedSection[] | undefined,
  key: string,
  fields: SectionFields,
): RecommendedSection[] {
  const base = list ?? [];
  let changed = false;
  const next = base.map((section) => {
    if (section.key !== key) return section;
    changed = true;
    return { ...section, ...fields };
  });
  return changed ? next : [...base];
}

/** The list with `node` appended to the section whose `key` matches — the nodes appended as one unit when taken. */
export function withSectionNode(
  list: readonly RecommendedSection[] | undefined,
  key: string,
  node: WorkflowNodeDocument,
): RecommendedSection[] {
  const base = list ?? [];
  return base.map((section) =>
    section.key === key ? { ...section, nodes: [...section.nodes, node] } : section,
  );
}

/** The list with the node at `index` removed from the section whose `key` matches. */
export function withoutSectionNode(
  list: readonly RecommendedSection[] | undefined,
  key: string,
  index: number,
): RecommendedSection[] {
  const base = list ?? [];
  return base.map((section) =>
    section.key === key
      ? { ...section, nodes: section.nodes.filter((_node, at) => at !== index) }
      : section,
  );
}

/** A module node for a section: the id is the module's own, made unique against the section's nodes (`nodeIdFor`), with the module's name as the label. */
export function recommendedNode(
  module: BuilderModule,
  existing: readonly WorkflowNodeDocument[],
): WorkflowNodeDocument {
  const id = module.module.id;
  return { id: nodeIdFor(id, existing), moduleId: id, label: module.module.name ?? id };
}

/** A subflow node for a section: the id is the workflow's own, made unique against the section's nodes (`nodeIdFor`). */
export function recommendedSubflow(
  workflowId: string,
  existing: readonly WorkflowNodeDocument[],
): WorkflowNodeDocument {
  return { id: nodeIdFor(workflowId, existing), workflows: [workflowId] };
}
