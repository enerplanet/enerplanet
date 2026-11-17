/**
 * The gate rule (plan §3): a module may be appended to the chain **iff every `required` port it declares
 * is produced by a module already in the chain.** "Produced" is read off the declared surface —
 * `module.params` — the ports a module says it may write, and a **subflow node contributes the ports its
 * expansion produces**, read by descending into the workflow it references.
 *
 * ── CAVEAT, recorded rather than hidden: this is editor-level guidance, NOT a core invariant. ──
 * A module may *declare* a port it never writes. `model-start` is the standing example: it declares
 * `workspaceId`/`userId` and deliberately never writes them, so a downstream module that reads those
 * ports is offered before anything has produced them. "Requirements fulfilled" read off declared params
 * is therefore not a guarantee about what a module produces. The engine — not this palette — is what
 * decides whether a node can actually run. Do not mistake the palette for a guarantee.
 */

import { declaredPorts, isHostModule, requiredPorts, type Module } from "../core/module";
import type { FlowNode, ModuleRegistry } from "../core/flow";
import type { PortKey } from "../core/ports";
import type { BuilderModule } from "../shell/contract";
import { expand, expansionCycle, type WorkflowLookup } from "./expand";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";
import { isSubflowNode } from "./types";

/** One catalogue module on offer, with what it waits for and what is still missing. */
export interface PaletteEntry {
  readonly module: BuilderModule;
  /** Every `required` port the module declares — what it waits for. */
  readonly requires: readonly PortKey[];
  /** The subset of `requires` the chain has not produced. Non-empty means it cannot be added yet. */
  readonly missing: readonly PortKey[];
  readonly available: boolean;
}

/**
 * The ports the chain has produced so far: the union of the declared surface of its modules, a subflow's
 * ports read from its expansion.
 */
export function producedPorts(
  chain: readonly WorkflowNodeDocument[],
  catalogue: readonly BuilderModule[],
  lookup: WorkflowLookup,
): Set<PortKey> {
  const byId = new Map(catalogue.map((entry) => [entry.module.id, entry.module]));
  const produced = new Set<PortKey>();
  collectProduced(chain, byId, lookup, produced, new Set());
  return produced;
}

/**
 * Walk a node list, adding each module's declared surface and descending into each subflow.
 *
 * A subflow node is not a module and declares no ports of its own, so its ports are its expansion's: the
 * referenced workflow is resolved through `lookup` and its nodes walked in turn, recursively, because a
 * subflow may itself contain one. `visiting` holds the workflow ids on the current descent path — the gate is
 * editor guidance, not a core invariant, so a composition that would revisit a workflow contributes nothing
 * further rather than throwing (a cycle cannot be saved, `expand` refuses it, so this is a state the editor
 * tolerates while the user is mid-edit).
 *
 * A subflow of a workflow nobody stores, and a module the catalogue does not declare, both contribute
 * nothing — data conditions to report, not crashes (plan §3).
 */
function collectProduced(
  nodes: readonly WorkflowNodeDocument[],
  byId: ReadonlyMap<string, Module>,
  lookup: WorkflowLookup,
  produced: Set<PortKey>,
  visiting: ReadonlySet<string>,
): void {
  for (const node of nodes) {
    if (isSubflowNode(node)) {
      // Only the **first** candidate counts, exactly as `expand`'s default `choose` reads the node. The
      // several-candidate case is a later step: the per-candidate verdict (`subflowVerdict`) attaches where
      // each candidate is judged, not here.
      const next = node.workflows[0] ?? "";
      if (next.length === 0 || visiting.has(next)) continue;
      const child = lookup(next);
      if (child === undefined) continue;
      collectProduced(child.nodes, byId, lookup, produced, new Set([...visiting, next]));
      continue;
    }
    const module = byId.get(node.moduleId);
    if (module === undefined) continue;
    for (const port of declaredPorts(module)) produced.add(port);
  }
}

/** The `required` ports of a module the chain has not produced — empty means it is addable. */
export function missingPorts(module: Module, produced: ReadonlySet<PortKey>): PortKey[] {
  return requiredPorts(module).filter((port) => !produced.has(port));
}

