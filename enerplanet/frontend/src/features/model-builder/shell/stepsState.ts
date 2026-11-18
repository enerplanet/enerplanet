/**
 * The steps panel's state — the whole workflow, in order.
 *
 * The panel asks a different question from the bar: not "where am I" but "what is the state of every step",
 * which is why it derives its own answer instead of reading the bar's wider. Everything comes from
 * `positionReport` — done / stale / pending per node, plus what a node wrote that is gone and which required
 * ports are missing *right now* — with one addition of its own: which node the session sits on, because the
 * panel marks it and `positionReport` has no reason to know.
 *
 * `blocked` and `pruned` are carried through deliberately. They are the *reason* behind a step that is not
 * done, and a panel that showed only the colour would tell the user something is wrong without saying what.
 *
 * Note the difference from the bar on a finished flow: there is no current step, so nothing is marked, where
 * the bar names the last step so it has something to show. Both are right for their question.
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
   * The node the session sits on — `position()`'s resting place, which is the jump's target after a move and
   * the frontier otherwise. False for every step once the flow is complete with no move outstanding.
   */
  current: boolean;
  /**
   * A click here can **move** the session, so this step is a control.
   *
   * `index <= at.index` — the frontier is **inclusive**, which is the whole point: `at.index` is the first node
   * that is not done, and `moveToNode` allows a target *up to and including* it. So the reachable set is every
   * step from the start to the frontier. In the worked case — the session resting on B after editing it, D and
   * F invalidated by that edit — the frontier is D, and this offers A, C and D while refusing E and F, because
   * past D the values are reading across a broken link.
   *
   * The resting step itself is excluded. It is where the session already is, so clicking it would seal a jump
   * that moves nothing; the bar's rule is that a step is a control only when clicking it can move the session.
   */
  movable: boolean;
  /** Ports this step wrote that are gone — why it reads stale. */
  pruned: readonly PortKey[];
  /** Required ports absent from the store right now — why it cannot run where it sits. */
  blocked: readonly PortKey[];
}

export function stepsState(flow: Flow, registry: ModuleRegistry, store: Store): StepRow[] {
  const at = position(flow, registry, store);

  return positionReport(flow, registry, store).map((entry, index) => ({
    nodeId: entry.nodeId,
    moduleId: entry.moduleId,
    label: flow[index].label ?? entry.moduleId,
    state: entry.state,
    // The session's resting place, not `at.index`: a move is a pure position move, so after a jump the
    // session sits on the target — which stays `done` — while the frontier can be *ahead* of it. When the flow
    // is complete and no jump is current, `restingIndex` is undefined and no step is current.
    current: at.restingIndex !== undefined && index === at.restingIndex,
    // The frontier is reachable; a later step is not (see `movable`). The resting step is excluded because a
    // click there would move nothing.
    movable: index <= at.index && index !== at.restingIndex,
    pruned: entry.pruned,
    blocked: entry.blocked,
  }));
}
