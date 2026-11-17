/**
 * The store — the current model projection plus the append-only transaction log.
 *
 * The store is dumb on purpose: it holds `data`, the `log` and a `cursor` into it. Three mutators reach
 * the projection — sealing (`applyTransaction`), `undo`, `redo` — and all three end at the single
 * `install` chokepoint below, which is also where listeners are told that a change happened. Nothing else
 * can change the projection. It carries no business logic: validation, cascade computation and the
 * redo recomputation all live above it or are injected (see `StoreOptions.deriveCascade`).
 *
 * Undo/redo are a cursor over the log, never a rewrite of it: the log stays immutable, so
 * a revision always identifies the same entry. Undo restores a transaction's pre-values
 * exactly (including downstream user edits its cascade pruned); redo re-applies the
 * primary diff and re-derives the cascade against the current projection.
 */

import {
  applyDiffs,
  invertDiffs,
  type DiffOp,
  type JumpRef,
  type Transaction,
  type TransactionKind,
} from "./diff";
import { ReentrantStoreWrite } from "./errors";
import type { NodeRef } from "./module";
import type { ModelData } from "./ports";

/** What one undo/redo step moved over. */
export interface UndoReport {
  /** How many transactions the step passed over. */
  transactions: number;
  /** Their nodes, in the order they were unwound (undo) or re-applied (redo). */
  nodeIds: string[];
}

/** Everything a seal carries beyond its diff. */
export interface SealOptions {
  /** The workflow node this transaction belongs to. */
  node?: NodeRef;
  /** `"jump"` marks a position move rather than a change. */
  kind?: TransactionKind;
  /** Set with `kind: "jump"` — where the session came from and where it went. */
  jump?: JumpRef;
}

export interface StoreOptions {
  /**
   * The invalidation seam. Consulted at **two moments**, and the symmetry is
   * the point: at **seal**, when a caller omits the cascade, so a module's change prunes exactly
   * what it affects; and at **redo**, re-derived against the *current* projection rather than
   * replaying the prunes the transaction stored, so redone work can never resurrect values the
   * model no longer has.
   *
   * Defaults to "nothing is invalidated" for a store built without a flow around it (the core's
   * own tests, mostly). The frame builds its store with `createInvalidator(flow, registry)`.
   */
  deriveCascade?: (primary: readonly DiffOp[], data: Readonly<ModelData>) => DiffOp[];
  /**
   * Open an existing session instead of a fresh one: the projection at `cursor` together
   * with the log it came from, taken on faith.
   *
   * This is the artefact's **fast path** — the projection is used as given, with no replay, which
   * is what makes a load instant. The store does not check that the projection really is
   * `replay(initial, log, cursor)`; that consistency is the artefact loader's job, and replaying
   * here would defeat the point.
   */
  restore?: {
    projection: ModelData;
    log: readonly Transaction[];
    cursor: number;
  };
}

export interface Store {
  /** The projection the session started from — the base `replay()` needs. */
  readonly initial: Readonly<ModelData>;
  /** Current projection. Read-only to everyone; rebuild it instead of mutating it. */
  readonly data: Readonly<ModelData>;
  /** Every sealed transaction, oldest first. Never rewritten — even by undo. */
  readonly log: readonly Transaction[];
  /** How many transactions of the log are currently applied (0 = the initial projection). */
  readonly cursor: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * A **change token**: it increments on *every* applied change, including one that leaves the projection
   * referentially identical — a zero-diff jump moves the position while writing nothing.
   *
   * A host subscribes to this rather than to `data`'s identity, for exactly that reason. (Not to be
   * confused with a `Transaction.revision`, which is that transaction's own sequence number in the log.)
   */
  readonly version: number;
  /**
   * Register a listener called **after every applied change** — a seal, an undo, a redo — with the new
   * projection already in place. Returns the unsubscribe.
   *
   * This exists at the `install` chokepoint rather than on the transaction path for a specific reason:
   * `undo()` and `redo()` change the projection *without sealing anything* (they invert and re-apply
   * transactions already in the log), so a listener wired to the seal would stay silent exactly while the
   * user navigates history — which is when the frame most needs to hear.
   *
   * A listener re-reads; it must never write.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Seal a transaction: abandon any redo tail, apply it to the projection, append it to the
   * log, and move the cursor onto it.
   *
   * **Omitting `cascade` derives it** through the invalidator seam below — that is how a change's
   * consequences are pruned. **Passing one uses it as given**, including `[]`, which is how a
   * pure position move opts out: a jump changes nothing, so it may discard nothing.
   *
   * This is the engine's write path — modules reach the store only through a `ModuleCtx`.
   */
  applyTransaction(
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    options?: SealOptions,
  ): Transaction;
  /**
   * Step back to the previous **interactive boundary**: over the trailing step, and
   * over any auto node's work below it, restoring every transaction's pre-values exactly.
   *
   * @returns what it unwound, or `undefined` when there is nothing to undo.
   */
  undo(): UndoReport | undefined;
  /** The exact inverse of `undo` — forward to the next interactive boundary. */
  redo(): UndoReport | undefined;
}

