/**
 * The Loader (`Plan.md` §9) — opening a session from the backend.
 *
 * Loading is the mirror of the save: the artefact comes back from its own call, `fromArtefact`
 * rebuilds the session **without replaying** (the stored projection is adopted and its fingerprint
 * checked; replay is only the recovery path), and the flow is then **reattached by reference** — the
 * caller looks the flow up from `workflowId`/`workflowVersion` rather than the artefact carrying a
 * copy of it. Node states and the position re-derive from `(projection, log, cursor)` exactly as they
 * do live, which is what T18 asks for and why this returns them rather than leaving them to the caller
 * to remember.
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
  /** The flow, reattached by reference after the load — never copied from the artefact. */
  flow: Flow;
  registry: ModuleRegistry;
}

export async function loadSession(request: LoadRequest): Promise<LoadOutcome> {
  const artefact = await request.gateway.loadSession(request.modelId);
  if (artefact === undefined) return { kind: "none" };

  const { store, divergence } = fromArtefact(artefact);

  return {
    kind: "session",
    session: {
      store,
      ...(divergence === undefined ? {} : { divergence }),
      position: position(request.flow, request.registry, store),
      states: nodeStates(request.flow, request.registry, store),
    },
  };
}
