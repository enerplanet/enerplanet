/**
 * The ledger bar's state — the log newest first.
 *
 * A presentation-free reading of `store.log`: rows newest first, signed ports, and nothing else. The
 * bar decides how that looks.
 */

import type { DiffOp, PortKey, Transaction } from "@model-builder/core";

/** One changed port on a ledger line. */
export interface LedgerChange {
  port: PortKey;
  /** `+` when the transaction wrote it, `−` when it removed it. */
  sign: "+" | "−";
}

export interface LedgerRow {
  revision: number;
  /** The placement the commit belongs to; absent on a rollback. */
  nodeId?: string;
  auto: boolean;
  /** The ports this transaction touched: its primary writes, plus what it pruned. */
  changes: readonly LedgerChange[];
}

export interface LedgerSummary {
  /** The newest transaction in the log — every entry is applied now. */
  last?: LedgerRow;
}

/** Every entry in the log, newest first. */
export function ledgerRows(log: readonly Transaction[]): LedgerRow[] {
  return log.map(rowOf).reverse();
}

/** The collapsed bar's line: the newest transaction. */
export function ledgerSummary(log: readonly Transaction[]): LedgerSummary {
  const last = ledgerRows(log)[0];
  return last === undefined ? {} : { last };
}

function rowOf(transaction: Transaction): LedgerRow {
  return {
    revision: transaction.revision,
    ...(transaction.node === undefined ? {} : { nodeId: transaction.node.id }),
    auto: transaction.auto === true,
    changes: [...transaction.primary, ...transaction.cascade].map(changeOf),
  };
}

function changeOf(op: DiffOp): LedgerChange {
  // A `replace` with no `next` is how the applicator spells a removal, so it signs the same way.
  const removed = op.op === "remove" || op.next === undefined;
  return { port: portOfPath(op.path), sign: removed ? "−" : "+" };
}

/** The port a diff path addresses: its first segment (`/buildingParams/electricity` → `buildingParams`). */
function portOfPath(path: string): PortKey {
  return path.slice(1).split("/")[0] as PortKey;
}
