/**
 * The ledger bar's state (`spec/frame.md` §3.2).
 *
 * The ledger is `store.log` — append-only, and never rewritten even by undo, which is what makes it a ledger
 * rather than a scratch buffer — read together with the cursor, the one thing that says how much of it is
 * applied. Everything the bar shows is derived from those two, so there is **no discard stack structure
 * anywhere**: the discard stack *is* the tail beyond the cursor, and the cases below pin that it appears and
 * disappears exactly at the cursor. A second source of truth here would drift from the `discarded` blob a
 * saved session restores, which is the failure the derived-position design exists to avoid.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import type { PortKey } from "@model-builder/core";
import { ledgerRows, ledgerSummary } from "./ledgerState";
import { portPath, type DiffOp } from "../core/diff";
import { createStore } from "../core/store";

const NODE_EDIT = "model-edit";
const NODE_FIRST = "first";
const NODE_SECOND = "second";

function replace(port: PortKey, prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

function remove(port: PortKey, prev: unknown): DiffOp {
  return { op: "remove", path: portPath(port), prev };
}

/** Two applied edits, over a store that starts with a name and the resolution the example module requires. */
function twoEdits() {
  const store = createStore({ modelName: "a", resolution: 60 });
  store.applyTransaction([replace("modelName", "a", "b")], [], { node: { id: NODE_EDIT } });
  store.applyTransaction([replace("modelName", "b", "c")], [], { node: { id: NODE_EDIT } });
  return store;
}

describe("the ledger reads the log with the cursor, and nothing else", () => {
  it("lists transactions newest first, with their signed ports and nothing discarded", () => {
    const store = twoEdits();

    const rows = ledgerRows(store.log, store.cursor);

    expect(rows).toHaveLength(2);
    expect(rows[0].revision).toBe(2); // newest first
    expect(rows[1].revision).toBe(1);
    expect(rows[0].changes).toEqual([{ port: "modelName", sign: "+" }]);
    expect(rows[0].kind).toBe("action"); // absent reads as an action
    expect(rows[0].nodeId).toBe(NODE_EDIT);
    expect(rows.every((row) => !row.discarded)).toBe(true);
  });

  it("signs a removed port the other way", () => {
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([remove("resolution", 60)], [], { node: { id: NODE_EDIT } });

    const rows = ledgerRows(store.log, store.cursor);

    expect(rows[0].changes).toEqual([{ port: "resolution", sign: "−" }]);
  });

  it("calls the tail beyond the cursor discarded — the discard stack is derived, not stored", () => {
    const store = twoEdits();
    store.undo(); // cursor = 1, log still 2

    const rows = ledgerRows(store.log, store.cursor);

    expect(rows[0].discarded).toBe(true); // revision 2 is beyond the cursor
    expect(rows[1].discarded).toBe(false);
    expect(store.log).toHaveLength(2); // undo never rewrites the log
  });

  it("reads a jump's discards from its cascade, and still calls it a jump", () => {
    // Sealed directly: a jump's discards ride in its cascade, not its primary, which is empty by design.
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([], [remove("resolution", 60)], {
      node: { id: NODE_FIRST },
      kind: "jump",
      jump: { from: NODE_SECOND, to: NODE_FIRST },
    });

    const rows = ledgerRows(store.log, store.cursor);

    expect(rows[0].kind).toBe("jump");
    expect(rows[0].changes).toEqual([{ port: "resolution", sign: "−" }]);
    expect(rows[0].nodeId).toBe(NODE_FIRST);
  });

  it("records a jump that discarded nothing — the ledger says it happened even when nothing moved", () => {
    // The one documented zero-diff transaction: the intent is itself what is being recorded. Sealed directly,
    // because what is under test is the ledger's reading of it, not the jump.
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([], [], {
      node: { id: NODE_FIRST },
      kind: "jump",
      jump: { from: NODE_FIRST, to: NODE_FIRST },
    });

    const rows = ledgerRows(store.log, store.cursor);

    expect(rows[0].kind).toBe("jump");
    expect(rows[0].changes).toEqual([]);
    expect(rows[0].discarded).toBe(false);
  });

  it("summarises the most recent applied transaction, and counts what is beyond the cursor", () => {
    const store = twoEdits();
    store.undo();

    const summary = ledgerSummary(store.log, store.cursor);

    expect(summary.last?.revision).toBe(1); // the applied one, not the newest in the log
    expect(summary.discarded).toBe(1);
  });

  it("summarises nothing at the very start", () => {
    const store = createStore({ modelName: "a" });

    const summary = ledgerSummary(store.log, store.cursor);

    expect(summary.last).toBeUndefined();
    expect(summary.discarded).toBe(0);
  });
});
