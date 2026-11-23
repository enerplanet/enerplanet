/**
 * Flow gating — the palette and the validator.
 *
 * A **flow** is an immutable, ordered list of nodes; a **node** is one module placed at a
 * position. Gating is one predicate applied twice:
 *
 *   a module is placeable **iff every one of its `required` ports already exists**
 *
 * The palette asks that question of every registered module to decide what to offer; the
 * validator asks it of every placed node to decide whether the flow runs. Because it is the
 * *same* predicate against the same accumulated available-set, a flow built through the palette
 * cannot be invalid — validity is enforced by construction, not checked afterwards.
 *
 * The available-set grows as the flow is walked: each placed node contributes its whole store
 * surface (a module may write any param it declares). A node never satisfies
 * its own requirement, which is why the walk checks *before* contributing.
 *
 * Not modelled here yet: **one writer per port** — the contract has no
 * readable/writable distinction on `Param`, so two modules that merely read the same port are
 * indistinguishable from two that write it. That needs `Param` to say which.
 */

import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import type { Transaction } from "./diff";

/** One module placed at a position. `skippable` is a node property; `auto` is not — it belongs to the module (`Module.auto`). */
export interface FlowNode {
  id: string;
  moduleId: string;
  label?: string;
  skippable?: boolean;
}

/** Immutable: the transcript grows by appending re-runs, never by editing a placement in place (§3). */
export type Flow = readonly FlowNode[];

/**
 * A placement's own name — its seed `id`, else its `moduleId` (§2).
 *
 * A placement id is `"<n>-<name>"`, so the name is recovered by stripping the leading count. The
 * name, not the placement id, is what a workflow keys recommendations on (§6) and what a successor
 * re-uses when a re-run appends: the placement id changes on every re-run, the name does not.
 */
export function nodeName(node: FlowNode): string {
  const match = /^\d+-(.+)$/.exec(node.id);
  if (match !== null) return match[1];
  return node.id.length > 0 ? node.id : node.moduleId;
}

/**
 * Mint a placement id: `"<n>-<name>"`, `n` counting up from `0` over every placement ever added
 * (§2). `n` is monotonic and never reused — the flow never shrinks (a node is removed by an
 * *edit to null*, which keeps its slot), so `n` is simply "how many placements exist so far",
 * always derivable with nothing extra to persist.
 */
export function placementId(index: number, name: string): string {
  return `${index}-${name}`;
}

/**
 * The **transcript**: the flow actually enacted (§3).
 *
 * `placed` is the session's stored placed flow — the seed placements plus any appended ones,
 * **including the nodes that have not run yet**. Append every commit's placement, in log order,
 * whose id is not already placed. The committed part is a pure fold of the log; the uncommitted
 * part is the stored flow. Every placement is unique by construction (§2), so "already placed"
 * is an id check.
 */
export function transcript(placed: Flow, log: readonly Transaction[]): Flow {
  const seen = new Set(placed.map((node) => node.id));
  const appended: FlowNode[] = [];

  for (const commit of log) {
    const node = commit.node;
    if (node === undefined) continue;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    appended.push({ id: node.id, moduleId: node.moduleId });
  }

  return [...placed, ...appended];
}

/** Module id → module. The register is this map. */
export type ModuleRegistry = Readonly<Record<string, Module>>;

/** Ports that exist before any node runs — `model-start`'s outputs and static base data. */
export type SeedPorts = readonly PortKey[];

export interface PlacementReport {
  nodeId: string;
  moduleId: string;
  placeable: boolean;
  /** Required ports missing at this position — the reason, when it is not placeable. */
  missing: PortKey[];
}

/** The required ports of `module` that the available-set does not satisfy. */
export function missingPorts(module: Module, available: ReadonlySet<PortKey>): PortKey[] {
  return requiredPorts(module).filter((port) => !available.has(port));
}

/** The one predicate: placeable iff nothing required is missing. */
export function isPlaceable(module: Module, available: ReadonlySet<PortKey>): boolean {
  return missingPorts(module, available).length === 0;
}

/**
 * What a placed node contributes to the available-set — its whole declared surface, since any
 * declared param is potentially writable.
 */
export function contributedPorts(module: Module): PortKey[] {
  return module.params.map((param) => param.port);
}

/** Walk the flow, accumulating what each placed node contributes. */
export function availablePorts(
  flow: Flow,
  registry: ModuleRegistry,
  seeds: SeedPorts = [],
): Set<PortKey> {
  const available = new Set<PortKey>(seeds);

  for (const node of flow) {
    const module = registry[node.moduleId];
    if (module === undefined) continue;
    for (const port of contributedPorts(module)) available.add(port);
  }

  return available;
}

/**
 * Per-node gating report — this **is** the validator. A flow is valid when every entry is
 * placeable, and the palette could not have produced anything else.
 */
export function placementReport(
  flow: Flow,
  registry: ModuleRegistry,
  seeds: SeedPorts = [],
): PlacementReport[] {
  const available = new Set<PortKey>(seeds);
  const report: PlacementReport[] = [];

  for (const node of flow) {
    const module = registry[node.moduleId];

    if (module === undefined) {
      // An unknown node contributes nothing, so everything downstream of it is gated too.
      report.push({ nodeId: node.id, moduleId: node.moduleId, placeable: false, missing: [] });
      continue;
    }

    const missing = missingPorts(module, available);
    report.push({
      nodeId: node.id,
      moduleId: node.moduleId,
      placeable: missing.length === 0,
      missing,
    });

    for (const port of contributedPorts(module)) available.add(port);
  }

  return report;
}

/** Validity is exactly "every node was placeable where it sits". */
export function isValidFlow(
  flow: Flow,
  registry: ModuleRegistry,
  seeds: SeedPorts = [],
): boolean {
  return placementReport(flow, registry, seeds).every((entry) => entry.placeable);
}

/** The palette: every module the available-set satisfies, in registry order. */
export function palette(available: ReadonlySet<PortKey>, registry: ModuleRegistry): Module[] {
  return Object.keys(registry)
    .map((id) => registry[id])
    .filter((module) => module !== undefined && isPlaceable(module, available));
}

/**
 * The other half of the palette: modules that cannot be placed, each with the reason — so the
 * UI can show "needs buildings — no producer upstream yet" instead of hiding them silently.
 */
export function lockedModules(
  available: ReadonlySet<PortKey>,
  registry: ModuleRegistry,
): Array<{ module: Module; missing: PortKey[] }> {
  return Object.keys(registry)
    .map((id) => registry[id])
    .filter((module): module is Module => module !== undefined)
    .map((module) => ({ module, missing: missingPorts(module, available) }))
    .filter((entry) => entry.missing.length > 0);
}
