import { describe, expect, it } from "vitest";
import { createEmptyContext } from "../../context/defaults";
import { apply } from "../../context/reducer";
import { deserializeContext, serializeContext } from "../../context/serialize";
import type { ModelContext } from "../../context/types";

function ctx(): ModelContext {
  return createEmptyContext();
}

describe("context reducer", () => {
  it("starts blank and serializable", () => {
    const c = ctx();
    expect(c.revision).toBe(0);
    expect(c.status).toBe("draft");
    expect(() => JSON.stringify(c)).not.toThrow();
  });

  it("set-meta merges and records a reversible diff", () => {
    const { next, diff } = apply(ctx(), { type: "set-meta", payload: { title: "My model" } });
    expect(next.meta.title).toBe("My model");
    expect(next.revision).toBe(1);
    expect(next.status).toBe("modified");
    expect(diff).toEqual([
      { op: "replace", path: "/meta/title", prev: "Untitled model", next: "My model" },
    ]);
    expect(next.history).toHaveLength(1);
    expect(next.undoStack).toHaveLength(1);
  });

  it("does not mutate the previous context (immutability)", () => {
    const before = ctx();
    const { next } = apply(before, { type: "set-meta", payload: { title: "Changed" } });
    expect(before.meta.title).toBe("Untitled model");
    expect(before.revision).toBe(0);
    expect(next).not.toBe(before);
  });

  it("ignores no-op patches (undefined values, no changes)", () => {
    const c = ctx();
    const { next, diff } = apply(c, { type: "set-meta", payload: {} });
    expect(next).toBe(c);
    expect(diff).toEqual([]);
  });

  it("undo/redo round-trips a change", () => {
    let c = ctx();
    c = apply(c, { type: "set-meta", payload: { title: "A" } }).next;
    c = apply(c, { type: "set-meta", payload: { title: "B" } }).next;
    expect(c.meta.title).toBe("B");

    c = apply(c, { type: "undo" }).next;
    expect(c.meta.title).toBe("A");
    c = apply(c, { type: "undo" }).next;
    expect(c.meta.title).toBe("Untitled model");

    c = apply(c, { type: "redo" }).next;
    expect(c.meta.title).toBe("A");
    c = apply(c, { type: "redo" }).next;
    expect(c.meta.title).toBe("B");
  });

  it("a new mutation clears the redo stack", () => {
    let c = ctx();
    c = apply(c, { type: "set-meta", payload: { title: "A" } }).next;
    c = apply(c, { type: "undo" }).next;
    expect(c.redoStack).toHaveLength(1);
    c = apply(c, { type: "set-meta", payload: { title: "C" } }).next;
    expect(c.redoStack).toHaveLength(0);
  });

  it("undo on empty stack is a no-op", () => {
    const c = ctx();
    expect(apply(c, { type: "undo" }).next).toBe(c);
    expect(apply(c, { type: "redo" }).next).toBe(c);
  });

  it("assign-tech / remove-tech round-trip per building", () => {
    let c = ctx();
    c = apply(c, {
      type: "assign-tech",
      payload: { osmIds: ["b1", "b2"], techId: "solar", params: { kwp: 10 } },
    }).next;
    expect(c.techAssignments.assignments.b1).toEqual([{ techId: "solar", params: { kwp: 10 } }]);
    expect(c.techAssignments.assignments.b2).toHaveLength(1);

    // duplicate assign is ignored
    const dup = apply(c, { type: "assign-tech", payload: { osmIds: ["b1"], techId: "solar" } });
    expect(dup.diff).toEqual([]);

    c = apply(c, { type: "remove-tech", payload: { osmIds: ["b1"], techId: "solar" } }).next;
    expect(c.techAssignments.assignments.b1).toEqual([]);
    expect(c.techAssignments.assignments.b2).toHaveLength(1);

    c = apply(c, { type: "undo" }).next;
    expect(c.techAssignments.assignments.b1).toHaveLength(1);
  });

  it("update-building patches properties and records prev", () => {
    let c = ctx();
    c = apply(c, {
      type: "set-grid",
      payload: {
        buildings: [
          { osmId: "b1", geometry: { type: "Point", coordinates: [0, 0] }, properties: { floors: 2 } },
        ],
      },
    }).next;
    const { next, diff } = apply(c, {
      type: "update-building",
      payload: { osmId: "b1", patch: { properties: { floors: 5 } } },
    });
    expect(next.grid.buildings[0].properties).toEqual({ floors: 5 });
    expect(diff[0].path).toBe("/grid/buildings/0/properties");

    // unknown building is a no-op
    expect(apply(next, { type: "update-building", payload: { osmId: "nope", patch: {} } }).diff).toEqual([]);
  });

  it("set-demand upserts entries keyed by building", () => {
    let c = ctx();
    c = apply(c, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 4000 } }).next;
    c = apply(c, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 4500 } }).next;
    expect(c.demand.entries.b1.yearlyKwh).toBe(4500);
    c = apply(c, { type: "undo" }).next;
    expect(c.demand.entries.b1.yearlyKwh).toBe(4000);
  });

  it("timeseries refs add/remove and dedupe", () => {
    const ref = {
      id: "t1",
      name: "PV profile",
      kind: "production" as const,
      unit: "kW" as const,
      resolution: "hourly" as const,
      scope: "all-buildings" as const,
    };
    let c = ctx();
    c = apply(c, { type: "add-timeseries", payload: ref }).next;
    expect(apply(c, { type: "add-timeseries", payload: ref }).diff).toEqual([]);
    c = apply(c, { type: "remove-timeseries", payload: { id: "t1" } }).next;
    expect(c.userData.timeseries).toEqual([]);
  });

  it("load-snapshot replaces the context wholesale (branch)", () => {
    let a = ctx();
    a = apply(a, { type: "set-meta", payload: { title: "Origin" } }).next;
    const branch = apply(a, {
      type: "load-snapshot",
      payload: { ...a, id: undefined, parentId: 42, meta: { ...a.meta, title: "Branch" } },
    }).next;
    expect(branch.parentId).toBe(42);
    expect(branch.id).toBeUndefined();
    expect(branch.meta.title).toBe("Branch");
    expect(branch.history).toHaveLength(1); // history copied
  });

  it("history entries are attributable (nodeId, actionType, revision)", () => {
    const c = apply(ctx(), {
      type: "assign-tech",
      payload: { osmIds: ["b1"], techId: "solar", nodeId: "technologies" },
    }).next;
    const entry = c.history[0];
    expect(entry.actionType).toBe("assign-tech");
    expect(entry.nodeId).toBe("technologies");
    expect(entry.revision).toBe(1);
    expect(entry.diff.length).toBeGreaterThan(0);
  });
});

describe("serialization", () => {
  it("round-trips a full context", () => {
    let c = ctx();
    c = apply(c, { type: "set-meta", payload: { title: "Round trip" } }).next;
    c = apply(c, { type: "assign-tech", payload: { osmIds: ["b1"], techId: "solar" } }).next;
    const restored = deserializeContext(serializeContext(c));
    expect(restored).toEqual(c);
  });

  it("rejects malformed files", () => {
    expect(() => deserializeContext("{}")).toThrow();
    expect(() => deserializeContext('{"format":"other","version":1,"context":{}}')).toThrow();
  });
});
