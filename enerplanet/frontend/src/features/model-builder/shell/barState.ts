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
 * Where the session sits is `position()`'s `restingIndex`, not its `index`: a move is a **pure position
 * move** (`spec/core.md` §G), so a node the session jumped back to stays `done` and the frontier can be
 * ahead of the session — `index` is the frontier, `restingIndex` is the jump's target.
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

export function barState(flow: Flow, registry: ModuleRegistry, store: Store, hold?: string): BarState {
  const report = positionReport(flow, registry, store);
  const at = position(flow, registry, store);

  // Where the session sits: the jump's target when a move put it there, else the frontier — and when the flow
  // is complete with no jump current, the last node, so the bar keeps naming what is on screen.
  const derived = at.restingIndex ?? flow.length - 1;
  // A held node wins, so the bar cannot name a node the frame is not showing: the frame holds the view on a node
  // whose run is still landing, and the two deriving their own answer would disagree while that happens.
  const held = hold === undefined ? -1 : flow.findIndex((node) => node.id === hold);
  const index = held === -1 ? derived : held;

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
