/**
 * The bar's actions (`spec/frame.md` §3.1, §6).
 *
 * §3.1 is explicit that every control maps onto an operation the core already has — "*the bar only has to call
 * them*" — so this module is deliberately thin. It exists for the two places where "just call it" is not enough:
 *
 * - **Module movement is undo/redo, not a sealed jump.** The prior step is a *module-wide undo*: it unwinds
 *   every commit the nodes in between own, in one gesture, which leaves the redo tail that the forward step
 *   then walks back to the tip. That round trip is the whole point — you step back to look at something, and
 *   forward puts you exactly where you were. (A `jumpTo` transaction is a different mechanism and is *not* what
 *   the bar moves with; it stays for the deferred any-step jump in `optionals.md`.)
 * - **The bar's save is always `incomplete` (§6).** The *full* save — the real `model.json`, promoted to
 *   `draft` so that a run accepts it — belongs to the save **node**, behind its completeness gate. A bar button
 *   that wrote a finished model on a complete flow would be bypassing that gate, which is why the status is
 *   pinned here instead of derived from completeness.
 */

import type { Flow, ModuleRegistry } from "../core/flow";
import { position } from "../core/position";
import type { Engine } from "../core/engine";
import type { Store } from "../core/store";
import type { WorkflowRef } from "../core/artefact";
import { saveModel, type SaveOutcome } from "../save/saveModel";
import type { ModelGateway } from "../save/gateway";

/** Walk the discard tail to its tip. Returns how many transactions it re-applied (0 when there is no tail). */
export function redoToTip(store: Store): number {
  let walked = 0;
  while (store.canRedo) {
    store.redo();
    walked += 1;
  }
  return walked;
}

/**
 * Walk forward one interactive step: run the node the session sits on, and keep going while the flow lands on
 * an `auto` node.
 *
 * This is the **only forward action there is**, which is what makes it the thing that starts an auto node's
 * work — T15 says an auto node runs as part of a forward action and never on a passive state change, and undo
 * leaves an auto node's outputs pruned precisely because this is what re-runs them.
 *
 * It stops *after* an interactive node, because that is the next place a user can act. It never moves
 * backwards, and the loop is bounded by the flow's length so a malformed flow cannot spin.
 *
 * @returns the node ids it ran, in order — the shell says what happened rather than guessing.
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

    await engine.runModule(module, { id: node.id, ...(node.auto === true ? { auto: true } : {}) });
    ran.push(node.id);

    // An auto node is not a place anyone can act, so the walk continues past it. An interactive one is.
    if (node.auto !== true) break;
  }

  return ran;
}

/**
 * Move the session back to an earlier node by **undoing module-wide** — every commit the nodes in between own,
 * not one atomic step. Returns how many undos it took (0 when the session already sits at or before the
 * target).
 *
 * This is what makes module movement a round trip: the undos leave a redo tail, and `redoToTip` walks that tail
 * back to the tip, so stepping back to look at something costs nothing. It never moves *forward* — a target
 * already behind the session is left alone, and the bar only ever offers targets that are behind.
 */
export function undoToNode(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  targetId: string,
): number {
  const target = flow.findIndex((node) => node.id === targetId);
  if (target < 0) throw new Error(`[model-builder] no node "${targetId}" in this flow`);

  let unwound = 0;
  // The position is "the first node that is not done", so undoing the target's own commits makes the target
  // current again — that is the stopping condition, and `canUndo` bounds it so it can never run off the start.
  while (store.canUndo && position(flow, registry, store).index > target) {
    store.undo();
    unwound += 1;
  }
  return unwound;
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
