/**
 * Auto-node orchestration — the frame's side of a step that runs
 * itself. A step is automatic because its **module** declares `auto: true` (`Module.auto`), which is what the
 * frame reads here; the flow node carries no such flag of its own.
 *
 * An auto node has **no forward action to press**: the session runs it **on arrival**, as soon as its inputs
 * are present, and the position advances on its own once the run lands a finished node (position is derived, so
 * a completed node simply stops being the first thing that is not done). This file is the whole decision, kept
 * pure so it can be tested without a frame:
 *
 * - `autoRunFor` answers "is there an auto node at the frontier that should run now, and for which
 *   state of the store?". It reads **staleness as the invalidator sees it** — the node never produced its work,
 *   or an input change pruned the outputs it wrote — and never anything a *view* leaves behind: a view changes
 *   no data, so coming back to look leaves a node's work in place and there is nothing to re-run. The node it
 *   reads is the **frontier** (`position.ts`).
 * - `createAutoGuard` is what makes the run idempotent. The frame re-renders for reasons of its own and React
 *   runs an effect twice under StrictMode, so a run is **claimed once** per `(node id, fingerprint)`. The
 *   fingerprint is the store's change token: it moves when an input changes, and it does not move when the
 *   frame merely re-renders — which is exactly the distinction the two rules need.
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
  /**
   * A change token for the store at the moment the run is decided. Two decisions with the same fingerprint are
   * the **same attempt** (a re-render, or StrictMode's second invocation); a different one means the store
   * moved — an input changed — and the node may run again.
   */
  fingerprint: number;
}

/**
 * The auto node at the frontier that should run now, or nothing.
 *
 * Nothing when the position is complete, the module is unknown or interactive, its inputs are not all
 * present (it *cannot* run — the missing inputs leave it `blocked`), or its work is already there and untouched. Whether the step is
 * automatic is the **module's** declaration (`Module.auto`), read here through `isAutoModule` — not a property
 * of the flow node, which the product has no way to author and which nothing in the frame can own.
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

  // The invalidator's view, not the position's: a node needs a run when it never produced its work, or that
  // work was pruned because an input changed. A view changes no data, so it leaves the work in place and
  // is *not* a reason to run — that is the trap this function exists to avoid.
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
