/**
 * The store — the current model projection plus the append-only commit log.
 *
 * The store is dumb on purpose: it holds `data` and the `log`. Three mutators reach the
 * projection — sealing (`applyTransaction`), `undo`, `redo` — and all three end at the single
 * `install` chokepoint below, which is also where listeners are told that a change happened.
 * Nothing else can change the projection. It carries no business logic: validation, cascade
 * computation and the commit shapes live above it or are injected (see `StoreOptions.deriveCascade`).
 *
 * **Append-only, with no truncation.** v1 truncated a redo tail when a new edit arrived after an
 * undo; v2 has no tail and no cursor, so `applyTransaction` always appends at the tip. Undo and
 * redo are themselves commits (§4.1, `git revert` shape) — nothing rewrites an entry in place, so
 * a revision always identifies the same entry.
 *
 * The projection is `replay(initial, log, log.length)`: every commit, rollbacks included, is
 * applied in order. Because each mutator applies its own diff incrementally, `data` tracks that
 * replay exactly without re-deriving it.
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
  /** The placement this commit belongs to. Absent on a rollback, which resolves the model, not a placement. */
  node?: NodeRef;
  /** Marks this a rollback commit — the revision it inverts (§4.1). */
  rollback?: { of: number };
}

export interface StoreOptions {
  /**
   * The invalidation seam. Consulted at **seal**, when a caller omits the cascade, so a module's
   * change prunes exactly what it affects.
   *
   * Defaults to "nothing is invalidated" for a store built without a flow around it (the core's
   * own tests, mostly). The frame builds its store with `createInvalidator(flow, registry)`.
   */
  deriveCascade?: (primary: readonly DiffOp[], data: Readonly<ModelData>) => DiffOp[];
  /**
   * Open an existing session instead of a fresh one: the projection together with the log it
   * came from, taken on faith.
   *
   * This is the artefact's **fast path** — the projection is used as given, with no replay, which
   * is what makes a load instant. The store does not check that the projection really is
   * `replay(initial, log, log.length)`; that consistency is the artefact loader's job, and
   * replaying here would defeat the point.
   */
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
  /** Whether any commit is currently revertible (an interactive, un-reverted commit exists). */
  readonly canUndo: boolean;
  /** Whether any rollback commit is currently re-applicable. */
  readonly canRedo: boolean;
  /**
   * A **change token**: it increments on *every* applied change, even one that leaves the projection
   * referentially identical.
   *
   * A host subscribes to this rather than to `data`'s identity. (Not to be confused with a
   * `Transaction.revision`, which is that commit's own sequence number in the log.)
   */
  readonly version: number;
  /**
   * Register a listener called **after every applied change** — a seal, an undo, a redo — with the
   * new projection already in place. Returns the unsubscribe.
   *
   * This exists at the `install` chokepoint rather than on the transaction path: undo and redo
   * append a rollback commit, and the listener must hear about the resolution exactly as it hears
   * about any other change.
   *
   * A listener re-reads; it must never write.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Seal a commit: apply it to the projection and append it to the log, at the tip.
   *
   * **Omitting `cascade` derives it** through the invalidator seam below — that is how a change's
   * consequences are pruned. **Passing one uses it as given**, including `[]`.
   *
   * This is the engine's write path — modules reach the store only through a `ModuleCtx` — and
   * also undo/redo's, which pass an inverse diff and a `rollback` marker.
   */
  applyTransaction(
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    options?: SealOptions,
  ): Transaction;
  /**
   * Resolve the model to the state before the newest revertible commit, by **appending a rollback**
   * (§4.1). The target stays in the log and the transcript as a superseded occurrence.
   *
   * @returns the rollback commit it sealed, or `undefined` when there is nothing to undo.
   */
  undo(): Transaction | undefined;
  /** The exact inverse of `undo` — append a rollback that re-applies the newest redoable commit. */
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

  /**
   * The **one** place the applied projection moves: `data` is assigned nowhere else, so "no change
   * without a notification" is structural rather than a convention. Every mutator ends here.
   */
  const install = (nextData: ModelData): void => {
    // Notification is not re-entry — and the guard comes first, so a refused write changes nothing.
    if (notifying) throw new ReentrantStoreWrite();

    data = nextData;
    version += 1;

    notifying = true;
    try {
      // Over a copy: a listener may subscribe or unsubscribe while it runs, and that must not disturb
      // the listeners still to be called.
      for (const listener of [...listeners]) listener();
    } finally {
      // Reset even when a listener threw, or one misbehaving listener would leave the store permanently
      // unable to install anything.
      notifying = false;
    }
  };

  /** Is the commit at zero-based `index` a forward step — a run, or a rollback *of* a backward commit? */
  const isForward = (index: number): boolean => {
    const commit = log[index];
    if (commit.rollback === undefined) return true;
    // A rollback reverts its target: reverting a forward commit steps **back**, reverting a
    // backward commit (a redo) steps **forward** again. Computing direction rather than reading a
    // stored flag is what keeps a log of alternating undo/redo commits from oscillating.
    return !isForward(commit.rollback.of - 1);
  };

  /** Has the commit at 1-based `revision` already been reverted — does some commit roll it back? */
  const isReverted = (revision: number): boolean =>
    log.some((commit) => commit.rollback?.of === revision);

  const applyTransaction = (
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    seal: SealOptions = {},
  ): Transaction => {
    const revision = log.length + 1;

    let nextData = data;
    if (primary.length > 0) nextData = applyDiffs(nextData, primary);

    // Omitted ⇒ ask the invalidator what this change affects. Passed ⇒ use it as given: `[]` is a
    // caller saying "this discards nothing".
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
    // One combined inverse, reverse-ordered: the cascade is undone before the primary change, so
    // every port lands back on its pre-value.
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
      // The newest forward, interactive commit that no commit has rolled back yet. A forward
      // rollback — a redo — is itself revertible, which is what keeps undo/redo symmetric.
      return log.some(
        (commit, index) =>
          isForward(index) && commit.auto !== true && !isReverted(index + 1),
      );
    },

    get canRedo(): boolean {
      // The newest backward commit (a rollback of a forward commit) that no commit has re-applied yet.
      return log.some(
        (_commit, index) => !isForward(index) && !isReverted(index + 1),
      );
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
      // The newest forward, interactive commit that is not already reverted. Auto work is skipped:
      // undo lands on the interactive boundary, never on a step the user did not press. A forward
      // rollback (a redo) is a candidate too, so undo can take back a redo.
      for (let revision = log.length; revision >= 1; revision -= 1) {
        if (!isForward(revision - 1)) continue;
        if (log[revision - 1].auto === true) continue;
        if (isReverted(revision)) continue;
        return rollbackCommit(revision);
      }
      return undefined;
    },

    redo(): Transaction | undefined {
      // The newest backward commit that is not already reverted. Inverting it seals a forward
      // rollback that re-applies what the undo resolved away.
      for (let revision = log.length; revision >= 1; revision -= 1) {
        if (isForward(revision - 1)) continue;
        if (isReverted(revision)) continue;
        return rollbackCommit(revision);
      }
      return undefined;
    },
  };
}
