/**
 * The gate rule: a module may be appended to the chain **iff every `required` port it declares
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
import { moveNode, type MoveDirection } from "./chain";
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
 * The one fact that turns the **position-dependent** parts of the gate off: the document being edited is a
 * **fragment** (`isSubflow`).
 *
 * A fragment's requirements are met by whatever chain it is spliced into, so gating its modules on ports its
 * own prefix does not produce is the wrong test — the rule is that a fragment can start with any node and
 * skips validation. What survives is everything read off the composition rather than the prefix: a module's
 * `requires` is still reported, and a candidate subflow that is recursive or unresolvable is still refused.
 */
export interface GateOptions {
  /** Authoring a fragment: withhold nothing for an unmet requirement, and judge no candidate `missing`. */
  readonly fragment?: boolean;
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
 * nothing — data conditions to report, not crashes.
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
 * The union of `required` ports a flow leaves **unmet**, walked in execution order — the positional rule the
 * gate is built on, in one place.
 *
 * A module's `required` port is unmet only when neither `produced` (what sits before the flow) nor a module
 * **earlier in the same flow** has produced it: the flattened flow runs in this order, so a port a module
 * later in the flow writes cannot satisfy an earlier reader. So `Y(A -> B -> C)` at a fixed position is
 * addable exactly where A's requirements are met by `produced`, B's by `produced` or A, and so on. Ports are
 * reported once each, in first-seen order.
 *
 * Two callers read this one rule — a subflow candidate's verdict, and a fragment's own unmet inputs — so the
 * subtle ordering lives here rather than being re-derived in either.
 */
export function unmetRequiredPorts(
  flow: readonly FlowNode[],
  produced: ReadonlySet<PortKey>,
  registry: ModuleRegistry,
): PortKey[] {
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
  return missing;
}

/**
 * The ports a **fragment** needs from the flow that inserts it: its own expansion walked with an **empty
 * prefix**, because nothing before the fragment's first node exists yet.
 *
 * The same walk a candidate's verdict uses, applied to the fragment's own nodes — what the flow the fragment
 * is spliced into must already have produced. Throws as `expand` does (a subflow nobody stores, a module this
 * build lacks, a cycle): a fragment that cannot be flattened has no inputs to read, so the caller decides how
 * to report it.
 */
export function fragmentRequiredPorts(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): PortKey[] {
  return unmetRequiredPorts(expand(document, lookup, registry), new Set(), registry);
}

/**
 * The ports a document's own chain leaves unmet, read with an empty prefix — or `undefined` when the
 * document cannot be flattened at all (`expand` throwing: a cycle, a subflow nobody stores, a module the
 * registry does not declare). Absence and emptiness are different facts, and the two callers below depend on
 * the difference: empty is a flow that satisfies itself, absent is a flow whose requirements cannot be read.
 */
function ownUnmetPorts(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): Set<PortKey> | undefined {
  let flow: FlowNode[];
  try {
    flow = expand(document, lookup, registry);
  } catch {
    return undefined;
  }
  return new Set(unmetRequiredPorts(flow, new Set(), registry));
}

/** The verdict on a single order: self-satisfying, missing named ports, or not flattenable. */
export type OrderVerdict =
  | { ok: true }
  | { ok: false; reason: "unresolved" }
  | { ok: false; reason: "missing"; missing: readonly PortKey[] };

/**
 * Whether a document's chain, **in the order it stands**, satisfies itself — needs nothing from a flow around
 * it.
 *
 * For a flow — a document spliced nowhere — the prefix is empty, and its requirements can only be met by the
 * walk itself: a module's `required` port is unmet exactly when neither that (empty) prefix nor a module
 * *earlier in the same chain* has produced it. There is no other source a flow's requirements could come
 * from, so `unmetRequiredPorts(expansion, new Set(), registry)` being empty **is** the whole test — no second
 * condition is needed. (A fragment is not judged this way; its requirements are read at the insertion site —
 * `fragmentRequiredPorts`.)
 *
 * A document that cannot be flattened has no expansion, so no requirements to read off one: `expand` throwing
 * (a cycle, a subflow nobody stores, a module the registry does not declare) is refused as `unresolved`
 * rather than reported as a port problem.
 */
export function orderIsValid(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): OrderVerdict {
  const unmet = ownUnmetPorts(document, lookup, registry);
  if (unmet === undefined) return { ok: false, reason: "unresolved" };
  return unmet.size === 0 ? { ok: true } : { ok: false, reason: "missing", missing: [...unmet] };
}

/** Why a move is refused: the ports it would leave unmet that the current order did not. */
export type MoveVerdict =
  | { ok: true }
  | { ok: false; reason: "missing"; missing: readonly PortKey[] };

/**
 * Whether moving the entry at `index` one position `direction` "must not break" — the rule the editor's
 * up/down controls are offered under.
 *
 * The test is **not** "the move leaves a valid order" but "the move introduces no **new** unmet requirement":
 * compare the ports the order leaves unmet before and after, and allow unless the set grew. A stored flow can
 * already be unsatisfiable — the gate is editor guidance, not a core invariant, so a chain with an unmet port
 * can exist on disk — and refusing every move in such a flow would freeze the editor with no way to reorder
 * toward a fix. So a move that leaves the set the same, or shrinks it, is allowed even though the resulting
 * order is not itself valid; only a move that adds an unmet port is refused. "Allowed although invalid" is
 * therefore deliberate: it is the difference between a move that breaks something and a move that does not.
 *
 * Resolution is order-independent: a move reorders the same references, and whether a composition is cyclic
 * or a subflow resolves is a property of those references, not of their order. So a flow that cannot be
 * flattened before cannot be flattened after — there is no positional requirement to compare, the per-node
 * defect the chain reports is unchanged, and the move is allowed.
 */
export function moveIsAllowed(
  document: WorkflowDocument,
  index: number,
  direction: MoveDirection,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): MoveVerdict {
  const before = ownUnmetPorts(document, lookup, registry);
  // No flattening means no positional requirement to enlarge; the chain reports the defect per node, and
  // reordering neither causes nor fixes it.
  if (before === undefined) return { ok: true };

  const moved = moveNode(document.nodes, index, direction);
  // `moveNode` is pure and returns the same order for a move with nowhere to go, so a boundary move reads as
  // "nothing changed" — `after` equals `before`, nothing is introduced, and it is allowed. `?? before` covers
  // the impossible mismatch (resolution is order-independent): it would leave nothing introduced.
  const after = ownUnmetPorts({ ...document, nodes: moved }, lookup, registry) ?? before;

  const introduced = [...after].filter((port) => !before.has(port));
  return introduced.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing: introduced };
}

