/**
 * Replay — rebuild a projection from the log.
 *
 * The log is self-contained *materialized* diffs, so replaying it needs no
 * module and no backend. That gives this primitive three jobs:
 *
 * - the **recovery path** for the artefact: if a stored projection disagrees with its log, the
 *   log wins;
 * - the **history side of elision**: was any of a node's affecting inputs different the last
 *   time it ran? (`rerun.ts`);
 * - a pure way to inspect what the model looked like at any revision.
 */

import { applyDiffs, type Transaction } from "./diff";
import type { ModelData } from "./ports";

/** Initial projection plus the first `revisions` transactions, applied in order. */
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

/** The node's most recent **action** in the applied prefix — jumps don't count. */
export function lastActionOf(
  log: readonly Transaction[],
  nodeId: string,
  cursor: number,
): Transaction | undefined {
  for (let index = Math.min(cursor, log.length) - 1; index >= 0; index -= 1) {
    const transaction = log[index];
    if (transaction.nodeId === nodeId && transaction.kind !== "jump") return transaction;
  }
  return undefined;
}

/**
 * The jump the session is resting on: the **latest** applied entry, when that entry is a jump.
 *
 * A jump is a position move — it changes no data — so it is the only thing that can leave the session
 * somewhere other than the frontier (a run is a change, and once it becomes the latest entry the frontier
 * is the resting place again). This is the log-index counterpart of `lastActionOf`, and it is what lets
 * `position.ts` derive where the session sits without a stored position or a re-arm flag.
 */
export function currentJump(log: readonly Transaction[], cursor: number): Transaction | undefined {
  const applied = Math.min(cursor, log.length);
  if (applied === 0) return undefined;
  const entry = log[applied - 1];
  return entry.kind === "jump" ? entry : undefined;
}

/**
 * Every port the node has written anywhere in the applied prefix, in first-written order.
 *
 * Scanning *all* of its transactions matters: a jump stamps the target's node id with an empty
 * primary, so reading only the latest entry would lose sight of what the node actually wrote.
 */
export function writtenPortsOf(
  log: readonly Transaction[],
  nodeId: string,
  cursor: number,
): string[] {
  const ports: string[] = [];

  for (let index = 0; index < Math.min(cursor, log.length); index += 1) {
    const transaction = log[index];
    if (transaction.nodeId !== nodeId) continue;

    for (const op of transaction.primary) {
      const [port] = op.path.split("/").filter(Boolean);
      if (port !== undefined && !ports.includes(port)) ports.push(port);
    }
  }

  return ports;
}
