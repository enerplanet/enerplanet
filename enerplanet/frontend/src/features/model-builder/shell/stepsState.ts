/**
 * The steps panel's state — the whole workflow, in order (`spec/frame.md` §3.3).
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
  /** The node the session sits on. False for every step once the flow is complete. */
  current: boolean;
  /**
   * This step is behind the session, so a click can **move** to it.
   *
   * Strictly `< at.index`, which is the bar's rule and the core's: `moveToNode` refuses a target ahead of the
   * session (`JumpNotBackwards`), because a later node is reached by *running* it, not by standing on it. A
   * panel that offered a forward click would be offering something the core will not do.
   *
   * On a **complete** flow `at.index` is `flow.length`, so every step is behind and every step can be
   * returned to — which is the whole point of a complete flow: you go back to change something.
   */
  behind: boolean;
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
    // Not simply "index === at.index": a complete flow has no current step at all. The guarantee actually
    // comes from `position()`, which reports `index = flow.length` when the flow is complete — so this guard
    // is redundant today and stays as intent. A mutation removing it leaves every case green, which is
    // recorded rather than hidden.
    current: !at.complete && index === at.index,
    behind: index < at.index,
    pruned: entry.pruned,
    blocked: entry.blocked,
  }));
}
