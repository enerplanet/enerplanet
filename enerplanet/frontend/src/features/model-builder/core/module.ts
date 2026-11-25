/**
 * The module contract.
 *
 * One module = one job, one data slice, one UI concern. A module declares its whole
 * store surface as `params`; it reads those ports, mutates them, and hands the result
 * back through `commit`. It never holds state and never imports another module.
 */

import type { ModelData, PortKey } from "./ports";

/** Layout regions a module's UI may mount into. */
export type Region = "sidebar" | "bottom" | "overlay" | "map";

/** The regions a host offers, in layout order. */
export const REGIONS: readonly Region[] = ["sidebar", "map", "bottom", "overlay"];

/** Lifecycle of one workflow node. */
export type NodeState = "pending" | "ready" | "active" | "done" | "skipped" | "stale" | "error";

/** How often a node's work is written to the log. Defaults to `"at-completion"`. */
export type SealGranularity = "at-completion" | "per-commit";

/** Identifies the workflow node a run belongs to — the placement that produced a commit. */
export interface NodeRef {
  /** The placement id, e.g. `"5-area-draw"`. Unique per occurrence, never reused. */
  id: string;
  /** The module this placement runs, so a replay can rebuild the placement without the plan. */
  moduleId: string;
  /** Whether the run was an automatic step's — the module's own `auto` flag. */
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

/** What a module's completeness gate is given: the projection, and nothing else. */
export interface ValidationCtx {
  /** Current projection. Frozen in spirit: never mutate it — build new values instead. */
  readonly store: Readonly<ModelData>;
}

/** The context handed to a module's `run()`. */
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
  /** Declared influence: which outputs an input can invalidate. */
  affect: Partial<Record<PortKey, readonly PortKey[]>>;
  /** Where its Component mounts when the node is active. */
  layout: readonly Region[];
  /** How often the node's work is sealed into the log. Defaults to `"at-completion"`. */
  seal?: SealGranularity;
  /** The module is an automatic step: it runs on arrival with no forward action. Absent means interactive. */
  auto?: boolean;
  /** Headless execution — how auto nodes run without rendering anything. */
  run?(ctx: ModuleCtx): void | Promise<void>;
  /** The module's own completeness gate: is the work finished, judged by the module itself. */
  validate?(ctx: ValidationCtx): readonly ValidationIssue[];
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

/** Is this a host module — one that renders no UI at all? */
export function isHostModule(module: Module): boolean {
  return module.layout.length === 0;
}

/** Is this an automatic module — a step that runs on arrival with no forward action? */
export function isAutoModule(module: Module): boolean {
  return module.auto === true;
}
