/**
 * The gate rule: a module may be appended to the chain iff every `required` port it declares is produced
 * by a module already in the chain, read off the declared surface (`module.params`); a subflow node
 * contributes the ports its expansion produces.
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

/** Options for authoring a fragment: the positional gate is off (its requirements are read at the insertion site). */
export interface GateOptions {
  /** Authoring a fragment: withhold nothing for an unmet requirement, and judge no candidate `missing`. */
  readonly fragment?: boolean;
}

/** The ports the chain has produced so far: its modules' declared surface, a subflow's read from its expansion. */
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
 * Walk a node list, adding each module's declared surface and descending into each subflow. A subflow of a
 * workflow nobody stores, and a module the catalogue does not declare, both contribute nothing.
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

/** The `required` ports a flow leaves unmet, walked in execution order — a later writer cannot satisfy an earlier reader. */
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

/** The ports a fragment needs from the flow that inserts it: its own expansion walked with an empty prefix. */
export function fragmentRequiredPorts(
  document: WorkflowDocument,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): PortKey[] {
  return unmetRequiredPorts(expand(document, lookup, registry), new Set(), registry);
}

/** The ports a document's own chain leaves unmet, read with an empty prefix, or `undefined` when it cannot be flattened. */
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

/** Whether a document's chain, in the order it stands, satisfies itself — needs nothing from a flow around it. */
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

/** Whether moving the entry at `index` one position `direction` introduces no new unmet requirement. */
export function moveIsAllowed(
  document: WorkflowDocument,
  index: number,
  direction: MoveDirection,
  lookup: WorkflowLookup,
  registry: ModuleRegistry,
): MoveVerdict {
  const before = ownUnmetPorts(document, lookup, registry);
  if (before === undefined) return { ok: true };

  const moved = moveNode(document.nodes, index, direction);
  const after = ownUnmetPorts({ ...document, nodes: moved }, lookup, registry) ?? before;

  const introduced = [...after].filter((port) => !before.has(port));
  return introduced.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing: introduced };
}

/**
 * The palette: every node module in the catalogue, in order, each with what it needs and what is still
 * missing. A host module is filtered out — it declares no region, so it is never a step.
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
      const missing = options.fragment === true ? [] : missingPorts(entry.module, produced);
      return { module: entry, requires, missing, available: missing.length === 0 };
    });
}

/**
 * A subflow candidate's verdict: `missing` names unmet ports, `recursive` a self-containing expansion,
 * `unresolved` a reference that cannot be flattened.
 */
export type SubflowVerdict =
  | { ok: true }
  | { ok: false; reason: "missing"; missing: PortKey[] }
  | { ok: false; reason: "recursive" }
  | { ok: false; reason: "unresolved" };

/** Judge one candidate subflow against the chain prefix, flattening through `registry` and `lookup`. */
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

  let flow: FlowNode[];
  try {
    flow = expand(candidate, lookup, registry);
  } catch {
    return { ok: false, reason: "unresolved" };
  }

  if (options.fragment === true) return { ok: true };

  const missing = unmetRequiredPorts(flow, produced, registry);

  return missing.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing };
}
