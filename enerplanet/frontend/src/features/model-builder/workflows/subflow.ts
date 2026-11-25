/**
 * The subflow picker's data: every stored workflow, judged, and ordered for the list. Pure and separate
 * from the component so it is tested without a DOM.
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

/** Judge every stored workflow against the chain prefix, fragments first. */
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
