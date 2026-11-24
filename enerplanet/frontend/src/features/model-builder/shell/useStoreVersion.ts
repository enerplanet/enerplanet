/**
 * The frame's subscription to the store.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Store } from "../core/store";

export function useStoreVersion(store: Store | undefined): number {
  const subscribe = useCallback(
    (listener: () => void): (() => void) => (store === undefined ? () => undefined : store.subscribe(listener)),
    [store],
  );

  const getSnapshot = useCallback(() => (store === undefined ? 0 : store.version), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
