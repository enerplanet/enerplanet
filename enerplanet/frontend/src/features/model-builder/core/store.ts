/**
 * The store — the current model projection plus the append-only commit log.
 *
 * It holds `data` and the `log`. Three mutators reach the projection — sealing
 * (`applyTransaction`), `undo`, `redo` — and all three end at the `install` chokepoint, which
 * also notifies listeners. Nothing else can change the projection.
 */

import {
  applyDiffs,
  invertDiffs,
  type DiffOp,
  type Transaction,
} from "./diff";
import { ReentrantStoreWrite } from "./errors";
import type { NodeRef } from "./module";
import type { ModelData } from "./ports";

/** Everything a seal carries beyond its diff. */
export interface SealOptions {
  /** The placement this commit belongs to; absent on a rollback. */
  node?: NodeRef;
  /** Marks this a rollback commit — the revision it inverts. */
  rollback?: { of: number };
}

export interface StoreOptions {
  /** Invalidation seam, consulted at seal when the cascade is omitted. Defaults to invalidating nothing. */
  deriveCascade?: (primary: readonly DiffOp[], data: Readonly<ModelData>) => DiffOp[];
  /** Open an existing session from a projection and its log, taken on faith — the artefact fast path. */
  restore?: {
    projection: ModelData;
    log: readonly Transaction[];
  };
}

export interface Store {
  /** The projection the session started from — the base `replay()` needs. */
  readonly initial: Readonly<ModelData>;
  /** Current projection. Read-only to everyone; rebuild it instead of mutating it. */
  readonly data: Readonly<ModelData>;
  /** Every sealed commit, oldest first. Never rewritten — not even by undo. */
  readonly log: readonly Transaction[];
  /** Whether any forward commit is currently revertible. Auto work is a target like any other. */
  readonly canUndo: boolean;
  /** Whether a redo is available — true only while the session is off the tip. */
  readonly canRedo: boolean;
  /** A change token: it increments on every applied change; hosts subscribe to this, not `data`. */
  readonly version: number;
  /** Register a listener called after every applied change; returns the unsubscribe. Listeners must never write. */
  subscribe(listener: () => void): () => void;
  /** Seal a commit: apply it to the projection and append it to the log at the tip. */
  applyTransaction(
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    options?: SealOptions,
  ): Transaction;
  /**
   * Resolve the model to the state before the newest revertible commit, by appending a rollback.
   *
   * @returns the rollback commit it sealed, or `undefined` when there is nothing to undo.
   */
  undo(): Transaction | undefined;
  /** Re-apply the newest undone run by appending the inverse of a rollback. */
  redo(): Transaction | undefined;
}

export function createStore(initial: ModelData = {}, options: StoreOptions = {}): Store {
  const deriveCascade = options.deriveCascade ?? ((): DiffOp[] => []);
  const restore = options.restore;
  let data: ModelData = restore === undefined ? initial : restore.projection;
  const log: Transaction[] = restore === undefined ? [] : [...restore.log];

  const listeners = new Set<() => void>();
  let version = 0;
  let notifying = false;

  /** The one place the applied projection moves; `data` is assigned nowhere else. */
  const install = (nextData: ModelData): void => {
    // Notification is not re-entry — and the guard comes first, so a refused write changes nothing.
    if (notifying) throw new ReentrantStoreWrite();

    data = nextData;
    version += 1;

    notifying = true;
    try {
      // Over a copy: a listener may subscribe or unsubscribe while it runs.
      for (const listener of [...listeners]) listener();
    } finally {
      // Reset even when a listener threw.
      notifying = false;
    }
  };

  /** Is the commit at zero-based `index` a forward step — a run, or a rollback *of* a backward commit? */
  const isForward = (index: number): boolean => {
    const commit = log[index];
    if (commit.rollback === undefined) return true;
    // A rollback reverses its target: undoing a forward commit steps back, undoing a redo steps forward.
    return !isForward(commit.rollback.of - 1);
  };

  /** Has the commit at 1-based `revision` already been reverted — does some commit roll it back? */
  const isReverted = (revision: number): boolean =>
    log.some((commit) => commit.rollback?.of === revision);

  /** Index (0-based) of the newest commit carrying a placement, or `-1` when there is none. */
  const tipIndex = (): number => {
    for (let index = log.length - 1; index >= 0; index -= 1) {
      if (log[index].node !== undefined) return index;
    }
    return -1;
  };

  /** The revision a redo should reverse: a backward rollback no later commit re-applied, with no placement commit after it. */
  const redoTarget = (): number | undefined => {
    const tip = tipIndex();
    for (let revision = log.length; revision >= 1; revision -= 1) {
      if (isForward(revision - 1)) continue;
      if (isReverted(revision)) continue;
      if (revision <= tip) continue;
      return revision;
    }
    return undefined;
  };

  const applyTransaction = (
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    seal: SealOptions = {},
  ): Transaction => {
    const revision = log.length + 1;

    let nextData = data;
    if (primary.length > 0) nextData = applyDiffs(nextData, primary);

    // Omitted ⇒ derive from the invalidator. Passed ⇒ use as given: `[]` discards nothing.
    const pruned = cascade ?? deriveCascade(primary, nextData);
    if (pruned.length > 0) nextData = applyDiffs(nextData, pruned);

    const { node, rollback } = seal;
    const transaction: Transaction = Object.freeze({
      revision,
      primary: Object.freeze([...primary]),
      cascade: Object.freeze([...pruned]),
      ...(node === undefined ? {} : { node: Object.freeze({ ...node }) }),
      ...(node?.auto === true ? { auto: true } : {}),
      ...(rollback === undefined ? {} : { rollback: Object.freeze({ ...rollback }) }),
    });

    log.push(transaction);
    install(nextData);
    return transaction;
  };

  /** Seal the inverse of the commit at 1-based `revision` as a rollback of it. */
  const rollbackCommit = (revision: number): Transaction => {
    const target = log[revision - 1];
    // One combined inverse, reverse-ordered: the cascade is undone before the primary change.
    return applyTransaction(invertDiffs([...target.primary, ...target.cascade]), [], {
      rollback: { of: revision },
    });
  };

  return {
    get initial(): Readonly<ModelData> {
      return initial;
    },

    get data(): Readonly<ModelData> {
      return data;
    },

    get log(): readonly Transaction[] {
      return log;
    },

    get canUndo(): boolean {
      // Any forward commit no later commit rolled back; a redo is revertible too, so undo/redo stay symmetric.
      return log.some((_commit, index) => isForward(index) && !isReverted(index + 1));
    },

    get canRedo(): boolean {
      // Redo is available only **off the tip** (see `redoTarget`).
      return redoTarget() !== undefined;
    },

    get version(): number {
      return version;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    applyTransaction,

    undo(): Transaction | undefined {
      // The newest forward commit that is not already reverted.
      for (let revision = log.length; revision >= 1; revision -= 1) {
        if (!isForward(revision - 1)) continue;
        if (isReverted(revision)) continue;
        return rollbackCommit(revision);
      }
      return undefined;
    },

    redo(): Transaction | undefined {
      const target = redoTarget();
      return target === undefined ? undefined : rollbackCommit(target);
    },
  };
}