/**
 * The palette: every node module in the catalogue, in catalogue order, each with what it needs and what is
 * still missing.
 *
 * Every node module is listed — never hidden — because a greyed entry that names the port it waits for is the
 * guidance the editor exists to give, and a module that vanishes reads as a bug. Showing them all is also
 * what keeps "the palette never loses a base module" true by construction: nothing that can
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
  options: GateOptions = {},
): PaletteEntry[] {
  const produced = producedPorts(chain, catalogue, lookup);
  return catalogue
    .filter((entry) => !isHostModule(entry.module))
    .map((entry) => {
      const requires = requiredPorts(entry.module);
      // A fragment skips the gate: every module is offered regardless of the ports its own prefix produces,
      // because those requirements are read at the insertion site. `requires` is still reported — it is what
      // that site has to satisfy — but nothing is withheld for it. A host module is still filtered out: that
      // is not a requirement, it declares no region and can never be a step.
      const missing = options.fragment === true ? [] : missingPorts(entry.module, produced);
      return { module: entry, requires, missing, available: missing.length === 0 };
    });
}

/**
 * What a subflow picker renders for one candidate workflow: addable, or the reason it is not.
 *
 * - `missing` — the candidate's expansion needs ports the chain prefix does not produce yet. Position-dependent:
 *   skipped when authoring a fragment (`GateOptions`), whose requirements are read at the insertion site.
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
  options: GateOptions = {},
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

  // A fragment's requirements are met at the insertion site, not by its own prefix: `missing` is the
  // position-dependent verdict and it does not apply here. `recursive` and `unresolved` still do — a defect in
  // the composition is a defect wherever the fragment sits — so they were judged above and only `missing` is
  // skipped. The candidate resolved, so it is addable.
  if (options.fragment === true) return { ok: true };

  // "Unmet" is positional, and the rule lives in `unmetRequiredPorts`: walk the expansion in order and a
  // module's `required` port is unmet only when neither the chain prefix nor a module earlier in this same
  // expansion has produced it yet. A port the expansion produces later does not count.
  const missing = unmetRequiredPorts(flow, produced, registry);

  return missing.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing };
}
