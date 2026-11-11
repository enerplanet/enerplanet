/**
 * The store — the current model projection plus the append-only transaction log
 * (`Plan.md` §3/§4).
 *
 * The store is dumb on purpose: it holds `data`, the `log` and a `cursor` into it, and
 * exposes exactly one way in — `applyTransaction`, the *only* path that can change the
 * projection. It carries no business logic: validation, cascade computation and the
 * redo recomputation all live above it or are injected (see `StoreOptions.deriveCascade`).
 *
 * Undo/redo are a cursor over the log, never a rewrite of it: the log stays immutable, so
 * a revision always identifies the same entry. Undo restores a transaction's pre-values
 * exactly (including downstream user edits its cascade pruned); redo re-applies the
 * primary diff and re-derives the cascade against the current projection.
 */

import { applyDiffs, invertDiffs, type DiffOp, type Transaction } from "./diff";
import type { NodeRef } from "./module";
import type { ModelData } from "./ports";

/** What one undo/redo step moved over (T14). */
export interface UndoReport {
  /** How many transactions the step passed over. */
  transactions: number;
  /** Their nodes, in the order they were unwound (undo) or re-applied (redo). */
  nodeIds: string[];
}

export interface StoreOptions {
  /**
   * The invalidation seam (`Plan.md` §5). Redo asks it to re-derive the cascade against
   * the *current* projection instead of replaying the prunes the transaction stored, so
   * redone work can never resurrect values the model no longer has.
   *
   * Defaults to "nothing is invalidated" until the invalidator module lands; the engine
   * will then construct the store with the real implementation.
   */
  deriveCascade?: (primary: readonly DiffOp[], data: Readonly<ModelData>) => DiffOp[];
}

export interface Store {
  /** Current projection. Read-only to everyone; rebuild it instead of mutating it. */
  readonly data: Readonly<ModelData>;
  /** Every sealed transaction, oldest first. Never rewritten — even by undo. */
  readonly log: readonly Transaction[];
  /** How many transactions of the log are currently applied (0 = the initial projection). */
  readonly cursor: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Seal a transaction: abandon any redo tail, apply it to the projection, append it to
   * the log, and move the cursor onto it.
   *
   * This is the engine's write path — modules reach the store only through a `ModuleCtx`.
   */
  applyTransaction(
    primary: readonly DiffOp[],
    cascade?: readonly DiffOp[],
    node?: NodeRef,
  ): Transaction;
  /**
   * Step back to the previous **interactive boundary** (T14): over the trailing step, and
   * over any auto node's work below it, restoring every transaction's pre-values exactly.
   *
   * @returns what it unwound, or `undefined` when there is nothing to undo.
   */
  undo(): UndoReport | undefined;
  /** The exact inverse of `undo` — forward to the next interactive boundary (T14). */
  redo(): UndoReport | undefined;
}

export function createStore(initial: ModelData = {}, options: StoreOptions = {}): Store {
  const deriveCascade = options.deriveCascade ?? ((): DiffOp[] => []);
  let data: ModelData = initial;
  const log: Transaction[] = [];
  let cursor = 0;

  return {
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

    applyTransaction(primary, cascade = [], node): Transaction {
      // An action is only valid from the current revision: editing after an undo abandons
      // the redo tail. The dropped entries leave the log untouched — they simply stop
      // being part of it (`Plan.md` §4).
      if (cursor < log.length) log.length = cursor;

      const revision = log.length + 1;

      if (primary.length > 0) data = applyDiffs(data, primary);
      if (cascade.length > 0) data = applyDiffs(data, cascade);

      const transaction: Transaction = Object.freeze({
        revision,
        primary: Object.freeze([...primary]),
        cascade: Object.freeze([...cascade]),
        ...(node === undefined ? {} : { nodeId: node.id }),
        ...(node?.auto === true ? { auto: true } : {}),
      });

      log.push(transaction);
      cursor = log.length;
      return transaction;
    },

    undo(): UndoReport | undefined {
      if (cursor === 0) return undefined;

      const unwound: string[] = [];
      let transactions = 0;

      // One step back, then keep going while the cursor would rest on (or immediately
      // after) an auto node's work — the cursor only ever rests on an interactive
      // boundary (T14).
      do {
        const transaction = log[cursor - 1];
        // One combined inverse, reverse-ordered: the cascade is undone before the primary
        // change, so every port lands back on its pre-value — the user's own downstream
        // edits included.
        data = applyDiffs(data, invertDiffs([...transaction.primary, ...transaction.cascade]));
        cursor -= 1;
        transactions += 1;
        if (transaction.nodeId !== undefined) unwound.push(transaction.nodeId);
      } while (cursor > 0 && log[cursor - 1].auto === true);

      return { transactions, nodeIds: unwound };
    },

    redo(): UndoReport | undefined {
      if (cursor >= log.length) return undefined;

      const applied: string[] = [];
      let transactions = 0;

      do {
        const transaction = log[cursor];
        data = applyDiffs(data, transaction.primary);

        const cascade = deriveCascade(transaction.primary, data);
        if (cascade.length > 0) data = applyDiffs(data, cascade);

        cursor += 1;
        transactions += 1;
        if (transaction.nodeId !== undefined) applied.push(transaction.nodeId);
      } while (cursor < log.length && log[cursor - 1].auto === true);

      return { transactions, nodeIds: applied };
    },
  };
}
