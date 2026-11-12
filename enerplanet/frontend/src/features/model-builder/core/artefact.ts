/**
 * The artefact — what persists a session (`Plan.md` §9, case T18).
 *
 * A session is `(projection, log, cursor)`. Persisting it naively would mean replaying the log on
 * every load; persisting it as the projection alone would mean losing undo and redo. So the
 * artefact carries **both**: the projection at the cursor, and the log it came from. The loader
 * trusts the projection for speed and uses the log as the recovery path, and the fingerprint in
 * between is what stops the two from lying to each other silently.
 *
 * The **flow is not in here**. It is immutable, so a session refers to it by `{ id, version }` and
 * the artefact holds a reference; the loader reattaches it, and node states and the position
 * re-derive from the log as they always do. Jumps need no separate list either — a jump is a
 * transaction like any other (`kind: "jump"`), so it is already in the log.
 *
 * What the fingerprint does **not** cover is the log itself. The log is the source of truth and the
 * projection is the cache, so hashing the log would verify nothing that would change what the
 * loader does: a corrupted log is what `replayArtefact` exists to be called on deliberately.
 */

import type { Transaction } from "./diff";
import { fingerprint } from "./fingerprint";
import type { ModelData } from "./ports";
import { replay } from "./replay";
import { createStore, type Store } from "./store";

/** The artefact shape this build writes and reads. */
export const ARTEFACT_VERSION = 1;

/** A reference to the workflow, never a copy — the flow is immutable and shared. */
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
  /** The projection at the cursor: the fast path. */
  projection: ModelData;
  /** The applied prefix, revisions `1..cursor`. */
  log: Transaction[];
  /** The redo tail, revisions `cursor+1..`. Empty when the session sits at its tip. */
  discarded: Transaction[];
  cursor: number;
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
  /** Set only when the fingerprint disagreed, i.e. when the log had to be replayed. */
  divergence?: Divergence;
}

/** Snapshot a live session. */
export function toArtefact(session: {
  store: Store;
  workflow: WorkflowRef;
  modelId?: number;
}): Artefact {
  const { store, workflow, modelId } = session;
  const projection = clone(store.data);

  return {
    version: ARTEFACT_VERSION,
    workflow: { ...workflow },
    ...(modelId === undefined ? {} : { modelId }),
    initial: clone(store.initial),
    projection,
    log: store.log.slice(0, store.cursor).map(copy),
    discarded: store.log.slice(store.cursor).map(copy),
    cursor: store.cursor,
    fingerprint: fingerprint(projection),
  };
}

/** The recovery path: rebuild the projection from the log, ignoring what was stored. */
export function replayArtefact(artefact: Artefact): ModelData {
  return replay(artefact.initial, fullLog(artefact), artefact.cursor);
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

  const log = fullLog(artefact);
  if (artefact.cursor < 0 || artefact.cursor > log.length) {
    throw new Error(
      `[model-builder] artefact cursor ${artefact.cursor} is outside its log (${log.length} transactions)`,
    );
  }

  const stored = artefact.fingerprint;
  const actual = fingerprint(artefact.projection);

  if (stored === actual) {
    return { store: restoreStore(artefact, log, artefact.projection) };
  }

  const recovered = replayArtefact(artefact);
  return {
    store: restoreStore(artefact, log, recovered),
    divergence: { stored, projection: actual, recovered: fingerprint(recovered) },
  };
}

function fullLog(artefact: Artefact): Transaction[] {
  return [...artefact.log, ...artefact.discarded];
}

function restoreStore(artefact: Artefact, log: Transaction[], projection: ModelData): Store {
  return createStore(clone(artefact.initial), {
    restore: { projection, log, cursor: artefact.cursor },
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
