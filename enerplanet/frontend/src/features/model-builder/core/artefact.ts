/**
 * The artefact — what persists a session.
 *
 * A session is `(projection, flow, log)`. Persisting it naively would mean replaying the log on
 * every load; persisting it as the projection alone would lose history. So the artefact carries
 * **all three**: the projection, the log it came from, and the **placed flow** (§3.1) — the
 * session's seed placements plus any appended ones, **including the nodes that have not run yet**.
 * The loader trusts the projection for speed and uses the log as the recovery path; the
 * fingerprint in between stops the two from lying to each other silently.
 *
 * **The flow is stored, not derived.** With v2 there is no redo tail and the view is not
 * persisted, so the artefact's `cursor` and `discarded` fall away (§3.1): the row is
 * `{ workflow, initial, projection, flow, log, fingerprint }`. A move writes nothing, so there is
 * nothing for a view cursor to carry, and a re-run appends rather than truncating.
 *
 * What the fingerprint does **not** cover is the log itself. The log is the source of truth and
 * the projection is the cache, so hashing the log would verify nothing that would change what the
 * loader does: a corrupted log is what `replayArtefact` exists to be called on deliberately.
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
  /** The placed flow (§3.1) — the seed placements, plus appends, to-run nodes included. */
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

/**
 * Snapshot a live session.
 *
 * `record` is the caller's own record of the save — the ports the *saver* is about to commit but
 * which the live store does not hold yet (`modelId`, `saveResult`). It is not part of the log: no
 * module transaction produced it, and the saver seals its own commit only after this snapshot is
 * taken. Folding it into the projection here — **before** the fingerprint is taken — is what lets
 * a reload read those ports immediately: the stored fingerprint then matches the stored
 * projection, so `fromArtefact` trusts it rather than replaying the log. The log and `initial` are
 * left alone, because the record was never a commit.
 */
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
 * Open a session from an artefact.
 *
 * The stored projection is used directly — no replay — unless its fingerprint disagrees, in which
 * case the log is replayed and the divergence reported. Nothing is repaired in place: the artefact
 * is data, and a caller that wants to persist the recovered session writes a fresh one.
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

/**
 * Transactions are frozen and immutable, so a snapshot only needs fresh containers — but the
 * ops inside them are shared, so serialising an artefact never deep-copies a diff it cannot change.
 */
function copy(transaction: Transaction): Transaction {
  return { ...transaction, primary: [...transaction.primary], cascade: [...transaction.cascade] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
