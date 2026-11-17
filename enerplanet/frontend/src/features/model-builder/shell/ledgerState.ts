/**
 * The ledger bar's state.
 *
 * The ledger is `store.log` — append-only, and never rewritten even by undo, which is what makes it a ledger
 * rather than a scratch buffer — read together with the cursor, the one thing that says how much of it is
 * applied. Everything here is derived from those two, so there is **no discard stack structure anywhere**:
 * the discard stack *is* the tail beyond the cursor. A second source of truth would drift from the
 * `discarded` blob a saved session restores, which is exactly the failure the derived-position design exists
 * to avoid.
 *
 * This module is deliberately presentation-free: rows newest first, signed ports, and one flag saying whether
 * an entry is still applied. The bar decides how that looks.
 */

import type { DiffOp, PortKey, Transaction, TransactionKind } from "@model-builder/core";

/** One changed port on a ledger line. */
export interface LedgerChange {
  port: PortKey;
  /** `+` when the transaction wrote it, `−` when it removed it. */
  sign: "+" | "−";
}

export interface LedgerRow {
  revision: number;
  /** `"action"` or `"jump"` — a transaction that does not say reads as an action. */
  kind: TransactionKind;
  nodeId?: string;
  auto: boolean;
  /** The ports this transaction touched: its primary writes, plus what it pruned. */
  changes: readonly LedgerChange[];
  /** Beyond the cursor: it happened, but it is not applied. This is the discard stack, item by item. */
  discarded: boolean;
}

export interface LedgerSummary {
  /** The most recent transaction that is *applied* — not the newest in the log. */
  last?: LedgerRow;
  /** How many entries sit beyond the cursor. */
  discarded: number;
}

/** Every entry in the log, newest first, each marked with whether it is still applied. */
export function ledgerRows(log: readonly Transaction[], cursor: number): LedgerRow[] {
  return log.map((transaction, index) => rowOf(transaction, index >= cursor)).reverse();
}

/** The collapsed bar's line: the last applied transaction, and how deep the discard tail is. */
export function ledgerSummary(log: readonly Transaction[], cursor: number): LedgerSummary {
  const rows = ledgerRows(log, cursor);
  const last = rows.find((entry) => !entry.discarded);

  return {
    ...(last === undefined ? {} : { last }),
    discarded: rows.filter((entry) => entry.discarded).length,
  };
}

function rowOf(transaction: Transaction, discarded: boolean): LedgerRow {
  return {
    revision: transaction.revision,
    kind: transaction.kind ?? "action",
    ...(transaction.nodeId === undefined ? {} : { nodeId: transaction.nodeId }),
    auto: transaction.auto === true,
    // Primary first, then what it pruned: both changed a port, and a jump carries its discards in `cascade`
    // because its `primary` is empty by design.
    changes: [...transaction.primary, ...transaction.cascade].map(changeOf),
    discarded,
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
