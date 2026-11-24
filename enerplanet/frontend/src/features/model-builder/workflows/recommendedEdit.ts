/**
 * Editing a workflow's `recommended` map — the pure half of the editor's section authoring. Every function
 * returns a new map and accepts `undefined` wherever a map is read.
 */

import { nodeIdFor } from "./chain";
import type { BuilderModule } from "../shell/contract";
import type { RecommendedSection, WorkflowNodeDocument } from "./types";

/** The document's recommended map: a terminal node's stable name → the sections it offers. */
export type RecommendedMap = Record<string, RecommendedSection[]>;

/** The section fields a person edits in place — everything but the node list, which is grown per node. */
export type SectionFields = Partial<Pick<RecommendedSection, "key" | "label" | "description">>;

/**
 * The map with an (empty) entry for `terminal`, so a terminal can be named before a section is authored under
 * it. A blank name names nothing and an existing name is left as it is; both return the map unchanged.
 */
export function withTerminal(map: RecommendedMap | undefined, terminal: string): RecommendedMap {
  const base = map ?? {};
  if (terminal.length === 0 || terminal in base) return base;
  return { ...base, [terminal]: [] };
}

/** The map without `terminal`. A name the map does not carry returns it unchanged. */
export function withoutTerminal(map: RecommendedMap | undefined, terminal: string): RecommendedMap {
  const base = map ?? {};
  if (!(terminal in base)) return base;
  return Object.fromEntries(Object.entries(base).filter(([name]) => name !== terminal));
}

/**
 * The map with the terminal key `from` renamed to `to`, keeping its position. A rename onto a name another
 * terminal holds merges the two section lists onto the new name (the moved terminal's after the existing).
 */
export function renamedTerminal(
  map: RecommendedMap | undefined,
  from: string,
  to: string,
): RecommendedMap {
  const base = map ?? {};
  if (from === to || from.length === 0 || to.length === 0 || !(from in base)) return base;
  const result: RecommendedMap = {};
  for (const [name, sections] of Object.entries(base)) {
    if (name === from) {
      result[to] = to in base ? [...(base[to] ?? []), ...sections] : sections;
    } else if (name === to) {
      if (!(to in result)) result[to] = sections;
    } else {
      result[name] = sections;
    }
  }
  return result;
}

/** The map with `section` appended to `terminal`'s list — naming the terminal if it is not there yet. */
export function withSection(
  map: RecommendedMap | undefined,
  terminal: string,
  section: RecommendedSection,
): RecommendedMap {
  const base = map ?? {};
  return { ...base, [terminal]: [...(base[terminal] ?? []), section] };
}

/**
 * The map with the section `key` removed from `terminal`. A terminal left with no sections is dropped
 * entirely, so removing the last section does not leave an empty-but-present key behind.
 */
export function withoutSection(
  map: RecommendedMap | undefined,
  terminal: string,
  key: string,
): RecommendedMap {
  const base = map ?? {};
  const sections = base[terminal];
  if (sections === undefined) return base;
  const remaining = sections.filter((section) => section.key !== key);
  if (remaining.length === sections.length) return base;
  if (remaining.length === 0) return withoutTerminal(base, terminal);
  return { ...base, [terminal]: remaining };
}

/**
 * The map with the section `key` under `terminal` patched with `fields`; whether the new key stays unique is
 * `documentProblem`'s call, not this helper's.
 */
export function updatedSection(
  map: RecommendedMap | undefined,
  terminal: string,
  key: string,
  fields: SectionFields,
): RecommendedMap {
  const base = map ?? {};
  const sections = base[terminal];
  if (sections === undefined) return base;
  let changed = false;
  const next = sections.map((section) => {
    if (section.key !== key) return section;
    changed = true;
    return { ...section, ...fields };
  });
  return changed ? { ...base, [terminal]: next } : base;
}

/** The map with `node` appended to the section `key`'s node list — the nodes appended as one unit when taken. */
export function withSectionNode(
  map: RecommendedMap | undefined,
  terminal: string,
  key: string,
  node: WorkflowNodeDocument,
): RecommendedMap {
  const base = map ?? {};
  const sections = base[terminal];
  if (sections === undefined) return base;
  const next = sections.map((section) =>
    section.key === key ? { ...section, nodes: [...section.nodes, node] } : section,
  );
  return { ...base, [terminal]: next };
}

/** The map with the node at `index` removed from the section `key`'s node list. */
export function withoutSectionNode(
  map: RecommendedMap | undefined,
  terminal: string,
  key: string,
  index: number,
): RecommendedMap {
  const base = map ?? {};
  const sections = base[terminal];
  if (sections === undefined) return base;
  const next = sections.map((section) =>
    section.key === key
      ? { ...section, nodes: section.nodes.filter((_node, at) => at !== index) }
      : section,
  );
  return { ...base, [terminal]: next };
}

/** A module node for a section: the id is the module's own, made unique against the section's nodes (`nodeIdFor`), with the module's name as the label. */
export function recommendedNode(
  module: BuilderModule,
  existing: readonly WorkflowNodeDocument[],
): WorkflowNodeDocument {
  const id = module.module.id;
  return { id: nodeIdFor(id, existing), moduleId: id, label: module.module.name ?? id };
}
