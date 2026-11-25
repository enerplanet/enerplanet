/**
 * The ledger bar's state — a pure reading of the log, newest first.
 */
import { describe, it, expect } from "vitest";
import type { PortKey } from "@model-builder/core";
import { ledgerRows, ledgerSummary } from "./ledgerState";
import { portPath, type DiffOp } from "../core/diff";
import { createStore } from "../core/store";

const NODE_EDIT = "model-edit";
const NODE_FIRST = "first";

function replace(port: PortKey, prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

function add(port: PortKey, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev: undefined, next };
}

function remove(port: PortKey, prev: unknown): DiffOp {
  return { op: "remove", path: portPath(port), prev };
}

/** Two applied edits, over a store that starts with a name and the resolution the example module requires. */
function twoEdits() {
  const store = createStore({ modelName: "a", resolution: 60 });
  store.applyTransaction([replace("modelName", "a", "b")], [], {
    node: { id: NODE_EDIT, moduleId: NODE_EDIT },
  });
  store.applyTransaction([replace("modelName", "b", "c")], [], {
    node: { id: NODE_EDIT, moduleId: NODE_EDIT },
  });
  return store;
}

describe("the ledger reads the log, and nothing else", () => {
  it("lists transactions newest first, with their signed ports", () => {
    const store = twoEdits();

    const rows = ledgerRows(store.log);

    expect(rows).toHaveLength(2);
    expect(rows[0].revision).toBe(2); // newest first
    expect(rows[1].revision).toBe(1);
    expect(rows[0].changes).toEqual([{ port: "modelName", sign: "+" }]);
    expect(rows[0].nodeId).toBe(NODE_EDIT);
    expect(rows[0].auto).toBe(false);
  });

  it("signs a removed port the other way", () => {
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([remove("resolution", 60)], [], {
      node: { id: NODE_EDIT, moduleId: NODE_EDIT },
    });

    const rows = ledgerRows(store.log);

    expect(rows[0].changes).toEqual([{ port: "resolution", sign: "−" }]);
  });

  it("reads a commit's prunes from its cascade", () => {
    // A change's cascade removes what it invalidated; the ledger signs both sides, primary first.
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([add("modelName", "b")], [remove("resolution", 60)], {
      node: { id: NODE_FIRST, moduleId: NODE_FIRST },
    });

    const rows = ledgerRows(store.log);

    expect(rows[0].changes).toEqual([
      { port: "modelName", sign: "+" },
      { port: "resolution", sign: "−" },
    ]);
    expect(rows[0].nodeId).toBe(NODE_FIRST);
  });

  it("records a run that changed nothing — the ledger says it happened even when nothing moved", () => {
    const store = createStore({ modelName: "a", resolution: 60 });
    store.applyTransaction([], [], { node: { id: NODE_FIRST, moduleId: NODE_FIRST } });

    const rows = ledgerRows(store.log);

    expect(rows[0].changes).toEqual([]);
    expect(rows[0].nodeId).toBe(NODE_FIRST);
  });

  it("appends a rollback for an undo — nothing is rewritten, and the target stays in the log", () => {
    const store = twoEdits();
    store.undo();

    const rows = ledgerRows(store.log);

    // The undo is a *new* commit: the log grew, and the newest row is a rollback (no placement).
    expect(store.log).toHaveLength(3);
    expect(rows[0].revision).toBe(3);
    expect(rows[0].nodeId).toBeUndefined();
    // The edits it resolved stay in the log, unmoved.
    expect(rows[1].revision).toBe(2);
    expect(rows[2].revision).toBe(1);
  });

  it("summarises the newest transaction in the log", () => {
    const store = twoEdits();
    store.undo();

    const summary = ledgerSummary(store.log);

    expect(summary.last?.revision).toBe(3); // the newest entry — every entry is applied now
  });

  it("summarises nothing at the very start", () => {
    const store = createStore({ modelName: "a" });

    const summary = ledgerSummary(store.log);

    expect(summary.last).toBeUndefined();
  });
});
