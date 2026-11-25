/**
 * Auto-node orchestration — the frame's side of a step that runs itself.
 *
 * A step is automatic because its **module** declares `auto: true` (`Module.auto`), which is what the frame
 * reads here. `autoRunFor` answers whether an auto node at the frontier should run now; `createAutoGuard`
 * makes the run idempotent.
 */

import type { Flow, ModuleRegistry } from "../core/flow";
import { isAutoModule, type Module } from "../core/module";
import { position, positionReport } from "../core/position";
import { lastActionOf } from "../core/replay";
import type { Store } from "../core/store";

export interface AutoRunPlan {
  /** The placement id to stamp the transaction with — history names positions, and a module can be placed twice. */
  id: string;
  module: Module;
  /** A change token for the store when the run is decided: the same fingerprint is the same attempt. */
  fingerprint: number;
}

/**
 * The auto node at the frontier that should run now, or nothing.
 */
export function autoRunFor(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): AutoRunPlan | undefined {
  const at = position(flow, registry, store);
  if (at.complete) return undefined;

  const node = flow[at.index];

  // The module decides: its `auto` flag says whether arriving here is a run or a place to act.
  const module = registry[node.moduleId];
  if (module === undefined) return undefined;
  if (!isAutoModule(module)) return undefined;

  const report = positionReport(flow, registry, store)[at.index];
  // It can only run if its required inputs are there; a blocked auto node waits, it does not error.
  if (report.blocked.length > 0) return undefined;

  // The invalidator's view, not the position's: run when the node never produced its work, or an input change pruned it.
  const ran = lastActionOf(store.log, node.id) !== undefined;
  if (ran && report.pruned.length === 0) return undefined;

  return { id: node.id, module, fingerprint: store.version };
}

/** The claim a run makes on an attempt, so a re-render — or StrictMode's double-invoke — is not a second run. */
export interface AutoGuard {
  /** True the first time this exact attempt is seen; false for a repeat of it. */
  claim(plan: AutoRunPlan): boolean;
}

export function createAutoGuard(): AutoGuard {
  let claimed: { id: string; fingerprint: number } | null = null;

  return {
    claim(plan) {
      if (claimed !== null && claimed.id === plan.id && claimed.fingerprint === plan.fingerprint) {
        return false;
      }
      claimed = { id: plan.id, fingerprint: plan.fingerprint };
      return true;
    },
  };
}
