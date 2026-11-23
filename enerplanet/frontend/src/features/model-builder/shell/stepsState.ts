/**
 * The steps panel's state — the whole workflow, in order.
 *
 * The panel asks a different question from the bar: not "where am I" but "what is the state of every step",
 * which is why it derives its own answer instead of reading the bar's wider. Everything comes from
 * `positionReport` — done / stale / pending per node, plus what a node wrote that is gone and which required
 * ports are missing *right now* — with one addition of its own: which node the session is **looking at**,
 * because the panel marks it and `positionReport` has no reason to know.
 *
 * **A view is not a commit** (§4). The session keeps the viewed placement as state; moving merely selects
 * another placement to look at and writes nothing. So the viewed node is passed in (`view`) rather than read
 * from the log, and it defaults to the frontier — the first node that is not done (`position()`).
 *
 * `blocked` and `pruned` are carried through deliberately. They are the *reason* behind a step that is not
 * done, and a panel that showed only the colour would tell the user something is wrong without saying what.
 */

import type { PortKey } from "@model-builder/core";
import type { Flow, ModuleRegistry } from "../core/flow";
import { position, positionReport, type DerivedState } from "../core/position";
import type { Store } from "../core/store";

export interface StepRow {
  nodeId: string;
  moduleId: string;
  /** The step's label, or its module id when the definition gave it none. */
  label: string;
  state: DerivedState;
  /**
   * The node the session is looking at — the `view` when one is set, the frontier otherwise. False for
   * every step once the flow is complete and no view is set.
   */
  current: boolean;
  /**
   * A click here can **move** the view, so this step is a control.
   *
   * `index <= at.index` — the frontier is **inclusive**: at.index is the first node that is not done, and
   * movement may go as far as it, because past it the values would be read across a broken link. The viewed
   * step itself is excluded, since clicking it would move nowhere.
   */
  movable: boolean;
  /** Ports this step wrote that are gone — why it reads stale. */
  pruned: readonly PortKey[];
  /** Required ports absent from the store right now — why it cannot run where it sits. */
  blocked: readonly PortKey[];
}

export function stepsState(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  view?: string,
): StepRow[] {
  const at = position(flow, registry, store);
  const viewed = viewIndex(flow, view) ?? (at.complete ? undefined : at.index);

  return positionReport(flow, registry, store).map((entry, index) => ({
    nodeId: entry.nodeId,
    moduleId: entry.moduleId,
    label: flow[index].label ?? entry.moduleId,
    state: entry.state,
    current: viewed !== undefined && index === viewed,
    // The frontier is reachable and the viewed step is not (see `movable`); past the frontier the values
    // would be read across a broken link, so those steps are not controls.
    movable: index <= at.index && index !== viewed,
    pruned: entry.pruned,
    blocked: entry.blocked,
  }));
}

/**
 * The index of the viewed placement, or `undefined` when no view is set or it names nothing in this flow.
 * A caller that wants the frontier when there is no view adds it (see `stepsState`).
 */
function viewIndex(flow: Flow, view: string | undefined): number | undefined {
  if (view === undefined) return undefined;
  const index = flow.findIndex((node) => node.id === view);
  return index >= 0 ? index : undefined;
}