/**
 * The palette: every node module in the catalogue, in catalogue order, each with what it needs and what is
 * still missing.
 *
 * Every node module is listed — never hidden — because a greyed entry that names the port it waits for is the
 * guidance the editor exists to give, and a module that vanishes reads as a bug. Showing them all is also
 * what keeps the plan's "the palette never loses a base module" rule true by construction: nothing that can
 * be a step is ever filtered out. The modules whose requirements the current chain satisfies are exactly the
 * ones an "Add" is offered for; the rest say which port they are waiting for.
 *
 * A **host module** is filtered out, and that is not an exception to the rule above: a host module is not a
 * step anyone could place. It declares no region, so a flow naming it would describe a node with nothing to
 * show — the frame mounts it once and hands its service to the modules that asked for it. The palette offers
 * what can go in a flow; the catalogue still holds every module, which is what lets the editor *report* a
 * stored flow that names one (see `WorkflowEditor`) instead of mistaking it for a module this build lacks.
 */
export function paletteFor(
  catalogue: readonly BuilderModule[],
  chain: readonly WorkflowNodeDocument[],
  lookup: WorkflowLookup,
): PaletteEntry[] {
  const produced = producedPorts(chain, catalogue, lookup);
  return catalogue
    .filter((entry) => !isHostModule(entry.module))
    .map((entry) => {
      const requires = requiredPorts(entry.module);
      const missing = missingPorts(entry.module, produced);
      return { module: entry, requires, missing, available: missing.length === 0 };
    });
}

/**
 * What a subflow picker renders for one candidate workflow: addable, or the reason it is not.
 *
 * - `missing` — the candidate's expansion needs ports the chain prefix does not produce yet.
 * - `recursive` — the candidate's expansion would contain the workflow being edited, so placing it here would
 *   make that workflow expand into itself. A cycle has no valid expansion.
 * - `unresolved` — the candidate names a subflow nobody stores, or a module the registry does not declare. It
 *   has no expansion to judge, so it is not addable. Folded into its own reason rather than `missing`, because
 *   it is a resolution failure and not a port the chain could ever produce.
 */
export type SubflowVerdict =
  | { ok: true }
  | { ok: false; reason: "missing"; missing: PortKey[] }
  | { ok: false; reason: "recursive" }
  | { ok: false; reason: "unresolved" };

/**
 * Judge one candidate subflow against the chain prefix, the registry it flattens through, the stored
 * documents its subflows resolve through, and the id of the workflow being edited.
 *
 * Recursion is checked first: a cyclic composition has no expansion, so its requirements cannot be read off
 * one. `expansionCycle` seeds its ancestry with the document's own id, so walking the candidate's nodes under
 * the **edited** workflow's id asks exactly the question — does the candidate's expansion reach the workflow
 * being edited? A candidate that *is* the workflow being edited is the same defect one step sharper: placing
 * it makes the edited workflow reference itself, so it is refused too.
 */
export function subflowVerdict(
  candidate: WorkflowDocument,
  produced: ReadonlySet<PortKey>,
  registry: ModuleRegistry,
  lookup: WorkflowLookup,
  editingId: string,
): SubflowVerdict {
  if (candidate.id === editingId || expansionCycle({ ...candidate, id: editingId }, lookup) !== undefined) {
    return { ok: false, reason: "recursive" };
  }

  // The candidate's expansion, in execution order. `expand` throws on a subflow nobody stores or a module the
  // registry does not declare; a cycle was already ruled out above, so any throw here is that resolution
  // failure — the candidate cannot be flattened, so it cannot be added.
  let flow: FlowNode[];
  try {
    flow = expand(candidate, lookup, registry);
  } catch {
    // A candidate with no expansion to judge — a resolution failure, not a crash to surface.
    return { ok: false, reason: "unresolved" };
  }

  // "Unmet" is positional: walk the expansion in order and a module's `required` port is unmet only when
  // neither the chain prefix nor a module **earlier in this same expansion** has produced it yet. A port the
  // expansion produces *later* does not count, because the flattened flow runs in this order — an earlier
  // module cannot read a port a later one has not written. So `Y(A -> B -> C)` at Y is addable exactly where
  // A's requirements are met by the chain, B's by the chain or A, and so on.
  const available = new Set<PortKey>(produced);
  const missing: PortKey[] = [];
  const seen = new Set<PortKey>();
  for (const node of flow) {
    const module = registry[node.moduleId];
    // `expand` guaranteed every module is declared, so an absent one is unreachable — skipped defensively
    // rather than asserted.
    if (module === undefined) continue;
    for (const port of requiredPorts(module)) {
      if (!available.has(port) && !seen.has(port)) {
        seen.add(port);
        missing.push(port);
      }
    }
    for (const port of declaredPorts(module)) available.add(port);
  }

  return missing.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing };
}
