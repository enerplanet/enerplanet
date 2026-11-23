/**
 * What a viewed placement's module renders from — the projection **as of that placement's commit** (§4).
 *
 * `ModuleViewProps.data` is "the projection, read-only", and the one thing a module renders from. While
 * the session is **looking at** a placement, the module must show the state that placement was committed
 * with, not the live tip — otherwise looking back at a step marks it in the panels but leaves the module
 * rendering the current world, which is the bug §4 fixes.
 *
 * The decision is a pure function of `(store, viewed)` so it is testable without a DOM: there is no jsdom
 * here, and the JSX wiring is only a call to this.
 *
 * - no view, or a view naming nothing that committed ⇒ the **live** projection (`store.data`);
 * - a viewed placement that has a commit ⇒ `replay(initial, log, commit.revision)`, the projection just
 *   **after** that commit — the state the node was committed with.
 *
 * Only the module on screen reads this. The store the module runs against, `run`, the map service and the
 * position/steps panel all stay on the **live** store: a view is read-only, and acting snaps back to the
 * tip (the shell clears `viewed` when a run starts).
 */

import type { ModelData } from "@model-builder/core";
import { lastActionOf, replay } from "@model-builder/core";
import type { Store } from "../core/store";

/**
 * The projection the module on screen renders from.
 *
 * `viewed` is the placement the session is looking at; absent, the session is at the frontier and the live
 * projection is what shows. A view naming a placement with no commit (`pending`), or one not in this
 * session's log at all, is honoured as "not behind the tip" — the live projection — rather than pretending
 * to have history it does not.
 */
export function viewedProjection(store: Store, viewed: string | undefined): Readonly<ModelData> {
  if (viewed === undefined) return store.data;

  // A placement has **at most one** commit, and this is the find that gets it (§2) — a rollback carries no
  // node, so it is never an answer here.
  const commit = lastActionOf(store.log, viewed);
  if (commit === undefined) return store.data;

  // `revision` is 1-based and monotonic, so replaying that many commits lands just after this one — the
  // state it seals, cascade and all.
  return replay(store.initial, store.log, commit.revision);
}
