/**
 * Flow gating — the palette and the validator.
 *
 * A flow is an immutable, ordered list of nodes; a node is one module placed at a position.
 * Gating is one predicate applied twice: a module is placeable iff every one of its `required`
 * ports already exists.
 */

import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import type { Transaction } from "./diff";

/** One module placed at a position. `skippable` is a node property; `auto` belongs to the module. */
export interface FlowNode {
  id: string;
  moduleId: string;
  label?: string;
  skippable?: boolean;
}

/** Immutable: the transcript grows by appending re-runs, never by editing a placement in place. */
export type Flow = readonly FlowNode[];

/** A placement's own name: the seed `id`, or the `moduleId` recovered from an appended `"<n>-<name>"` id. */
export function nodeName(node: FlowNode): string {
  const match = /^\d+-(.+)$/.exec(node.id);
  if (match !== null) return match[1];
  return node.id.length > 0 ? node.id : node.moduleId;
}

/** Mint a placement id — `"<n>-<name>"`, with `n` counting up over every placement ever added. */
export function placementId(index: number, name: string): string {
  return `${index}-${name}`;
}

/** The transcript: the stored placed flow plus every commit's placement, in log order, deduped by id. */
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

/** What a placed node contributes to the available-set — its whole declared surface. */
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

/** Per-node gating report — this is the validator. */
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

/** Modules that cannot be placed, each with the reason. */
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
