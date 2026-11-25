/**
 * A viewed placement shows the state it was committed with — its own commit, not the live tip.
 */
import { describe, it, expect } from "vitest";
import { viewedProjection } from "./viewedProjection";
import { createStore, type Store } from "../core/store";
import { portPath, type DiffOp } from "../core/diff";

/** Seal one node's work, so a case can say "history looks like this" without running anything. */
function seal(store: Store, nodeId: string, next: number, prev: number): void {
  const op: DiffOp = { op: "replace", path: portPath("resolution"), prev, next };
  store.applyTransaction([op], [], { node: { id: nodeId, moduleId: "example" } });
}

describe("a viewed placement renders from its own commit", () => {
  it("returns the committed projection for a placement whose commit is behind the tip", () => {
    const store = createStore({ resolution: 60 });
    seal(store, "0-a", 30, 60); // revision 1
    seal(store, "1-b", 15, 30); // revision 2 — the tip

    // The tip holds the later value…
    expect(store.data.resolution).toBe(15);

    // …but looking back at the first placement shows what *it* committed: 30, not 15.
    const viewed = viewedProjection(store, "0-a");
    expect(viewed.resolution).toBe(30);
    // And it really differs from the live projection — the whole point of the rule.
    expect(viewed.resolution).not.toBe(store.data.resolution);
  });

  it("returns the live projection when nothing is viewed", () => {
    const store = createStore({ resolution: 60 });
    seal(store, "0-a", 30, 60);
    seal(store, "1-b", 15, 30);

    expect(viewedProjection(store, undefined)).toBe(store.data);
    expect(viewedProjection(store, undefined).resolution).toBe(15);
  });

  it("returns the live projection when the view names an unknown placement", () => {
    const store = createStore({ resolution: 60 });
    seal(store, "0-a", 30, 60);
    seal(store, "1-b", 15, 30);

    expect(viewedProjection(store, "9-nope")).toBe(store.data);
  });

  it("returns the live projection for a viewed placement that has no commit yet", () => {
    const store = createStore({ resolution: 60 });
    seal(store, "0-a", 30, 60);
    // "1-b" is placed but never sealed — a `pending` placement with no entry in the log.
    expect(store.log.some((entry) => entry.node?.id === "1-b")).toBe(false);

    expect(viewedProjection(store, "1-b")).toBe(store.data);
  });

  it("rebuilds the whole state at that commit, not just the port it wrote", () => {
    const store = createStore({ resolution: 60, modelName: "seed" });
    store.applyTransaction(
      [
        { op: "replace", path: portPath("resolution"), prev: 60, next: 30 },
        { op: "replace", path: portPath("modelName"), prev: "seed", next: "one" },
      ],
      [],
      { node: { id: "0-a", moduleId: "example" } },
    );
    store.applyTransaction([{ op: "replace", path: portPath("modelName"), prev: "one", next: "two" }], [], {
      node: { id: "1-b", moduleId: "example" },
    });

    const viewed = viewedProjection(store, "0-a");
    expect(viewed.resolution).toBe(30);
    expect(viewed.modelName).toBe("one");
    expect(store.data.modelName).toBe("two");
  });
});
