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
 */

import type { Flow, ModuleRegistry } from "./flow";
import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import { writtenPortsOf } from "./replay";
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

    // What it actually wrote — the log's word, not the module's declaration. Scanning every
    // transaction of the node matters: a jump stamps the target with an empty primary.
    const written = writtenPortsOf(store.log, node.id, store.cursor) as PortKey[];
    const touched = store.log
      .slice(0, Math.min(store.cursor, store.log.length))
      .some((transaction) => transaction.nodeId === node.id);

    if (!touched) {
      return { nodeId: node.id, moduleId: node.moduleId, state: "pending", pruned: [], blocked };
    }

    const pruned = written.filter((port) => store.data[port] === undefined);

    // A node that ran but wrote nothing can never be called done — the one hole in deriving
    // state from history, recorded as open in the spec.
    const state: DerivedState =
      written.length === 0 || pruned.length > 0 || blocked.length > 0 ? "stale" : "done";

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
