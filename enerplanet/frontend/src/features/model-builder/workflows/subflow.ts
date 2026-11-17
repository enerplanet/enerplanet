/**
 * The subflow picker's data (plan §9): every stored workflow, judged, and ordered for the list.
 *
 * A subflow is not a module, so it is not a row in the module palette — its own control opens this instead.
 * Each candidate is exactly a stored document plus `subflowVerdict`'s answer for it, which the UI turns into
 * a disabled row or an insertion. Pure and separate from the component so it is tested without a DOM.
 *
 * Fragments (`isSubflow`) are offered first, because those are the documents authored to be spliced into
 * another flow. The order is a stable sort, so the rest keep the list's own order and nothing is hidden: any
 * workflow whose verdict is `ok` may be inserted. The workflow being edited is left in and judged by the
 * verdict (`recursive`), so there is no second exclusion rule to drift from it.
 */

import type { ModuleRegistry } from "../core/flow";
import type { PortKey } from "../core/ports";
import type { WorkflowLookup } from "./expand";
import { subflowVerdict, type GateOptions, type SubflowVerdict } from "./gate";
import type { WorkflowDocument } from "./types";

/** One stored workflow on offer, with the verdict the picker renders and whether it is a fragment. */
export interface SubflowCandidate {
  readonly document: WorkflowDocument;
  readonly fragment: boolean;
  readonly verdict: SubflowVerdict;
}

/**
 * Judge every stored workflow against the chain prefix that ends where the subflow would sit, and offer the
 * fragments first.
 *
 * `produced` is the ports the chain prefix produces — the caller reads it from the nodes before the
 * insertion point, so a candidate whose expansion needs a port only a later node writes is refused, exactly
 * as a module would be. `options.fragment` (the document being edited is itself a fragment) turns that
 * positional refusal off: its requirements are met at the insertion site. Recursive and unresolvable
 * candidates are still refused (`GateOptions`).
 */
export function subflowCandidates(
  workflows: readonly WorkflowDocument[],
  produced: ReadonlySet<PortKey>,
  registry: ModuleRegistry,
  lookup: WorkflowLookup,
  editingId: string,
  options: GateOptions = {},
): SubflowCandidate[] {
  return workflows
    .map((document) => ({
      document,
      fragment: document.isSubflow === true,
      verdict: subflowVerdict(document, produced, registry, lookup, editingId, options),
    }))
    .sort((a, b) => Number(b.fragment) - Number(a.fragment));
}
