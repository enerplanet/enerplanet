/**
 * The workflow bar's state — where the session is.
 *
 * The bar answers one question and the answer is *derived* from `(flow, registry, store)`:
 *
 *   prior    the node before the session — always done, because the session is the first node that is not
 *   current  the node the session is looking at
 *   next     the node after it
 *
 * Once the flow has finished there is no "first node that is not done", so the bar sits on the **last** node
 * (so it keeps naming what is on screen rather than going blank the moment the model is complete). That is
 * also why this is not the same question the steps panel asks: the panel wants every step's state, the bar
 * wants the three that frame the session.
 *
 * **A view is not a commit** (§4). Where the session *rests* is a read-only selection — the viewed placement
 * — passed in as `view`; absent, it is the frontier (`position()`). A move writes nothing, so the frontier
 * (`complete`) is unaffected by where the session is looking.
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

export function barState(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  view?: string,
): BarState {
  const report = positionReport(flow, registry, store);
  const at = position(flow, registry, store);

  // Where the session is looking: the viewed placement when one is set, else the frontier — and when the
  // flow is complete with no view, the last node, so the bar keeps naming what is on screen.
  const derived = at.complete ? flow.length - 1 : at.index;
  const held = view === undefined ? -1 : flow.findIndex((node) => node.id === view);
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
