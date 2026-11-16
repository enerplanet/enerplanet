/**
 * Re-run and jump mechanics — T20's last slice, which is also T12's loopback.
 *
 * A jump moves the session back inside the **same** immutable flow; it never appends a node and
 * never mints an instance id. Two things happen, and they are deliberately different in kind:
 *
 * 1. **the jump discards** — but only what a later node actually *uses*. A port nothing reads is
 *    not worth throwing away (the node that owns it overwrites it when it runs again), and a
 *    node's own configuration is worth keeping. So the prune is the intersection of "required by
 *    a node at or after the target" and "written by a node at or after the target": what the tail
 *    genuinely depends on. Who wrote what comes from the log, not from the modules' declarations —
 *    a module may declare a param it never writes.
 * 2. **the jump rests the position on its target** — that is `position.ts`'s job, from the jump's own
 *    entry (T20a), so even a jump that discards nothing (a bare re-save) moves the position. It is not a
 *    mark on the target's *state*: a move writes no data, so nothing goes stale, and the target stays
 *    `done`. What the jump does is leave the session *resting* there, until a newer entry (a run) takes over.
 *
 * Nothing about correctness rests on the prune: when the target does run again, its own
 * transaction carries the influence cascade (T7) that prunes whatever its new value affects. The
 * prune is what makes the discarding *visible before it happens*, and what marks the tail stale
 * so the walk below knows where to pick up.
 */

import { portPath, type DiffOp, type Transaction } from "./diff";
import { JumpNotBackwards } from "./errors";
import type { Flow, FlowNode, ModuleRegistry } from "./flow";
import { requiredPorts, isAutoModule, type Module, type NodeRef } from "./module";
import type { PortKey } from "./ports";
import { position, positionReport } from "./position";
import { writtenPortsOf } from "./replay";
import type { Store } from "./store";

export interface JumpPlan {
  /** The target's index in the immutable flow. */
  index: number;
  to: string;
  /** Where the session is now — the ledger's `from`. */
  from: string;
  /** What the jump discards: only ports the tail uses, as `remove` ops. */
  cascade: DiffOp[];
}

/** The node the session is currently on; the last node once the flow is complete. */
export function currentId(flow: Flow, registry: ModuleRegistry, store: Store): string | undefined {
  const here = position(flow, registry, store);
  // A jump rests the session on its target (`position.ts`), so that is where it is — even on a flow whose
  // every node is done. Only when the flow is complete *and* no jump is current does the session fall back
  // to the last node, so the frame stays on the module that finished rather than emptying out.
  if (here.restingIndex !== undefined) return flow[here.restingIndex].id;
  return flow.length === 0 ? undefined : flow[flow.length - 1].id;
}

/** What a jump to `targetId` would discard, without sealing anything — the UI's preview. */
export function planJump(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  targetId: string,
): JumpPlan {
  const index = flow.findIndex((node) => node.id === targetId);
  if (index === -1) {
    throw new Error(`[model-builder] node "${targetId}" is not in the flow`);
  }

  const used = new Set<PortKey>();
  const written: PortKey[] = [];

  for (const node of flow.slice(index)) {
    const module: Module | undefined = registry[node.moduleId];
    if (module === undefined) continue;
    for (const port of requiredPorts(module)) used.add(port);
    for (const port of writtenPortsOf(store.log, node.id, store.cursor) as PortKey[]) {
      if (!written.includes(port)) written.push(port);
    }
  }

  const cascade = written
    .filter((port) => used.has(port) && store.data[port] !== undefined)
    .map((port) => ({ op: "remove" as const, path: portPath(port), prev: store.data[port] }));

  return { index, to: targetId, from: currentId(flow, registry, store) ?? targetId, cascade };
}

/**
 * Seal a jump: one transaction naming where the session came from and went, discarding the used
 * tail values in its own `cascade`. Refuses a forward target before writing anything.
 */
export function jumpTo(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  targetId: string,
): Transaction {
  const plan = planJump(flow, registry, store, targetId);
  if (plan.index > position(flow, registry, store).index) throw new JumpNotBackwards(targetId);

  // `auto` is the target module's fact (`Module.auto`), not the node's — history records which step a jump
  // belongs to and whether it was automatic, and now the module is where that is declared.
  const targetModule = registry[flow[plan.index].moduleId];
  return store.applyTransaction([], plan.cascade, {
    node: {
      id: targetId,
      ...(targetModule !== undefined && isAutoModule(targetModule) ? { auto: true } : {}),
    },
    kind: "jump",
    jump: { from: plan.from, to: plan.to },
  });
}

/** How the walk runs a node — `engine.runModule` satisfies this. */
export type RunNode = (module: Module, node: NodeRef) => Promise<unknown>;

export interface WalkOptions {
  /**
   * Stop *before* a node matching this predicate (the node is left stale, not skipped).
   *
   * The session layer uses it to stop at the end of an auto chain and hand control back to the
   * user; the default walks the whole tail.
   */
  stopWhen?: (node: FlowNode) => boolean;
}

/**
 * Walk the flow from the current position, running every node that is not done.
 *
 * This is the re-run: a node whose outputs survived the jump was never affected, so it is
 * **elided** and not run at all. Nodes whose inputs the jump discarded run in flow order, and
 * each seals its own transaction — so a re-run that re-derives an identical value leaves the
 * nodes behind it done, and they stay elided too.
 *
 * A node whose required inputs are still missing is skipped rather than run: T21 would refuse it,
 * and running the nodes after it is still meaningful.
 *
 * @returns the node ids that actually ran, in order.
 */
export async function walkTail(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  run: RunNode,
  options: WalkOptions = {},
): Promise<string[]> {
  const ran: string[] = [];

  for (let index = 0; index < flow.length; index += 1) {
    const node = flow[index];
    if (options.stopWhen?.(node) === true) break;

    // States change as we go, so the report is read fresh at every step.
    const report = positionReport(flow, registry, store)[index];
    if (report.state === "done") continue;
    if (report.blocked.length > 0) continue;

    const module: Module | undefined = registry[node.moduleId];
    if (module === undefined) continue;

    await run(module, { id: node.id, ...(isAutoModule(module) ? { auto: true } : {}) });
    ran.push(node.id);
  }

  return ran;
}
