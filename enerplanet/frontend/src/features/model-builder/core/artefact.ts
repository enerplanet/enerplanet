/**
 * The artefact — what persists a session: the projection, the log it came from, and the placed flow.
 */

import type { Transaction } from "./diff";
import { fingerprint } from "./fingerprint";
import type { Flow, FlowNode } from "./flow";
import type { ModelData } from "./ports";
import { replay } from "./replay";
import { createStore, type Store } from "./store";

/** The artefact shape this build writes and reads. */
export const ARTEFACT_VERSION = 1;

/** A reference to the workflow, never a copy. */
export interface WorkflowRef {
  id: string;
  version: number;
}

export interface Artefact {
  version: number;
  workflow: WorkflowRef;
  /** The model this session is saved as, once it has one. */
  modelId?: number;
  /** The projection the session started from — what the recovery path replays onto. */
  initial: ModelData;
  /** The projection at the tip: the fast path. */
  projection: ModelData;
  /** The placed flow — the seed placements, plus appends, to-run nodes included. */
  flow: FlowNode[];
  /** The full, append-only log. */
  log: Transaction[];
  /** Fingerprint of `projection`, checkable without replaying anything. */
  fingerprint: string;
}

/** Why a load replayed instead of trusting what was stored. */
export interface Divergence {
  /** What the artefact claimed the projection hashes to. */
  stored: string;
  /** What the stored projection actually hashes to. */
  projection: string;
  /** What the log replays to — the value the loader used. */
  recovered: string;
}

export interface LoadResult {
  store: Store;
  /** The placed flow the artefact carried — the store itself does not hold it. */
  flow: Flow;
  /** Set only when the fingerprint disagreed, i.e. when the log had to be replayed. */
  divergence?: Divergence;
}

/** Snapshot a live session into an artefact. */
export function toArtefact(session: {
  store: Store;
  workflow: WorkflowRef;
  flow: Flow;
  modelId?: number;
}): Artefact {
  const { store, workflow, flow, modelId } = session;
  const projection = clone(store.data);

  return {
    version: ARTEFACT_VERSION,
    workflow: { ...workflow },
    ...(modelId === undefined ? {} : { modelId }),
    initial: clone(store.initial),
    projection,
    flow: flow.map((node) => ({ ...node })),
    log: store.log.map(copy),
    fingerprint: fingerprint(projection),
  };
}

/** The recovery path: rebuild the projection from the log, ignoring what was stored. */
export function replayArtefact(artefact: Artefact): ModelData {
  return replay(artefact.initial, artefact.log, artefact.log.length);
}

/**
 * Open a session from an artefact: the stored projection unless its fingerprint disagrees, in
 * which case the log is replayed and the divergence reported.
 */
export function fromArtefact(artefact: Artefact): LoadResult {
  if (artefact.version !== ARTEFACT_VERSION) {
    throw new Error(
      `[model-builder] artefact version ${artefact.version} is not supported (this build reads ${ARTEFACT_VERSION})`,
    );
  }

  const log = artefact.log.map(copy);
  const stored = artefact.fingerprint;
  const actual = fingerprint(artefact.projection);

  if (stored === actual) {
    return { store: restoreStore(artefact, log, artefact.projection), flow: artefact.flow };
  }

  const recovered = replayArtefact(artefact);
  return {
    store: restoreStore(artefact, log, recovered),
    flow: artefact.flow,
    divergence: { stored, projection: actual, recovered: fingerprint(recovered) },
  };
}

function restoreStore(artefact: Artefact, log: Transaction[], projection: ModelData): Store {
  return createStore(clone(artefact.initial), {
    restore: { projection, log },
  });
}

/** Fresh containers over the immutable ops inside, so serialising never deep-copies a diff. */
function copy(transaction: Transaction): Transaction {
  return { ...transaction, primary: [...transaction.primary], cascade: [...transaction.cascade] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
