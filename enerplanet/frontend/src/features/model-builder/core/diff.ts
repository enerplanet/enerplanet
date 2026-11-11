/**
 * Reversible diffs and sealed transactions (`Plan.md` §4–§6).
 *
 * A transaction is pure data: `primary` is what the action changed, `cascade` is what
 * invalidation pruned. Because every op carries `prev` *and* `next`, undo/redo/replay are
 * offline operations — no module and no backend involved.
 */

import type { ModelData, PortKey } from "./ports";

export type DiffOp =
  | { op: "replace"; path: string; prev: unknown; next: unknown }
  | { op: "remove"; path: string; prev: unknown };

/**
 * One sealed action. `revision` is 1-based and monotonically increasing; the log is
 * append-only, so a revision identifies an entry for the lifetime of the session.
 */
export interface Transaction {
  readonly revision: number;
  /** The action's own diff. */
  readonly primary: readonly DiffOp[];
  /** Downstream values the action invalidated (empty until the invalidator exists). */
  readonly cascade: readonly DiffOp[];
  /** Workflow node that produced it, when known. */
  readonly nodeId?: string;
  /**
   * The workflow node that produced it was an **auto** node (`Plan.md` §7).
   *
   * Stamped at seal time so history never has to consult the workflow to know which
   * transactions it may skip when undoing (T14).
   */
  readonly auto?: boolean;
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

/**
 * Immutable write: clones only the objects along `path`, shares everything else.
 *
 * Paths address **object keys**, not array indices — nested writes so far are vector-keyed
 * records (`/buildingParams/electricity`). Replacing an array (a GeoJSON collection, the
 * coordinates) happens whole, at a key.
 */
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

/**
 * Reverse a diff. Applied in reverse order so multi-op diffs restore correctly
 * (`Plan.md` §4: undo restores the transaction's pre-values exactly).
 *
 * Inverting a `remove` therefore restores the value it dropped — the first bug this
 * function had, caught by T4.
 */
export function invertDiffs(ops: readonly DiffOp[]): DiffOp[] {
  return [...ops].reverse().map((op) =>
    op.op === "replace"
      ? { op: "replace", path: op.path, prev: op.next, next: op.prev }
      : { op: "replace", path: op.path, prev: undefined, next: op.prev },
  );
}
