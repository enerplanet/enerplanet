/**
 * Replay — rebuild a projection from the log, and read a placement's own commit.
 *
 * The log is self-contained materialized diffs, so replaying it needs no module and no backend:
 * it is the artefact's recovery path, and a pure way to inspect the model at any revision.
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

/** The placement's own single commit, or `undefined` when it has none yet. */
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
