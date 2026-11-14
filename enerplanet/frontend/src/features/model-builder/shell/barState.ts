/**
 * The workflow bar's state — where the session is (`spec/frame.md` §3.1).
 *
 * The bar answers one question and the answer is *derived* from `(flow, registry, store)`. Nothing stores
 * a position, which is what makes undo, redo and jumps reposition the bar for free:
 *
 *   prior    the node before the position — always done, because the position is the first node that is not
 *   current  the node the session sits on
 *   next     the node after it
 *
 * Once the flow has finished there is no "first node that is not done", so the session sits on the **last**
 * node (the same rule `currentId` uses) and the bar keeps naming it rather than going blank the moment the
 * model is complete. That is also why this is not the same question the steps panel asks: the panel wants
 * every step's state, the bar wants the three that frame the session.
 *
 * Each step carries its derived state, so a node the session jumped back to reads `stale` — the re-arm
 * made visible, which is the only warning the user gets that something has to run again.
 */

import type { Flow, FlowNode, ModuleRegistry } from "../core/flow";
import { position, positionReport, type DerivedState, type NodePosition } from "../core/position";
import type { Store } from "../core/store";

export interface BarStep {
  id: string;
  /** The node's label, or its module id when the definition gave it none. */
  label: string;
  state: DerivedState;
}

export interface BarState {
  prior?: BarStep;
  current?: BarStep;
  next?: BarStep;
  /** The core's reading of the flow position, passed through rather than re-derived. */
  complete: boolean;
}

export function barState(flow: Flow, registry: ModuleRegistry, store: Store): BarState {
  const report = positionReport(flow, registry, store);
  const at = position(flow, registry, store);

  // Complete (or an empty flow): the session sits on the last node, so name that one.
  const index = at.complete ? flow.length - 1 : at.index;

  const prior = stepAt(flow, report, index - 1);
  const current = stepAt(flow, report, index);
  const next = stepAt(flow, report, index + 1);

  return {
    ...(prior === undefined ? {} : { prior }),
    ...(current === undefined ? {} : { current }),
    ...(next === undefined ? {} : { next }),
    complete: at.complete,
  };
}

/** The step at `index`, or nothing when the flow has no node there (a position at either end). */
function stepAt(flow: Flow, report: readonly NodePosition[], index: number): BarStep | undefined {
  const node: FlowNode | undefined = flow[index];
  const entry: NodePosition | undefined = report[index];
  if (node === undefined || entry === undefined) return undefined;

  return { id: node.id, label: node.label ?? node.moduleId, state: entry.state };
}
