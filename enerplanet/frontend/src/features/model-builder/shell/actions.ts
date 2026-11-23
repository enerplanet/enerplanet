/**
 * The bar's actions.
 *
 * Every control maps onto an operation the core already has — "*the bar only has to call
 * them*" — so this module is deliberately thin. It exists for the two places where "just call it" is not enough:
 *
 * - **Movement is a view, not a commit** (§4). A move sets the viewed placement in the shell's session state
 *   and writes **nothing**: there is no `jump` transaction, no discard preview, and no redo tail (undo/redo
 *   are rollback commits, `core/store.ts`). The shell owns the view and the bar/steps panel drive it, which is
 *   why there is no `moveToNode` here any more.
 * - **The bar's save is always `incomplete`.** The *full* save — the real `model.json`, promoted to
 *   `draft` so that a run accepts it — belongs to the save **node**, behind its completeness gate. A bar button
 *   that wrote a finished model on a complete flow would be bypassing that gate, which is why the status is
 *   pinned here instead of derived from completeness.
 */

import type { Flow, ModuleRegistry } from "../core/flow";
import { position } from "../core/position";
import { isAutoModule } from "../core/module";
import type { Engine } from "../core/engine";
import type { Store } from "../core/store";
import type { WorkflowRef } from "../core/artefact";
import { saveModel, type SaveOutcome } from "../save/saveModel";
import type { ModelGateway } from "../save/gateway";

/**
 * Walk forward one interactive step: run the node the session sits on, and keep going while the flow lands on
 * an `auto` node.
 *
 * **Superseded by the auto-run on arrival.** An auto node no longer waits to be started by a
 * forward action: `autoRun.ts` runs it the moment the session lands on it, and the position advances by itself
 * once the run lands a finished node. So this walk is no longer "the thing that starts an auto node's work",
 * and **nothing in the frame calls it any more** — the bar's `Continue` is gone, and an interactive module
 * advances by running itself (its own `Apply`). It is kept as the plain "one interactive step" utility a host
 * could still drive, and it stays correct: a node already `done` is passed over, and it stops *after* an
 * interactive node because that is the next place a user can act.
 *
 * It never moves backwards, and the loop is bounded by the flow's length so a malformed flow cannot spin.
 *
 * @returns the placement ids it ran, in order — the shell says what happened rather than guessing.
 */
export async function continueStep(request: {
  flow: Flow;
  registry: ModuleRegistry;
  store: Store;
  engine: Engine;
}): Promise<string[]> {
  const { flow, registry, store, engine } = request;
  const ran: string[] = [];

  for (let guard = 0; guard <= flow.length; guard += 1) {
    const at = position(flow, registry, store);
    if (at.complete) break;

    const node = flow[at.index];
    const module = registry[node.moduleId];
    if (module === undefined) break;

    await engine.runModule(module, {
      id: node.id,
      moduleId: node.moduleId,
      ...(isAutoModule(module) ? { auto: true } : {}),
    });
    ran.push(node.id);

    // An automatic module is not a place anyone can act, so the walk continues past it. An interactive one is.
    if (!isAutoModule(module)) break;
  }

  return ran;
}

export interface SessionSaveRequest {
  store: Store;
  flow: Flow;
  registry: ModuleRegistry;
  /** What the artefact points at instead of copying — the flow is immutable and shared. */
  workflow: WorkflowRef;
  /** Absent on a first save: Call A creates the model, and its id comes back for Call B's foreign key. */
  modelId?: number;
  workspaceId?: number;
  draftId?: string;
  userId?: string;
}

/**
 * The workflow bar's save: Call A (the legacy payload) then Call B (the session artefact), with the status
 * pinned to `incomplete`. A model that is not finished still round-trips, and still preserves its session.
 */
export async function saveSession(
  gateway: ModelGateway,
  request: SessionSaveRequest,
): Promise<SaveOutcome> {
  return saveModel(gateway, { ...request, status: "incomplete" });
}
