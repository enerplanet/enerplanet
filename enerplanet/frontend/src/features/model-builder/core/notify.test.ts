/**
 * Store notification — the frame's prerequisite.
 *
 * The frame reads the store in four places and history moves from three controls, so every *applied*
 * change must announce itself. The point of these cases is the one a seal-only hook gets wrong: `undo`
 * and `redo` change the projection **without sealing a transaction** (`core/store.ts`), so a listener
 * wired to the transaction path would stay silent exactly while the user navigates history.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "./store";
import { ReentrantStoreWrite } from "./errors";
import type { DiffOp } from "./diff";
import { seed } from "./fixtures";

/** The name `seed()` starts with. */
const INITIAL_NAME = "Contract fixture";

/** A node id used by the "projection unchanged" case. */
const NODE_SAVE = "model-save";

function rename(from: string, to: string): DiffOp {
  return { op: "replace", path: "/modelName", prev: from, next: to };
}

describe("notification fires after every applied change", () => {
  it("notifies after a sealed transaction, with the new projection already in place", () => {
    const store = createStore(seed());
    const seen: string[] = [];

    store.subscribe(() => {
      seen.push(String(store.data.modelName));
    });

    store.applyTransaction([rename(INITIAL_NAME, "Renamed")]);

    // One notification, and it arrives *after* the change — a listener must never see the pre-state.
    expect(seen).toEqual(["Renamed"]);
  });

  it("notifies after undo, with the restored projection — the seal path alone would miss this", () => {
    const store = createStore(seed());
    const seen: (string | undefined)[] = [];

    store.applyTransaction([rename(INITIAL_NAME, "Renamed")]);
    store.subscribe(() => {
      seen.push(store.data.modelName);
    });

    store.undo();

    expect(seen).toEqual([INITIAL_NAME]);
  });

  it("notifies after redo, with the re-applied projection", () => {
    const store = createStore(seed());
    const seen: (string | undefined)[] = [];

    store.applyTransaction([rename(INITIAL_NAME, "Renamed")]);
    store.undo();
    store.subscribe(() => {
      seen.push(store.data.modelName);
    });

    store.redo();

    expect(seen).toEqual(["Renamed"]);
  });

  it("does not notify when nothing changed — an undo at the start is not a change", () => {
    const store = createStore(seed());
    let notified = 0;

    store.subscribe(() => {
      notified += 1;
    });

    expect(store.undo()).toBeUndefined(); // nothing to undo
    expect(store.redo()).toBeUndefined(); // and nothing to redo either
    expect(notified).toBe(0);
  });

  it("notifies even when the projection is identical", () => {
    // A commit that changes no value — an empty diff with an empty cascade (the shape a saved
    // record takes when nothing the store holds moved). `data` comes out referentially equal, yet
    // the session *did* change and the frame must redraw. This is why a host subscribes to a change
    // token rather than to the projection's identity.
    const store = createStore(seed());
    let notified = 0;
    const before = store.version;

    store.subscribe(() => {
      notified += 1;
    });

    store.applyTransaction([], [], { node: { id: NODE_SAVE, moduleId: NODE_SAVE } });

    expect(store.data.modelName).toBe(INITIAL_NAME); // the projection really is unchanged
    expect(notified).toBe(1);
    expect(store.version).not.toBe(before);
  });
});

describe("the listener contract", () => {
  it("stops notifying once unsubscribed", () => {
    const store = createStore(seed());
    let notified = 0;

    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    store.applyTransaction([rename(INITIAL_NAME, "One")]);
    unsubscribe();
    store.applyTransaction([rename("One", "Two")]);

    expect(notified).toBe(1);
  });

  it("rejects a listener that writes — this is notification, not re-entry", () => {
    const store = createStore(seed());
    let listenerError: unknown;

    store.subscribe(() => {
      try {
        store.applyTransaction([rename(INITIAL_NAME, "From a listener")]);
      } catch (error) {
        listenerError = error;
      }
    });

    store.applyTransaction([rename(INITIAL_NAME, "Renamed")]);

    expect(listenerError).toBeInstanceOf(ReentrantStoreWrite);
  });

  it("leaves the store usable after a listener's write was rejected", () => {
    // The guard's flag must be reset even when a listener throws — otherwise the store would be
    // permanently unable to install anything, having been tripped once.
    const store = createStore(seed());
    let notified = 0;

    const unsubscribe = store.subscribe(() => {
      notified += 1;
      try {
        store.undo();
      } catch {
        // the guard's rejection is the expected outcome here
      }
    });

    store.applyTransaction([rename(INITIAL_NAME, "First")]);
    unsubscribe();
    store.applyTransaction([rename("First", "Second")]);

    expect(notified).toBe(1);
    expect(store.data.modelName).toBe("Second"); // the second change did install
  });
});
