/**
 * Flow gating — the palette and the validator (`Plan.md` §7, cases T10/T11).
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
 * surface (`Modules.md` §1 — a module may write any param it declares). A node never satisfies
 * its own requirement, which is why the walk checks *before* contributing.
 *
 * Not modelled here yet: **one writer per port** (`Plan.md` §7) — the contract has no
 * readable/writable distinction on `Param`, so two modules that merely read the same port are
 * indistinguishable from two that write it. That needs `Param` to say which.
 */

import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";

/** One module placed at a position. `auto` and `skippable` are node properties, not module ones. */
export interface FlowNode {
  id: string;
  moduleId: string;
  label?: string;
  auto?: boolean;
  skippable?: boolean;
}

/** Immutable: a re-run moves the session's *position*, it never changes the flow. */
export type Flow = readonly FlowNode[];

/** Module id → module. The register (`Modules.md` §7) is this map. */
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
