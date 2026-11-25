/**
 * What a viewed placement's module renders from — the projection as of that placement's commit.
 */

import type { ModelData } from "@model-builder/core";
import { lastActionOf, replay } from "@model-builder/core";
import type { Store } from "../core/store";

/** The projection the module on screen renders from — the viewed placement's commit, or the live projection. */
export function viewedProjection(store: Store, viewed: string | undefined): Readonly<ModelData> {
  if (viewed === undefined) return store.data;

  // A placement has at most one commit; a rollback carries no node, so it never answers here.
  const commit = lastActionOf(store.log, viewed);
  if (commit === undefined) return store.data;

  // `revision` is 1-based and monotonic, so replaying that many commits lands just after this one.
  return replay(store.initial, store.log, commit.revision);
}
