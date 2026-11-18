/**
 * The draft store's contract, held to account without a browser.
 *
 * Written failing first. What matters here is small and load-bearing: every region of the module must see the
 * *same* draft (that is the bug this store exists to fix), the snapshot must change identity when the value
 * changes (or React will not re-render), and it must **not** change when the value is the same (or an effect
 * keyed on the draft loops).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDraft, setDraft, subscribe } from "./draft";
import type { Coordinates } from "@model-builder/core";

const RING: Coordinates = [
  [
    [8.5, 49.3],
    [8.51, 49.3],
    [8.51, 49.31],
    [8.5, 49.31],
    [8.5, 49.3],
  ],
];

describe("the draft store", () => {
  beforeEach(() => {
    setDraft([]);
  });

  it("starts empty", () => {
    expect(getDraft()).toEqual([]);
  });

  it("hands every caller the one value, not a copy each", () => {
    setDraft(RING);

    // The whole point: two regions read this and must agree. One value, one reference.
    expect(getDraft()).toBe(getDraft());
    expect(getDraft()).toEqual(RING);
  });

  it("changes the snapshot's identity when the value changes, so React re-renders", () => {
    const before = getDraft();
    setDraft(RING);

    expect(getDraft()).not.toBe(before);
  });

  it("notifies on a real change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setDraft(RING);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("notifies every subscriber, not just the first", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribe(first);
    const offSecond = subscribe(second);

    setDraft(RING);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("does not notify when the value is the same, however it was built", () => {
    setDraft(RING);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    // A caller building a fresh array of the same points must not set off a re-render loop.
    setDraft(JSON.parse(JSON.stringify(RING)) as Coordinates);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    unsubscribe();
    setDraft(RING);

    expect(listener).not.toHaveBeenCalled();
  });
});
