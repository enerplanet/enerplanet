/**
 * The loader — opening a session from the backend: the artefact comes back from its own call and
 * `fromArtefact` rebuilds the session, without replaying, returning the placed flow it carried.
 */

import { fromArtefact, type Divergence } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { nodeStates, position, type DerivedState, type Position } from "../core/position";
import type { Store } from "../core/store";
import type { ModelGateway } from "../save/gateway";

export interface LoadedSession {
  store: Store;
  /** The placed flow the artefact carried — the store itself does not hold it. */
  flow: Flow;
  /** Set when the stored projection disagreed with its fingerprint and the log was replayed. */
  divergence?: Divergence;
  /** Where the session sits in its flow, re-derived from the log. */
  position: Position;
  states: Record<string, DerivedState>;
}

export type LoadOutcome =
  | { kind: "session"; session: LoadedSession }
  /** The model exists but has no session — a legacy model, or one never saved from the builder. */
  | { kind: "none" };

export interface LoadRequest {
  gateway: ModelGateway;
  modelId: number;
  /** The registry the states and position are re-derived with; the flow itself comes from the artefact. */
  registry: ModuleRegistry;
}

export async function loadSession(request: LoadRequest): Promise<LoadOutcome> {
  const artefact = await request.gateway.loadSession(request.modelId);
  if (artefact === undefined) return { kind: "none" };

  const { store, flow, divergence } = fromArtefact(artefact);

  return {
    kind: "session",
    session: {
      store,
      flow,
      ...(divergence === undefined ? {} : { divergence }),
      position: position(flow, request.registry, store),
      states: nodeStates(flow, request.registry, store),
    },
  };
}
