/**
 * `area-draw`'s draft, held **outside React**.
 *
 * A module's `Component` renders **once per region it declares** — two elements, two React instances, two
 * `useState`s. So any value two regions must agree on cannot live in component state: each region would paint
 * its own copy, the later re-render would win, and the effects in both would fight over the same map layer.
 * `area-draw` needs that agreement exactly (the drawing card's count and the sidebar's list are *the same*
 * draft), so the draft lives here and every region subscribes to it.
 *
 * This is the same reason `hold()` is module-level rather than per-instance: a module's own model belongs to the
 * module, not to a render of it.
 */

import { useSyncExternalStore } from "react";
import { fingerprint, type Coordinates } from "@model-builder/core";

let draft: Coordinates = [];
const listeners = new Set<() => void>();

/** What is drawn but not applied. */
export function getDraft(): Coordinates {
  return draft;
}

/**
 * Replace the draft, notifying only when it actually changed.
 *
 * The content comparison matters: callers hand over freshly built arrays, so an identity check would notify on
 * every call and an effect keyed on the draft would loop.
 */
export function setDraft(next: Coordinates): void {
  if (fingerprint(next) === fingerprint(draft)) return;
  draft = next;
  for (const listener of [...listeners]) listener();
}

/** Subscribe to changes. The shape `useSyncExternalStore` wants, exported so it can also be tested directly. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The draft, shared by every region of this module. Re-renders the region when it changes. */
export function useDraft(): Coordinates {
  return useSyncExternalStore(subscribe, getDraft);
}
