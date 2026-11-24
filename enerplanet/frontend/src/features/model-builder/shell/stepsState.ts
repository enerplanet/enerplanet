/**
 * The steps panel's state — the whole workflow, in order.
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
  /** The node the session is looking at — the `view` when set, the frontier otherwise. */
  current: boolean;
  /** Whether a click here can move the view — at or before the frontier, and not the viewed step itself. */
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
    // The frontier is reachable and the viewed step is not; those steps are not controls.
    movable: index <= at.index && index !== viewed,
    pruned: entry.pruned,
    blocked: entry.blocked,
  }));
}

/** The index of the viewed placement, or `undefined` when no view is set or it names nothing in this flow. */
function viewIndex(flow: Flow, view: string | undefined): number | undefined {
  if (view === undefined) return undefined;
  const index = flow.findIndex((node) => node.id === view);
  return index >= 0 ? index : undefined;
}
