/** `area-draw`'s draft, held outside React and shared by every region. */

import { useSyncExternalStore } from "react";
import { fingerprint, type Coordinates } from "@model-builder/core";

let draft: Coordinates = [];
const listeners = new Set<() => void>();

/** What is drawn but not applied. */
export function getDraft(): Coordinates {
  return draft;
}

/** Replace the draft, notifying only when it actually changed. */
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
