/**
 * The frame's subscription to the store.
 *
 * The store announces every applied change and this hook turns that into a re-render. It reads the
 * store's change token (`store.version`) rather than the projection, because a change can move the
 * frontier without moving `data`.
 *
 * `store` is optional so a host can render before it has a session.
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
