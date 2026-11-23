/**
 * Position — the transcript's derived state.
 *
 * The session holds no stored position: it is *derived*, per **placement**, from that
 * placement's own single commit (§4, §7 H7). With one commit per placement (a re-run appends a
 * new placement rather than rewriting one), a placement's state is a statement about *its own*
 * commit — no union over a `nodeId`, no exclusion of jumps, no log scan.
 *
 * The derivation, per placement:
 *
 * - **done** — the placement has a commit, what that commit wrote is still in the store, its
 *   declared inputs are still there, and the module's own gate reports no issues.
 * - **stale** — it ran, but its work was pruned or its inputs went away: it must run again. A
 *   statement about **data** only — a move writes no value, so nothing a *view* does can make a
 *   placement stale.
 * - **pending** — it has no commit yet.
 *
 * **One index, not two.** v1 carried a second position (where a *jump* left the session resting)
 * because a move was a zero-diff transaction. v2 moves the view out of the log, so there is only
 * the **frontier**: `index` is the first placement that is not done — where the work resumes.
 * `restingIndex` and the "two positions" doctrine are gone.
 */

import { nodeName, type Flow, type ModuleRegistry } from "./flow";
import { requiredPorts, type Module } from "./module";
import type { PortKey } from "./ports";
import { lastActionOf, writtenPortsOf } from "./replay";
import type { Store } from "./store";

/** The three states derivable from history — the rest of `NodeState` is session or runtime. */
export type DerivedState = "done" | "stale" | "pending";

export interface NodePosition {
  nodeId: string;
  moduleId: string;
  /** The placement's name (§2) — stable across re-runs, unlike `nodeId`. */
  name: string;
  state: DerivedState;
  /** Ports this placement wrote that are no longer in the store. */
  pruned: PortKey[];
  /** Required ports absent from the store right now — why it cannot run here. */
  blocked: PortKey[];
}

export interface Position {
  /**
   * The **frontier**: index of the first placement that is not done; `flow.length` when every
   * placement is done. There is nothing else — no `restingIndex`, because a view is not a commit.
   */
  index: number;
  /** The frontier placement's id, absent when the transcript is complete. */
  nodeId?: string;
  complete: boolean;
}

/** Per-placement derived state, in transcript order. */
export function positionReport(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
): NodePosition[] {
  return flow.map((node) => {
    const module: Module | undefined = registry[node.moduleId];
    const blocked = module === undefined ? [] : missingFromStore(module, store);

    const transaction = lastActionOf(store.log, node.id);

    if (transaction === undefined) {
      return {
        nodeId: node.id,
        moduleId: node.moduleId,
        name: nodeName(node),
        state: "pending",
        pruned: [],
        blocked,
      };
    }

    // The placement's own commit is the truth about what it wrote, so a re-run that pruned it
    // reads stale the moment the value leaves the store.
    const written = writtenPortsOf(store.log, node.id) as PortKey[];
    const pruned = written.filter((port) => store.data[port] === undefined);

    // The module's own verdict on the store. Asked here, not only at the save node, because this is
    // what makes "every node is done" mean the model is *whole*: a placement that ran without
    // producing work it stands behind is not finished.
    const issues = module?.validate?.({ store: store.data }) ?? [];

    // **Running with nothing to write is a finished run**, so `written.length === 0` is not a reason
    // to hold a placement back: an optional editing step writes only what the user changed, and a
    // completed run against an untouched store writes nothing at all.
    const state: DerivedState =
      pruned.length > 0 || blocked.length > 0 || issues.length > 0 ? "stale" : "done";

    return { nodeId: node.id, moduleId: node.moduleId, name: nodeName(node), state, pruned, blocked };
  });
}

/** Placement id → derived state, for the palette and the step list. */
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
 * Where the work resumes: the frontier — the first placement that is not done (§3, §7 H7).
 */
export function position(flow: Flow, registry: ModuleRegistry, store: Store): Position {
  const report = positionReport(flow, registry, store);
  const notDone = report.findIndex((entry) => entry.state !== "done");
  const complete = notDone === -1;
  const index = complete ? flow.length : notDone;

  return {
    index,
    ...(complete ? {} : { nodeId: flow[index].id }),
    complete,
  };
}

/** The placement at the frontier — the one the user should be looking at. */
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
