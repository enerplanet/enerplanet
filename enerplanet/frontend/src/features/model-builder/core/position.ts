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
 * - **stale** — it ran, but its work was pruned or its inputs went away: it must run again. This is
 *   a statement about **data** only, and it is the whole of it: nothing a *move* does can make a node
 *   stale, because a move writes no value — there is nothing for `pruned`, `blocked` or the module's
 *   gate to report.
 * - **pending** — it never ran in the applied prefix.
 *
 * **Two positions, and the difference is the point.** The **frontier** (`index`) is the first node that
 * is not done — where the work resumes, and what `moveToNode` refuses to move past. But the session can
 * sit *behind* the frontier, because a **jump** is a position move that changes no data: it makes no
 * node stale, so the frontier cannot show where the session went. So a position also carries
 * `restingIndex` — where the session actually sits, taken from the latest jump — and `index` stays the
 * frontier the movement guard needs. The session rests on the jump's target until a newer entry (a run)
 * becomes the latest one, at which point the frontier is the resting place again.
 */

import type { Flow, ModuleRegistry } from "./flow";
import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import { currentJump, lastActionOf, writtenPortsOf } from "./replay";
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
  /**
   * The **frontier**: index of the first node that is not done; `flow.length` when every node is done.
   * `moveToNode` refuses any target past it, because a later node is reached by *running* it. A move
   * changes no data, so a jump never moves the frontier — only where the session rests (`restingIndex`).
   */
  index: number;
  /** The frontier node's id, absent when the flow is complete. */
  nodeId?: string;
  complete: boolean;
  /**
   * Where the session actually rests, when it is not simply the frontier. Equal to `index` whenever the
   * latest applied entry is not a jump; otherwise the **target of that jump** — a position move writes
   * nothing, so the frontier cannot show where the session went, and the session rests on the target
   * until a newer entry (a run) takes over. Absent only when the flow is complete and no jump is current:
   * there is then nothing to rest on.
   */
  restingIndex?: number;
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

    if (transaction === undefined) {
      return { nodeId: node.id, moduleId: node.moduleId, state: "pending", pruned: [], blocked };
    }

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
      pruned.length > 0 || blocked.length > 0 || issues.length > 0 ? "stale" : "done";

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

/**
 * Where the session sits: the frontier, unless the latest applied entry is a **jump** — then the jump's
 * target. A jump changes no data, so it cannot move the frontier; it can only move where the session rests,
 * which is why both readings live here rather than one being derived from the other at every call site.
 */
export function position(flow: Flow, registry: ModuleRegistry, store: Store): Position {
  const report = positionReport(flow, registry, store);
  const notDone = report.findIndex((entry) => entry.state !== "done");
  const complete = notDone === -1;
  const index = complete ? flow.length : notDone;

  const target = currentJump(store.log, store.cursor)?.jump?.to;
  const jumped = target === undefined ? -1 : flow.findIndex((node) => node.id === target);
  const restingIndex = jumped >= 0 ? jumped : complete ? undefined : index;

  return {
    index,
    ...(complete ? {} : { nodeId: flow[index].id }),
    complete,
    ...(restingIndex === undefined ? {} : { restingIndex }),
  };
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
