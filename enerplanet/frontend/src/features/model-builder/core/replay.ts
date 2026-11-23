/**
 * Replay — rebuild a projection from the log, and read a placement's own commit.
 *
 * The log is self-contained *materialized* diffs, so replaying it needs no
 * module and no backend. That gives this primitive two jobs:
 *
 * - the **recovery path** for the artefact: if a stored projection disagrees with its log, the
 *   log wins;
 * - a pure way to inspect what the model looked like at any revision.
 *
 * A **placement** has at most one commit — a re-run appends a *new* placement with a new id
 * rather than rewriting one — so looking a placement up is a find, never a scan over a
 * `nodeId` union (§2). `lastActionOf` and `writtenPortsOf` are that lookup; the union and the
 * jump scan v1 needed are gone.
 */

import { applyDiffs, type Transaction } from "./diff";
import type { ModelData } from "./ports";

/** Initial projection plus the first `revisions` commits, applied in order. */
export function replay(
  initial: ModelData,
  log: readonly Transaction[],
  revisions: number,
): ModelData {
  const upto = Math.max(0, Math.min(revisions, log.length));
  let data = initial;

  for (let index = 0; index < upto; index += 1) {
    const transaction = log[index];
    data = applyDiffs(data, transaction.primary);
    if (transaction.cascade.length > 0) data = applyDiffs(data, transaction.cascade);
  }

  return data;
}

/** The projection as it stood immediately before `revision` was sealed (1-based). */
export function replayBefore(initial: ModelData, log: readonly Transaction[], revision: number): ModelData {
  return replay(initial, log, revision - 1);
}

/**
 * The placement's own single commit, or `undefined` when it has none yet (`pending`).
 *
 * A rollback carries no node, so it never answers here — a placement's state is a statement
 * about its *work*, and a resolution of the model is not work.
 */
export function lastActionOf(
  log: readonly Transaction[],
  nodeId: string,
): Transaction | undefined {
  return log.find((transaction) => transaction.node?.id === nodeId);
}

/** Every port the placement's own commit wrote, in first-written order. */
export function writtenPortsOf(log: readonly Transaction[], nodeId: string): string[] {
  const commit = lastActionOf(log, nodeId);
  if (commit === undefined) return [];

  const ports: string[] = [];
  for (const op of commit.primary) {
    const [port] = op.path.split("/").filter(Boolean);
    if (port !== undefined && !ports.includes(port)) ports.push(port);
  }
  return ports;
}
