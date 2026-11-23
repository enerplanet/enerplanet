/**
 * Reversible diffs and sealed commits.
 *
 * A transaction is pure data: `primary` is what the action changed, `cascade` is what
 * invalidation pruned. Because every op carries `prev` *and* `next`, replay is an offline
 * operation — no module and no backend involved.
 *
 * **A transaction is a change, full stop.** v1 modelled a position move ("jump") as a
 * zero-diff transaction, and history then spent a lot of machinery filtering it out. v2 moves
 * the view out of the log entirely (a move writes nothing and is no commit), so the only thing
 * a commit ever records is enacted work: a module ran, and there is a diff.
 *
 * Two special commits remain, both ordinary changes:
 *
 * - a **rollback** — an undo or a redo. It carries `rollback: { of }`, naming the revision it
 *   inverts, and it carries **no node**: it is a resolution of the model, not the work of a
 *   placement, so the transcript stays a pure fold of appends.
 */

import type { ModelData, PortKey } from "./ports";
import type { NodeRef } from "./module";

export type DiffOp =
  | { op: "replace"; path: string; prev: unknown; next: unknown }
  | { op: "remove"; path: string; prev: unknown };

/**
 * One sealed commit. `revision` is 1-based and monotonically increasing; the log is
 * append-only (nothing rewrites an entry — even undo appends), so a revision identifies an
 * entry for the lifetime of the session.
 */
export interface Transaction {
  readonly revision: number;
  /**
   * The placement that produced it (§2). Carrying the whole placement (`id` **and** `moduleId`)
   * is what makes the transcript a pure function of `(seed flow, log)`: a replay never has to
   * consult the plan to know which module an appended placement ran. Absent on a rollback.
   */
  readonly node?: NodeRef;
  /**
   * The commit was produced by an **auto** module (`Module.auto`), stamped at seal time so
   * history never has to consult the workflow to know which commits it may skip when undoing.
   */
  readonly auto?: boolean;
  /** What the run changed. Empty for a commit that resolved the model without a diff of its own. */
  readonly primary: readonly DiffOp[];
  /** Downstream values the action invalidated. */
  readonly cascade: readonly DiffOp[];
  /**
   * Marks a **rollback** commit — an undo/redo resolving revision `of`. Its `primary` is the
   * inverse of that revision's change + cascade, so applying it resolves the model to the state
   * before `of` (or, when `of` is itself a rollback, forward again).
   */
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
 * Reverse a diff. Applied in reverse order so multi-op diffs restore correctly:
 * a rollback restores a commit's pre-values exactly.
 *
 * Inverting a `remove` therefore restores the value it dropped — the first bug this
 * function had.
 */
export function invertDiffs(ops: readonly DiffOp[]): DiffOp[] {
  return [...ops].reverse().map((op) =>
    op.op === "replace"
      ? { op: "replace", path: op.path, prev: op.next, next: op.prev }
      : { op: "replace", path: op.path, prev: undefined, next: op.prev },
  );
}
