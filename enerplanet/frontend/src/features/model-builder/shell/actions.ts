/**
 * The bar's actions: the bar's save, and the plain "one interactive step" utility.
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
 * @returns the placement ids it ran, in order.
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

    // An automatic module is not a place anyone can act, so keep walking past it.
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

/** The workflow bar's save: Call A (the legacy payload) then Call B (the session artefact), status `incomplete`. */
export async function saveSession(
  gateway: ModelGateway,
  request: SessionSaveRequest,
): Promise<SaveOutcome> {
  return saveModel(gateway, { ...request, status: "incomplete" });
}
