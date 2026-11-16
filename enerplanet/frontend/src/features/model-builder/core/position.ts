/**
 * Position — the flow's derived state (`Plan.md` §7, case T20).
 *
 * A flow is immutable and the session holds exactly one **position** in it. Nothing stores
 * that position: it is *derived* from `(projection, log, cursor)`, which is what makes undo and
 * redo reposition the flow for free, with no bookkeeping to keep in sync.
 *
 * The derivation, per node:
 *
 * - **done** — the applied prefix holds a transaction for this node, what that transaction
 *   wrote is still in the store, and its declared inputs are still there too. (What a node
 *   *wrote* comes from the transaction itself, which is truthful; a declared writable flag
 *   would only duplicate history.)
 * - **stale** — it ran, but its work was pruned or its inputs went away: it must run again.
 * - **pending** — it never ran in the applied prefix.
 *
 * **position** = the first node that is not done. That is why a jump must prune its target's
 * outputs: without that the target would still read as done and the position would fall
 * straight forward again, making the jump a no-op.
 *
 * One exception, and it is deliberate: a **jump's re-arm does not apply to an `auto` node** (T15). There is
 * nothing for a user to re-apply on a node that runs itself, and its work is either still valid or was pruned
 * by an input change — which already reads stale through `pruned`. So a bare re-arm of an auto node leaves it
 * `done` and the position passes over it, rather than resting on a node that no longer has a forward action.
 */

import type { Flow, ModuleRegistry } from "./flow";
import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import { lastActionOf, lastJumpTo, writtenPortsOf } from "./replay";
import type { Store } from "./store";

/** The three states derivable from history — the rest of `NodeState` is session or runtime. */
export type DerivedState = "done" | "stale" | "pending";

export interface NodePosition {
  nodeId: string;
  moduleId: string;
  state: DerivedState;
  /** Ports this node wrote that are no longer in the store. */
  pruned: PortKey[];
  /** Required ports absent from the store right now — why it cannot run here. */
  blocked: PortKey[];
}

export interface Position {
  /** Index of the first node that is not done; `flow.length` when the flow is complete. */
  index: number;
  nodeId?: string;
  complete: boolean;
}

/** Per-node derived state, in flow order. */
export function positionReport(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): NodePosition[] {
  return flow.map((node) => {
    const module: Module | undefined = registry[node.moduleId];
    const blocked = module === undefined ? [] : missingFromStore(module, store);

    const transaction = lastActionOf(store.log, node.id, store.cursor);
    const jump = lastJumpTo(store.log, node.id, store.cursor);

    if (transaction === undefined && jump === undefined) {
      return { nodeId: node.id, moduleId: node.moduleId, state: "pending", pruned: [], blocked };
    }

    // A jump that lands here re-arms the node: the session is *meant* to be back at it, so its
    // earlier work cannot count as done — even when the jump had nothing to discard, which is
    // exactly what makes the zero-diff jump (a bare re-save) mean anything.
    //
    // **Except an auto node**, which has nothing for a user to re-apply: its work is either still valid (so it
    // reads done and the position moves on) or was pruned because an input changed, which *already* reads stale
    // through `pruned` (T7). A bare re-arm is not an input change, so it must not force an auto node to run
    // again (T15) — and not resting the position on it is what lets the session pass a re-armed auto node
    // without the button it no longer has.
    const rearmed =
      node.auto !== true &&
      jump !== undefined &&
      (transaction === undefined || jump.revision > transaction.revision);

    const written = writtenPortsOf(store.log, node.id, store.cursor) as PortKey[];
    const pruned = written.filter((port) => store.data[port] === undefined);

    // The module's own verdict on the store (T22). Asked here, not only at the save node, because this is
    // what makes "every node is done" mean the model is *whole*: a node that ran without producing work it
    // stands behind is not finished, so the position rests on it instead of walking past it.
    const issues = module?.validate?.({ store: store.data }) ?? [];

    /**
     * **Running with nothing to write is a finished run**, so `written.length === 0` is not a reason to hold a
     * node back.
     *
     * That test used to sit here, guarding against a module whose run failed to produce anything. It cannot
     * tell that apart from a node whose run genuinely had nothing to do — and there are such nodes: an optional
     * editing step writes only what the user changed, so a completed run against an untouched store writes
     * nothing at all. Held back by this test, such a node could never be done, the position rested on it
     * forever, and its own Continue looked broken while every earlier node advanced.
     *
     * The gate is the honest verdict on whether a node produced what it stands behind (T22), and it is asked on
     * the line above. A node that has not run at all is `pending` long before reaching here.
     */
    const state: DerivedState =
      rearmed || pruned.length > 0 || blocked.length > 0 || issues.length > 0 ? "stale" : "done";

    return { nodeId: node.id, moduleId: node.moduleId, state, pruned, blocked };
  });
}

/** Node id → derived state, for the palette and the step list. */
export function nodeStates(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): Record<string, DerivedState> {
  const states: Record<string, DerivedState> = {};
  for (const entry of positionReport(flow, registry, store)) states[entry.nodeId] = entry.state;
  return states;
}

/** Where the session sits: the first node that is not done. */
export function position(flow: Flow, registry: ModuleRegistry, store: Store): Position {
  const report = positionReport(flow, registry, store);
  const index = report.findIndex((entry) => entry.state !== "done");

  if (index === -1) return { index: flow.length, complete: true };
  return { index, nodeId: flow[index].id, complete: false };
}

/** The node at the current position — the one the user should be looking at. */
export function activeNode(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): Flow[number] | undefined {
  const current = position(flow, registry, store);
  return current.complete ? undefined : flow[current.index];
}

function missingFromStore(module: Module, store: Store): PortKey[] {
  return requiredPorts(module).filter((port) => store.data[port] === undefined);
}
