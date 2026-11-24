/**
 * Position — the transcript's derived state.
 *
 * The session holds no stored position: it is derived per placement from that placement's own
 * single commit. A placement is `done` when it has a commit whose work is still in the store, with
 * its inputs present and the module's gate satisfied; `stale` when that work was pruned or its
 * inputs went away; `pending` when it has no commit yet.
 *
 * `index` is the frontier — the first placement that is not done — where the work resumes.
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
  /** The placement's name — stable across re-runs, unlike `nodeId`. */
  name: string;
  state: DerivedState;
  /** Ports this placement wrote that are no longer in the store. */
  pruned: PortKey[];
  /** Required ports absent from the store right now — why it cannot run here. */
  blocked: PortKey[];
}

export interface Position {
  /** The frontier: index of the first placement that is not done; `flow.length` when all are done. */
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

    // The placement's own commit is the truth about what it wrote.
    const written = writtenPortsOf(store.log, node.id) as PortKey[];
    const pruned = written.filter((port) => store.data[port] === undefined);

    // The module's own verdict on the store — what makes "every node is done" mean the model is whole.
    const issues = module?.validate?.({ store: store.data }) ?? [];

    // Running with nothing to write is a finished run; `written.length === 0` is not a reason to hold back.
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

/** Where the work resumes: the frontier — the first placement that is not done. */
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
