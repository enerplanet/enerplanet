/**
 * The frame's subscription to the store.
 *
 * The store announces every applied change — a seal, an undo, a redo — and this hook turns that into a
 * re-render. It reads the store's **change token** (`store.version`) rather than the projection, because
 * a change can move the position without moving `data`: a zero-diff jump discards nothing, yet the
 * session really is back at that node and the frame must redraw.
 *
 * `store` is optional so a host can render before it has a session — there is nothing to subscribe to
 * until then, and the hook simply never fires.
 *
 * The core stays React-free: it exposes `subscribe`/`version` and any host can wire them up. This lives
 * with the shell because the shell is the host today; a second host would bring its own (or adopt this).
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
