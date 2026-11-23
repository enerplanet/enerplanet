/**
 * The Loader — opening a session from the backend.
 *
 * Loading is the mirror of the save: the artefact comes back from its own call, `fromArtefact` rebuilds the
 * session **without replaying** (the stored projection is adopted and its fingerprint checked; replay is only
 * the recovery path), and it returns the **placed flow** the artefact carried (§3.1) — the flow is a stored
 * fact now, not reconstructed from the plan. Node states and the position re-derive from
 * `(flow, projection, log)` exactly as they do live, which is why this returns them rather than leaving them to
 * the caller to remember.
 *
 * A model with **no session** is a normal answer, not an error: every legacy model is in that state,
 * as is a builder model that has never been saved. What to do about that is deliberately left to the
 * caller — adopting a legacy model's `config` into a builder session is a capability decision (it
 * needs the inverse of the save payload mapping), not something the loader should assume.
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