export function createStore(initial: ModelData = {}, options: StoreOptions = {}): Store {
  const deriveCascade = options.deriveCascade ?? ((): DiffOp[] => []);
  const restore = options.restore;
  let data: ModelData = restore === undefined ? initial : restore.projection;
  const log: Transaction[] = restore === undefined ? [] : [...restore.log];
  let cursor = restore === undefined ? 0 : restore.cursor;

  const listeners = new Set<() => void>();
  let version = 0;
  let notifying = false;

  /**
   * The **one** place the applied projection moves: `data` and `cursor` are assigned nowhere else, so
   * "no change without a notification" is structural rather than a convention.
   * Every mutator — seal, undo, redo — ends here, and a multi-step undo notifies once, because one
   * gesture is one change.
   */
  const install = (nextData: ModelData, nextCursor: number): void => {
    // Notification is not re-entry — and the guard comes first, so a refused write changes nothing.
    if (notifying) throw new ReentrantStoreWrite();

    data = nextData;
    cursor = nextCursor;
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

    get cursor(): number {
      return cursor;
    },

    get canUndo(): boolean {
      return cursor > 0;
    },

    get canRedo(): boolean {
      return cursor < log.length;
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

    applyTransaction(primary, cascade, options = {}): Transaction {
      // An action is only valid from the current revision: editing after an undo abandons
      // the redo tail. The dropped entries leave the log untouched — they simply stop
      // being part of it.
      if (cursor < log.length) log.length = cursor;

      const revision = log.length + 1;

      let nextData = data;
      if (primary.length > 0) nextData = applyDiffs(nextData, primary);

      // Omitted ⇒ ask the invalidator what this change affects. Passed ⇒ use it as given:
      // `[]` is a caller saying "this discards nothing", which is what a position move means.
      const pruned = cascade ?? deriveCascade(primary, nextData);
      if (pruned.length > 0) nextData = applyDiffs(nextData, pruned);

      const { node, kind, jump } = options;
      const transaction: Transaction = Object.freeze({
        revision,
        primary: Object.freeze([...primary]),
        cascade: Object.freeze([...pruned]),
        ...(node === undefined ? {} : { nodeId: node.id }),
        ...(node?.auto === true ? { auto: true } : {}),
        ...(kind === undefined ? {} : { kind }),
        ...(jump === undefined ? {} : { jump: Object.freeze({ ...jump }) }),
      });

      log.push(transaction);
      install(nextData, log.length);
      return transaction;
    },

    undo(): UndoReport | undefined {
      if (cursor === 0) return undefined;

      const unwound: string[] = [];
      let transactions = 0;
      let nextData = data;
      let nextCursor = cursor;

      // One step back, then keep going while the cursor would rest on (or immediately
      // after) an auto node's work — the cursor only ever rests on an interactive
      // boundary.
      do {
        const transaction = log[nextCursor - 1];
        // One combined inverse, reverse-ordered: the cascade is undone before the primary
        // change, so every port lands back on its pre-value — the user's own downstream
        // edits included.
        nextData = applyDiffs(nextData, invertDiffs([...transaction.primary, ...transaction.cascade]));
        nextCursor -= 1;
        transactions += 1;
        if (transaction.nodeId !== undefined) unwound.push(transaction.nodeId);
      } while (nextCursor > 0 && log[nextCursor - 1].auto === true);

      install(nextData, nextCursor);
      return { transactions, nodeIds: unwound };
    },

    redo(): UndoReport | undefined {
      if (cursor >= log.length) return undefined;

      const applied: string[] = [];
      let transactions = 0;
      let nextData = data;
      let nextCursor = cursor;

      do {
        const transaction = log[nextCursor];
        nextData = applyDiffs(nextData, transaction.primary);

        const cascade = deriveCascade(transaction.primary, nextData);
        if (cascade.length > 0) nextData = applyDiffs(nextData, cascade);

        nextCursor += 1;
        transactions += 1;
        if (transaction.nodeId !== undefined) applied.push(transaction.nodeId);
      } while (nextCursor < log.length && log[nextCursor - 1].auto === true);

      install(nextData, nextCursor);
      return { transactions, nodeIds: applied };
    },
  };
}
