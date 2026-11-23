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

/**
 * The regions a host offers, in layout order.
 *
 * Declared here, next to `Region`, because `Module.layout` already names regions — a second copy of this
 * list anywhere else would drift. The shell composes its page from it; a module author reads it to know
 * what it may ask for.
 */
export const REGIONS: readonly Region[] = ["sidebar", "map", "bottom", "overlay"];

/** Lifecycle of one workflow node. */
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

/** Identifies the workflow node a run belongs to — the **placement** that produced a commit (§2). */
export interface NodeRef {
  /** The placement id, e.g. `"5-area-draw"` (§2). Unique per occurrence, never reused. */
  id: string;
  /**
   * The module this placement runs, so a replay can rebuild the placement without the plan.
   *
   * A seed node's own `id` names it too, but an **appended** placement (a re-run's successor)
   * has no seed entry, so the module has to ride on the commit for the transcript to be a pure
   * function of `(seed flow, log)`.
   */
  moduleId: string;
  /**
   * Whether the run was an **automatic** step's — the module's own flag (`Module.auto`), carried here so the
   * engine can stamp it on the transaction and history can skip it. A different fact from the node's
   * identity: the id names a position, `auto` says the work ran with no forward action.
   */
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
 * What a module's completeness gate is given: the projection, and nothing else.
 *
 * Narrower than `ModuleCtx` **on purpose** — the gate is asked outside a run (by the position, to decide
 * whether a node has finished, and by the palette, to decide whether it *can*). A validator that could
 * `commit` would be able to change the very state it is judging, and one that could `read` would silently
 * license a rewrite it never performs. So it gets the store and no verbs.
 */
export interface ValidationCtx {
  /** Current projection. Frozen in spirit: never mutate it — build new values instead. */
  readonly store: Readonly<ModelData>;
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
  /** Declared influence: which outputs an input can invalidate. */
  affect: Partial<Record<PortKey, readonly PortKey[]>>;
  /** Where its Component mounts when the node is active. */
  layout: readonly Region[];
  /**
   * How often the node's work is sealed into the log. Defaults to `"at-completion"`.
   * Only declare `"per-commit"` when the module's writes are independent.
   */
  seal?: SealGranularity;
  /**
   * The module is an **automatic** step: it runs on arrival with no forward action, because only the module
   * knows whether there is anything for the user to collect. Absent means interactive.
   *
   * An automatic module should declare `overlay`, since that is where the frame shows its run state — it
   * forces that slot open for one, there being no forward action to press. It is a module-level execution
   * property for the same reason `seal` is: whether a step runs itself is a fact about the work, and a module
   * is the only thing that can judge it — a flow document cannot author what the product cannot express.
   */
  auto?: boolean;
  /** Headless execution — how auto nodes run without rendering anything. */
  run?(ctx: ModuleCtx): void | Promise<void>;
  /**
   * The module's own completeness gate: **is the work finished, judged by the module itself**.
   *
   * Two callers, and they are why this is not optional boilerplate:
   *
   * - a node that ran is only `done` while this reports no issues, so "every node is done" means the
   *   model is whole rather than merely walked past;
   * - the save node turns the same verdict into "what's missing" for the user.
   *
   * **A module must not finish with an output it has not filled.** If a run can legitimately produce
   * nothing meaningful — an area that yields no buildings, a grid with no transformers — the module either
   * says so here (and the node stays unfinished until it changes) or does not seal. What it must not do is
   * write a hollow value and call it done; the engine refuses the obvious hollowness (empty strings, null,
   * undefined) and this gate is where the rest of the judgement lives.
   *
   * Absent means "nothing to check", and such a node is done when it ran.
   */
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

/**
 * Is this a **host module** — one that renders no UI at all?
 *
 * A host module is not a workflow node and has no place in a flow: the frame
 * mounts it once, because the service it provides is always there, and hands that service to every module
 * that declared the region it fills. `map-provider` is the standing example — it writes nothing, declares no
 * region, and the frame mounts its canvas itself.
 *
 * Read off `layout` rather than asked as a flag, so the two cannot disagree. A module naming no region renders
 * nowhere in the frame, so a flow containing it would describe a step with nothing to show; that is a fact
 * about the declaration, not a separate attribute to keep in step with it. A host gains a region and it
 * becomes placeable; a node loses its last one and stops being one.
 */
export function isHostModule(module: Module): boolean {
  return module.layout.length === 0;
}

/**
 * Is this an **automatic** module — a step that runs on arrival with no forward action?
 *
 * Read off `auto` rather than inferred from `layout`: a module that declares `overlay` is *usually*
 * automatic (that is where its run state shows), but an interactive module may legitimately use the overlay
 * slot too, and `run()` alone cannot say it either (an interactive module runs as well). The flag is the one
 * place the fact is stated, so the shell reads it through here rather than each site testing the field.
 */
export function isAutoModule(module: Module): boolean {
  return module.auto === true;
}
