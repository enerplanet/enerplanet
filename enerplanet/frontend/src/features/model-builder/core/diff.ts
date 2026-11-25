/**
 * Reversible diffs and sealed commits.
 *
 * A transaction is pure data: `primary` is what the action changed, `cascade` is what
 * invalidation pruned. Every op carries `prev` and `next`, so replay is an offline operation.
 */

import type { ModelData, PortKey } from "./ports";
import type { NodeRef } from "./module";

export type DiffOp =
  | { op: "replace"; path: string; prev: unknown; next: unknown }
  | { op: "remove"; path: string; prev: unknown };

/** One sealed commit. `revision` is 1-based and monotonically increasing; the log is append-only. */
export interface Transaction {
  readonly revision: number;
  /** The placement that produced it. Absent on a rollback. */
  readonly node?: NodeRef;
  /** Set when the commit was produced by an auto module. */
  readonly auto?: boolean;
  /** What the run changed. Empty for a commit that resolved the model without a diff of its own. */
  readonly primary: readonly DiffOp[];
  /** Downstream values the action invalidated. */
  readonly cascade: readonly DiffOp[];
  /** Marks a rollback commit — an undo/redo resolving revision `of`. */
  readonly rollback?: { readonly of: number };
}

/** JSON-pointer path of a top-level port, e.g. `"/buildings"`. */
export function portPath(port: PortKey): string {
  return `/${port}`;
}

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function getAtPath(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const segment of segments(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Immutable write: clones only the objects along `path`, shares everything else. */
function setAtPath(root: ModelData, path: string, value: unknown): ModelData {
  const parts = segments(path);
  const next = { ...root } as Record<string, unknown>;
  let target: Record<string, unknown> = next;
  let source: Record<string, unknown> = root as unknown as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const childSource = source[key];
    const child =
      childSource !== null && typeof childSource === "object"
        ? { ...(childSource as Record<string, unknown>) }
        : {};
    target[key] = child;
    source = childSource as Record<string, unknown>;
    target = child;
  }

  target[parts[parts.length - 1]] = value;
  return next as unknown as ModelData;
}

function removeAtPath(root: ModelData, path: string): ModelData {
  const parts = segments(path);
  const next = { ...root } as Record<string, unknown>;
  let target: Record<string, unknown> = next;
  let source: Record<string, unknown> = root as unknown as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const childSource = source[key];
    if (childSource === null || typeof childSource !== "object") return next as unknown as ModelData;
    const child = { ...(childSource as Record<string, unknown>) };
    target[key] = child;
    source = childSource as Record<string, unknown>;
    target = child;
  }

  delete target[parts[parts.length - 1]];
  return next as unknown as ModelData;
}

/** Apply one op, immutably. */
export function applyDiff(data: ModelData, op: DiffOp): ModelData {
  if (op.op === "remove" || op.next === undefined) return removeAtPath(data, op.path);
  return setAtPath(data, op.path, op.next);
}

/** Apply a sequence of ops, immutably. */
export function applyDiffs(data: ModelData, ops: readonly DiffOp[]): ModelData {
  return ops.reduce<ModelData>((acc, op) => applyDiff(acc, op), data);
}

/** Reverse a diff, applied in reverse order so multi-op diffs restore correctly. */
export function invertDiffs(ops: readonly DiffOp[]): DiffOp[] {
  return [...ops].reverse().map((op) =>
    op.op === "replace"
      ? { op: "replace", path: op.path, prev: op.next, next: op.prev }
      : { op: "replace", path: op.path, prev: undefined, next: op.prev },
  );
}
