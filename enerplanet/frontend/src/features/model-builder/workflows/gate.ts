/**
 * The gate rule (plan §3): a module may be appended to the chain **iff every `required` port it declares
 * is produced by a module already in the chain.** "Produced" is read off the declared surface —
 * `module.params` — the ports a module says it may write.
 *
 * ── CAVEAT, recorded rather than hidden: this is editor-level guidance, NOT a core invariant. ──
 * A module may *declare* a port it never writes. `model-start` is the standing example: it declares
 * `workspaceId`/`userId` and deliberately never writes them, so a downstream module that reads those
 * ports is offered before anything has produced them. "Requirements fulfilled" read off declared params
 * is therefore not a guarantee about what a module produces. The engine — not this palette — is what
 * decides whether a node can actually run. Do not mistake the palette for a guarantee.
 */

import { declaredPorts, isHostModule, requiredPorts, type Module } from "../core/module";
import type { PortKey } from "../core/ports";
import type { BuilderModule } from "../shell/contract";
import type { WorkflowNodeDocument } from "./types";

/** One catalogue module on offer, with what it waits for and what is still missing. */
export interface PaletteEntry {
  readonly module: BuilderModule;
  /** Every `required` port the module declares — what it waits for. */
  readonly requires: readonly PortKey[];
  /** The subset of `requires` the chain has not produced. Non-empty means it cannot be added yet. */
  readonly missing: readonly PortKey[];
  readonly available: boolean;
}

/** The ports the chain has produced so far: the union of the declared surface of its modules. */
export function producedPorts(
  chain: readonly WorkflowNodeDocument[],
  catalogue: readonly BuilderModule[],
): Set<PortKey> {
  const byId = new Map(catalogue.map((entry) => [entry.module.id, entry.module]));
  const produced = new Set<PortKey>();
  for (const node of chain) {
    const module = byId.get(node.moduleId);
    // An unknown module contributes nothing — a stored flow may name one the catalogue no longer declares,
    // and that is a data condition to report, not a crash to throw (plan §3).
    if (module === undefined) continue;
    for (const port of declaredPorts(module)) produced.add(port);
  }
  return produced;
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
): PaletteEntry[] {
  const produced = producedPorts(chain, catalogue);
  return catalogue
    .filter((entry) => !isHostModule(entry.module))
    .map((entry) => {
      const requires = requiredPorts(entry.module);
      const missing = missingPorts(entry.module, produced);
      return { module: entry, requires, missing, available: missing.length === 0 };
    });
}
