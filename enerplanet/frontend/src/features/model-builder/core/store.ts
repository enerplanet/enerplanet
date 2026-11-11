/**
 * The store — the current model projection plus the append-only transaction log
 * (`Plan.md` §3/§4).
 *
 * The store is dumb on purpose: it holds `data` and `log` and exposes exactly one
 * mutator, `applyTransaction`, which is the *only* way the projection can change. It
 * carries no business logic — validation, cascade computation and undo all happen above
 * it.
 */

import { applyDiffs, type DiffOp, type Transaction } from "./diff";
import type { ModelData } from "./ports";

export interface Store {
  /** Current projection. Read-only to everyone; rebuild it instead of mutating it. */
  readonly data: Readonly<ModelData>;
  /** Every sealed transaction, oldest first. Never truncated by undo (see `Plan.md` §4). */
  readonly log: readonly Transaction[];
  /**
   * Seal a transaction: apply it to the projection and append it to the log.
   *
   * This is the engine's write path — modules reach the store only through a `ModuleCtx`.
   */
  applyTransaction(primary: readonly DiffOp[], cascade: readonly DiffOp[], nodeId?: string): Transaction;
}

export function createStore(initial: ModelData = {}): Store {
  let data: ModelData = initial;
  const log: Transaction[] = [];

  return {
    get data(): Readonly<ModelData> {
      return data;
    },

    get log(): readonly Transaction[] {
      return log;
    },

    applyTransaction(primary, cascade, nodeId): Transaction {
      const revision = log.length + 1;

      if (primary.length > 0) data = applyDiffs(data, primary);
      if (cascade.length > 0) data = applyDiffs(data, cascade);

      const transaction: Transaction = Object.freeze({
        revision,
        primary: Object.freeze([...primary]),
        cascade: Object.freeze([...cascade]),
        ...(nodeId === undefined ? {} : { nodeId }),
      });

      log.push(transaction);
      return transaction;
    },
  };
}
