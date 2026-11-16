/**
 * The bar's actions (`spec/frame.md` §3.1, §6; `spec/core.md` §G).
 *
 * §3.1 is explicit that every control maps onto an operation the core already has — "*the bar only has to call
 * them*" — so this module is deliberately thin. It exists for the two places where "just call it" is not enough:
 *
 * - **Module movement is a position move, not an undo** (`spec/core.md` §G, which supersedes the earlier
 *   "module movement is undo/redo" framing). A move seals a `jump` transaction with an **empty cascade**: it
 *   rests the session on its target (T20a) and **discards nothing**. The preview prune a jump once
 *   carried goes with it — with nothing discarded there is nothing to preview, so the zero-diff jump is the
 *   ordinary case rather than the one documented exception. It is a `jump` and not the store's `undo` because
 *   undo leaves a redo tail: a move that produced one would make "step back to look at something" mutate the
 *   session, when the whole point is that it must not.
 * - **The bar's save is always `incomplete` (§6).** The *full* save — the real `model.json`, promoted to
 *   `draft` so that a run accepts it — belongs to the save **node**, behind its completeness gate. A bar button
 *   that wrote a finished model on a complete flow would be bypassing that gate, which is why the status is
 *   pinned here instead of derived from completeness.
 */

import type { Flow, ModuleRegistry } from "../core/flow";
import { position } from "../core/position";
import { isAutoModule } from "../core/module";
import type { Engine } from "../core/engine";
import type { Store } from "../core/store";
import { currentId } from "../core/rerun";
import { JumpNotBackwards } from "../core/errors";
import type { Transaction } from "../core/diff";
import type { WorkflowRef } from "../core/artefact";
import { saveModel, type SaveOutcome } from "../save/saveModel";
import type { ModelGateway } from "../save/gateway";

/**
 * Move the session back to an earlier node: a **pure position move** (`spec/core.md` §G) — a `jump`
 * transaction with an empty cascade, resting the session on its target and discarding nothing.
 *
 * The empty cascade is the whole point. A move is not a change: it must not prune a single port, however far
 * downstream, or a navigation that altered nothing would force the tail to re-run. Nothing a move does makes a
 * node stale — the target stays `done`, and the session only *rests* on it (`position.ts`), which is what lets
 * a user look at a node they have no intention of changing. What goes stale is decided by *influence* (T7),
 * when a node actually runs — never by how far the bar moved. The worked case: in
 * `A → B → C → D`, changing A makes B and D stale while **C is untouched**, because the closure reaches C's
 * ports through nothing.
 *
 * It never moves *forward*: a later node is reached by **running** it, which is what `Continue` does, so a
 * target ahead of the session is refused — the same rule the core's `jumpTo` states, for the same reason. The
 * bar only ever offers targets that are behind.
 *
 * @returns the sealed jump, so a caller can see the move and everything it discarded — which is nothing.
 */
export function moveToNode(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  targetId: string,
): Transaction {
  const index = flow.findIndex((node) => node.id === targetId);
  if (index < 0) throw new Error(`[model-builder] no node "${targetId}" in this flow`);
  if (index > position(flow, registry, store).index) throw new JumpNotBackwards(targetId);

  const targetModule = registry[flow[index].moduleId];
  return store.applyTransaction([], [], {
    node: {
      id: targetId,
      ...(targetModule !== undefined && isAutoModule(targetModule) ? { auto: true } : {}),
    },
    kind: "jump",
    jump: { from: currentId(flow, registry, store) ?? targetId, to: targetId },
  });
}

/**
 * Walk forward one interactive step: run the node the session sits on, and keep going while the flow lands on
 * an `auto` node.
 *
 * **Superseded by the auto-run on arrival (T15, rewritten).** An auto node no longer waits to be started by a
 * forward action: `autoRun.ts` runs it the moment the session lands on it, and the position advances by itself
 * once the run lands a finished node. So this walk is no longer "the thing that starts an auto node's work",
 * and **nothing in the frame calls it any more** — the bar's `Continue` is gone, and an interactive module
 * advances by running itself (its own `Apply`). It is kept as the plain "one interactive step" utility a host
 * could still drive, and it stays correct: a node already `done` is passed over, and it stops *after* an
 * interactive node because that is the next place a user can act.
 *
 * It never moves backwards, and the loop is bounded by the flow's length so a malformed flow cannot spin.
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

    await engine.runModule(module, { id: node.id, ...(isAutoModule(module) ? { auto: true } : {}) });
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
