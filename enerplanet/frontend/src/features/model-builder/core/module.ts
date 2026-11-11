/**
 * The module contract (`Modules.md` §1).
 *
 * One module = one job, one data slice, one UI concern. A module declares its whole
 * store surface as `params`; it reads those ports, mutates them, and hands the result
 * back through `commit`. It never holds state and never imports another module.
 */

import type { ModelData, PortKey } from "./ports";

/** Layout regions a module's UI may mount into (`Plan.md` §8). */
export type Region = "sidebar" | "bottom" | "overlay" | "map";

/** Lifecycle of one workflow node (`Plan.md` §7). */
export type NodeState = "pending" | "ready" | "active" | "done" | "skipped" | "stale" | "error";

/**
 * How often a node's work is written to the log.
 *
 * - `"at-completion"` (default) — one sealed transaction for the whole `run()`. Required
 *   when the module's writes are interdependent (`grid-generation` writes buildings +
 *   transformers + lines + grids; a partial state there violates the module's own guarantee).
 * - `"per-commit"` — one atomic transaction per `commit()`. Right when the module's writes
 *   are independent (settings fields), and it buys the user field-level undo for free.
 *
 * Atomicity stays a property of the *transaction*; only the group differs.
 */
export type SealGranularity = "at-completion" | "per-commit";

/** Identifies the workflow node a run belongs to (`auto` is a node property, not a module's). */
export interface NodeRef {
  id: string;
  /** Auto nodes run headlessly as part of a forward action — never on a passive state change (T15). */
  auto?: boolean;
}

/** One store parameter a module declares. */
export interface Param {
  port: PortKey;
  /** The port must already exist in the store before this module can run. */
  required?: boolean;
}

/** What `validate()` reports: which port is incomplete, and why. */
export interface ValidationIssue {
  port?: PortKey;
  message: string;
}

/**
 * The context handed to a module's `run()`.
 *
 * `store` is for inspection only — a value is *consumed* by `read(port)`, and consuming
 * it is what licenses rewriting it (the anti-clobber rule). `commit` records intent; the
 * engine seals everything a run wrote as **one** transaction, so nothing is visible
 * until the run finishes.
 */
export interface ModuleCtx {
  /** Current projection. Frozen in spirit: never mutate it — build new values instead. */
  readonly store: Readonly<ModelData>;
  /** Read a port and mark it as consumed (licenses a later rewrite of that port). */
  read<K extends PortKey>(port: K): ModelData[K];
  /** Record a write. Rejected if the port is undeclared or would be blind-overwritten. */
  commit(changes: Partial<ModelData>): void;
  /** This node's lifecycle state while it runs. */
  readonly state: NodeState;
}

export interface Module {
  /** Stable id — the module register keys on it, workflows reference it. */
  id: string;
  name?: string;
  /** The module's whole store surface: what it may read and write. */
  params: readonly Param[];
  /** Declared influence: which outputs an input can invalidate (`Plan.md` §5). */
  affect: Partial<Record<PortKey, readonly PortKey[]>>;
  /** Where its Component mounts when the node is active. */
  layout: readonly Region[];
  /**
   * How often the node's work is sealed into the log. Defaults to `"at-completion"`.
   * Only declare `"per-commit"` when the module's writes are independent (T16).
   */
  seal?: SealGranularity;
  /** Headless execution — how `auto` nodes run without rendering anything. */
  run?(ctx: ModuleCtx): void | Promise<void>;
  /** Completeness / data gate (the save node turns this into "what's missing"). */
  validate?(ctx: ModuleCtx): readonly ValidationIssue[];
}

/** Identity helper: keeps a module literal type-checked at its definition site. */
export function defineModule(module: Module): Module {
  return module;
}

/** Ports the module declares it may write. */
export function declaredPorts(module: Module): PortKey[] {
  return module.params.map((param) => param.port);
}

/** Ports that must exist in the store before the module may run. */
export function requiredPorts(module: Module): PortKey[] {
  return module.params.filter((param) => param.required === true).map((param) => param.port);
}
