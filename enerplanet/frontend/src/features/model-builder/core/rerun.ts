/**
 * Re-run and repair mechanics.
 *
 * v1 planned *jumps* inside one immutable flow. v2 has no jumps: a change is a fresh commit at
 * the tip carrying a shop-fresh placement, and the flow is a transcript that grows. What is left
 * here is the two things the loop in §5 needs:
 *
 * 1. **which placement a run targets** (§2) — a placement with no commit is **filled**, one that
 *    already ran is **appended** to (a successor with a fresh id). One rule, and it produces the
 *    transcript `A B C D E C D E`.
 * 2. **goal-driven repair** (§5 step 3) — from the terminal's `required` ports, find every port
 *    now missing, map it to the placement that produces it, and re-run that placement (which
 *    appends a successor), iterating to a fixpoint. Only the **influence-affected** placements are
 *    re-run, in transcript order: a placement between the change and the terminal whose ports
 *    nothing downstream reads is skipped, because re-running it is wasted work and may not even
 *    be re-runnable.
 *
 * Nothing about correctness rests on guessing what a re-run will produce: each re-run seals its
 * own commit and its own cascade, so the fixpoint is reached by actually running, not by
 * predicting.
 */

import {
  nodeName,
  placementId,
  transcript,
  type Flow,
  type FlowNode,
  type ModuleRegistry,
} from "./flow";
import { isAutoModule, requiredPorts, type Module, type NodeRef } from "./module";
import type { PortKey } from "./ports";
import type { Store } from "./store";

/** How the walk runs a placement — `engine.runModule` satisfies this. */
export type RunNode = (module: Module, node: NodeRef) => Promise<unknown>;

/**
 * The placement a run should target: **fill** a placement that has no commit yet, otherwise
 * **append a successor placement** with a fresh id (§2).
 *
 * The successor's index is the count of placements so far (`transcript().length`), which is
 * monotonic because the flow never shrinks — every placement ever added is either in the stored
 * flow or carried by a commit.
 */
export function runTarget(placed: Flow, store: Store, placement: FlowNode): NodeRef {
  const hasCommit = store.log.some((commit) => commit.node?.id === placement.id);
  if (!hasCommit) {
    return { id: placement.id, moduleId: placement.moduleId };
  }
  const current = transcript(placed, store.log);
  return { id: placementId(current.length, nodeName(placement)), moduleId: placement.moduleId };
}

/**
 * Run one placement, filling it on first use or appending a successor on re-use (§2).
 *
 * @returns the placement id the run sealed into, or `undefined` when the module is unknown or
 *          the run was refused (a missing required input, say) — the walker skips rather than
 *          throwing, so a broken placement does not stop the ones after it.
 */
export async function runPlacement(
  placed: Flow,
  registry: ModuleRegistry,
  store: Store,
  run: RunNode,
  placement: FlowNode,
): Promise<string | undefined> {
  const module: Module | undefined = registry[placement.moduleId];
  if (module === undefined) return undefined;

  const target = runTarget(placed, store, placement);
  const ref: NodeRef = isAutoModule(module) ? { ...target, auto: true } : target;
  const before = store.log.length;

  try {
    await run(module, ref);
  } catch {
    return undefined;
  }

  // The engine always seals a trace, so a grown log means the run landed.
  return store.log.length > before ? ref.id : undefined;
}

/**
 * Goal-driven repair toward a terminal placement (§5 step 3).
 *
 * From the terminal's `required` ports, find every port now missing, map it to the placement that
 * produces it, and re-run that placement — which appends a successor. Each re-run seals its own
 * commit and its own cascade, so this iterates to a fixpoint. Stop when every required port is
 * present, i.e. the terminal is **runnable**.
 *
 * @param terminalName the terminal's **name** (§2) — a `moduleId`, or the seed node's own id.
 * @returns the successor placement ids the repair appended, in transcript order.
 */
export async function repair(
  placed: Flow,
  registry: ModuleRegistry,
  store: Store,
  run: RunNode,
  terminalName: string,
): Promise<string[]> {
  const ran: string[] = [];
  // A fixpoint cap: a module whose re-run never fills the port would otherwise append forever.
  const maxPasses = 64;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const current = transcript(placed, store.log);
    const terminalIndex = findTerminal(current, terminalName);
    if (terminalIndex < 0) break;

    const terminal = current[terminalIndex];
    const terminalModule: Module | undefined = registry[terminal.moduleId];
    if (terminalModule === undefined) break;
    if (missingRequired(terminalModule, store).length === 0) break;

    // Every placement whose output is needed (transitively) to satisfy the terminal's missing
    // inputs — the influence-affected set, and nothing else.
    const needed = new Set<FlowNode>();
    const order: FlowNode[] = [];
    const visit = (placement: FlowNode, index: number): void => {
      const module: Module | undefined = registry[placement.moduleId];
      if (module === undefined) return;
      for (const port of missingRequired(module, store)) {
        const producer = producerOf(current, registry, index, port);
        if (producer === undefined || needed.has(producer)) continue;
        needed.add(producer);
        order.push(producer);
        visit(producer, current.indexOf(producer));
      }
    };
    visit(terminal, terminalIndex);

    if (order.length === 0) break;
    // Transcript order, so a producer runs before the placement that consumes its output.
    order.sort((a, b) => current.indexOf(a) - current.indexOf(b));

    let appended = false;
    for (const placement of order) {
      const id = await runPlacement(current, registry, store, run, placement);
      if (id !== undefined) {
        ran.push(id);
        appended = true;
      }
    }

    // Nothing landed: no further pass can make progress.
    if (!appended) break;
  }

  return ran;
}

/** The terminal's required ports that are absent from the store right now. */
function missingRequired(module: Module, store: Store): PortKey[] {
  return requiredPorts(module).filter((port) => store.data[port] === undefined);
}

/** The latest placement strictly before `beforeIndex` whose module declares `port` writable. */
function producerOf(
  current: Flow,
  registry: ModuleRegistry,
  beforeIndex: number,
  port: PortKey,
): FlowNode | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const module: Module | undefined = registry[current[index].moduleId];
    if (module?.params.some((param) => param.port === port)) return current[index];
  }
  return undefined;
}

/** The index of the latest placement matching this name — its stable name (§2) or its module id. */
function findTerminal(current: Flow, name: string): number {
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const node = current[index];
    if (node.moduleId === name || nodeName(node) === name) return index;
  }
  return -1;
}
