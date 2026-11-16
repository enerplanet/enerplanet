/**
 * Auto-node orchestration (`spec/core.md` T15, T23; `spec/frame.md` §5) — the frame's side of a node that runs
 * itself.
 *
 * An auto node has **no forward action to press**: the session runs it **on arrival**, as soon as its inputs
 * are present, and the position advances on its own once the run lands a finished node (position is derived, so
 * a completed node simply stops being the first thing that is not done). This file is the whole decision, kept
 * pure so it can be tested without a frame:
 *
 * - `autoRunFor` answers "is there an auto node at the session's position that should run now, and for which
 *   state of the store?". It reads **staleness as the invalidator sees it** — the node never produced its work,
 *   or an input change pruned the outputs it wrote (T7) — and never anything a *move* leaves behind: a jump
 *   changes no data, so coming back to look leaves a node's work in place and there is nothing to re-run. The
 *   node it reads is the session's **resting** node (`position.ts`), not the frontier: a jump can leave the
 *   session *behind* the frontier, and an auto node runs on **arrival** — arrival is where the session rests.
 * - `createAutoGuard` is what makes the run idempotent. The frame re-renders for reasons of its own and React
 *   runs an effect twice under StrictMode, so a run is **claimed once** per `(node id, fingerprint)`. The
 *   fingerprint is the store's change token: it moves when an input changes, and it does not move when the
 *   frame merely re-renders — which is exactly the distinction the two rules need.
 */

import type { Flow, ModuleRegistry } from "../core/flow";
import type { Module } from "../core/module";
import { position, positionReport } from "../core/position";
import { lastActionOf } from "../core/replay";
import type { Store } from "../core/store";

export interface AutoRunPlan {
  /** The node id to stamp the transaction with — history names positions, and a module can be placed twice. */
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
 * The auto node the session sits on that should run now, or nothing.
 *
 * Nothing when the position is complete, the node is interactive, its module is unknown, its inputs are not all
 * present (it *cannot* run — T21, `blocked`), or its work is already there and untouched.
 */
export function autoRunFor(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): AutoRunPlan | undefined {
  const at = position(flow, registry, store);
  if (at.complete) return undefined;

  // The session's resting node, not the frontier: a jump leaves the session on its target — which can be
  // *behind* the frontier — and an auto node runs on arrival, so the node to consider is the one the session
  // is on. Running the frontier node instead would fire an auto node the session has not reached yet.
  const here = at.restingIndex ?? at.index;
  const node = flow[here];
  if (node.auto !== true) return undefined;

  const module = registry[node.moduleId];
  if (module === undefined) return undefined;

  const report = positionReport(flow, registry, store)[here];
  // It can only run if its required inputs are there; a blocked auto node waits, it does not error.
  if (report.blocked.length > 0) return undefined;

  // The invalidator's view, not the position's: a node needs a run when it never produced its work, or that
  // work was pruned because an input changed (T7). A move changes no data, so it leaves the work in place and
  // is *not* a reason to run — that is the trap this function exists to avoid.
  const ran = lastActionOf(store.log, node.id, store.cursor) !== undefined;
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
