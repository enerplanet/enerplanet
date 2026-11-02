import type { ModuleDefinition } from "../types/module";
import type { ConfiguratorContext } from "../types/context";
import type {
  NodeStatus,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowNode,
} from "../types/workflow";
import { ModuleInventory } from "../modules/ModuleInventory";
// Import the module barrel so its `registerAll()` side-effect populates the
// default inventory singleton before the engine resolves any node moduleId.
import { defaultModuleInventory } from "../modules";
import {
  buildGraph,
  getReadyNodes,
  getValidNextModules,
  isComplete,
} from "./WorkflowGraph";

export interface NodeEngineOptions {
  /** Module registry used to resolve node moduleIds to definitions. */
  inventory?: ModuleInventory;
  /** Called whenever the internal context changes (e.g. to sync with React). */
  onContextChange?: (context: ConfiguratorContext) => void;
}

/**
 * Graph-based playback controller for a workflow (Phase 3).
 *
 * Replaces the linear index-cursor `WorkflowEngine` with a node-network model.
 * A node is loadable only when the shared context is valid for it: all of its
 * `dependsOn` are `done` AND its module's `io.required` keys exist in context
 * (context-validity gating, via the `WorkflowGraph` helpers).
 *
 * - `auto` nodes run automatically as soon as they become ready.
 * - Interactive ready nodes are the user's "next" choices (mix-and-match).
 *
 * The engine is framework-agnostic. The React playback shell drives it and
 * syncs the resulting context back into the `ModelBuilderContextProvider` via
 * `onContextChange`.
 */
export class NodeEngine {
  private readonly workflow: WorkflowDefinition;
  private readonly inventory: ModuleInventory;
  private readonly onContextChange?: (context: ConfiguratorContext) => void;
  private readonly graph: WorkflowGraph;
  private context: ConfiguratorContext;
  private nodeStates: Record<string, NodeStatus>;

  constructor(
    workflow: WorkflowDefinition,
    initialContext: ConfiguratorContext = {},
    options: NodeEngineOptions = {},
  ) {
    this.workflow = workflow;
    this.inventory = options.inventory ?? defaultModuleInventory;
    this.onContextChange = options.onContextChange;
    this.graph = buildGraph(workflow);

    // Restore persisted node states if provided (resume support), otherwise
    // initialise every node to `pending`.
    this.nodeStates = initialContext.nodeStates
      ? { ...initialContext.nodeStates }
      : this.initialiseNodeStates();

    // Strip the engine-owned node-state fields from the working context so
    // they are not treated as module data; they are tracked separately.
    const { nodeStates: _nodeStates, activeNodeId: _activeNodeId, ...rest } =
      initialContext;
    this.context = rest;

    // Set the active node to the first ready node (or the restored one).
    this.activeNodeId = this.pickInitialActiveNode();
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Returns the full context (for save/export). */
  getContext(): ConfiguratorContext {
    return this.context;
  }

  /** Returns the workflow definition. */
  getWorkflow(): WorkflowDefinition {
    return this.workflow;
  }

  /** Returns the derived graph. */
  getGraph(): WorkflowGraph {
    return this.graph;
  }

  /** Returns the per-node lifecycle states. */
  getNodeStates(): Record<string, NodeStatus> {
    return this.nodeStates;
  }

  /** Returns the currently active node, or `null` if none. */
  getActiveNode(): WorkflowNode | null {
    if (!this.activeNodeId) return null;
    return this.graph.nodes.find((n) => n.id === this.activeNodeId) ?? null;
  }

  /** Returns the active node's module definition, or `null` if none. */
  getActiveModule(): ModuleDefinition | null {
    const node = this.getActiveNode();
    if (!node) return null;
    return this.inventory.getModuleOrThrow(node.moduleId).getDefinition();
  }

  /** Returns the nodes that are ready to load right now. */
  getReadyNodes(): WorkflowNode[] {
    return getReadyNodes(this.graph, this.context, this.nodeStates);
  }

  /** Returns the interactive (non-auto) ready nodes a user may choose next. */
  getValidNextModules(): WorkflowNode[] {
    return getValidNextModules(this.graph, this.context, this.nodeStates);
  }

  /** True when every node in the graph is `done` or `skipped`. */
  isComplete(): boolean {
    return isComplete(this.graph, this.nodeStates);
  }

  /** Returns progress info (done/skipped vs total nodes). */
  getProgress(): { current: number; total: number; percent: number } {
    const total = this.graph.nodes.length;
    const current = this.graph.nodes.filter(
      (n) =>
        this.nodeStates[n.id] === "done" ||
        this.nodeStates[n.id] === "skipped",
    ).length;
    return {
      current,
      total,
      percent: total === 0 ? 0 : Math.round((current / total) * 100),
    };
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  /**
   * Merge partial updates into the engine's working context, then recompute
   * ready nodes (context-validity gating) and auto-run any newly-ready `auto`
   * nodes.
   */
  async updateContext(updates: Partial<ConfiguratorContext>): Promise<void> {
    const next = { ...this.context, ...updates };
    // Only notify when the context actually changed. The shell syncs the full
    // React context back into the engine on every render; without this guard
    // the merge always produces a fresh object reference, which triggers
    // onContextChange -> onUpdate -> new context -> re-render -> updateContext
    // again — an infinite render loop.
    const changed = !this.shallowEqual(this.context, next);
    this.context = next;
    if (changed) {
      this.notifyContextChange();
    }
    await this.runAutoNodes();
  }

  // ---------------------------------------------------------------------------
  // Node lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Activate a node: set it active, call its module's `onEnter`, and mark it
   * `active`.
   */
  async activateNode(nodeId: string): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);
    const module = this.inventory.getModuleOrThrow(node.moduleId).getDefinition();

    // Remember re-activation of an already-completed node. `activateNode` sets
    // the status to `active`, which would otherwise erase the "was done" signal
    // by the time `completeNode` runs (M3 invalidation needs it).
    const prior = this.nodeStates[nodeId];
    if (prior === "done" || prior === "skipped") {
      this.reactivated.add(nodeId);
    }

    this.activeNodeId = nodeId;
    this.nodeStates = { ...this.nodeStates, [nodeId]: "active" };

    if (module.onEnter) {
      await module.onEnter(this.context);
    }

    this.notifyContextChange();
  }

  /**
   * Complete a node: call its module's `onLeave`, merge its declared outputs
   * into the context, mark it `done`, recompute ready nodes, auto-run any
   * newly-ready `auto` nodes (recursively), and set the active node to the
   * next ready interactive node.
   *
   * **Invalidation (M3):** re-completing a node whose outputs actually changed
   * (fingerprint mismatch vs. its last completion) resets every transitive
   * downstream node to `pending` and clears their declared outputs, so stale
   * downstream results are never presented as current. A redo that changes
   * nothing is a no-op for the pipeline.
   */
  async completeNode(nodeId: string): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);
    const module = this.inventory.getModuleOrThrow(node.moduleId).getDefinition();

    const wasDone =
      this.reactivated.has(nodeId) || this.nodeStates[nodeId] === "done";
    const previousFingerprint = this.fingerprints[nodeId];

    // 1. onLeave — may validate/transform and return an updated context.
    if (module.onLeave) {
      const left = await module.onLeave(this.context);
      if (left) this.context = left;
    }

    // 2. Merge the module's declared outputs into the context.
    this.mergeOutputs(module);

    // 3. Mark done.
    this.nodeStates = { ...this.nodeStates, [nodeId]: "done" };

    // 4. Invalidate downstream on a redo that actually changed something.
    const fingerprint = this.computeFingerprint(module);
    this.fingerprints[nodeId] = fingerprint;
    if (wasDone && fingerprint !== previousFingerprint) {
      await this.invalidateDownstream(nodeId);
    }
    this.reactivated.delete(nodeId);

    // 5. Recompute ready nodes and auto-run any newly-ready auto nodes.
    await this.runAutoNodes();

    // 6. Set the active node to the next ready interactive node.
    this.activeNodeId = this.pickNextInteractiveNode();

    this.notifyContextChange();
  }

  /**
   * Skip a node (only if it is `skippable`), then recompute ready nodes and
   * auto-run any newly-ready `auto` nodes.
   */
  async skipNode(nodeId: string): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);
    if (node.skippable !== true) {
      throw new Error(
        `[NodeEngine] Node "${node.label}" (${nodeId}) is not skippable`,
      );
    }

    this.nodeStates = { ...this.nodeStates, [nodeId]: "skipped" };

    await this.runAutoNodes();

    this.activeNodeId = this.pickNextInteractiveNode();

    this.notifyContextChange();
  }

  /**
   * Run all currently-ready `auto` nodes in dependency order.
   *
   * Each auto node is activated, executed, and its outputs merged before the
   * next is considered, so newly-ready auto nodes cascade recursively.
   *
   * Execution prefers the module's headless `run()` (so an auto node actually
   * does its work without being rendered). When a module has no `run()`, it
   * falls back to the legacy path: `onEnter`/`onLeave`, then merges whatever
   * declared outputs already exist in context.
   */
  async runAutoNodes(): Promise<void> {
    // Guard against re-entrancy while auto nodes are being processed.
    if (this.isRunningAuto) return;
    this.isRunningAuto = true;
    try {
      let ready = getReadyNodes(this.graph, this.context, this.nodeStates);
      while (ready.some((n) => n.auto === true)) {
        const autoNode = ready.find((n) => n.auto === true);
        if (!autoNode) break;

        const module = this.inventory
          .getModuleOrThrow(autoNode.moduleId)
          .getDefinition();

        this.activeNodeId = autoNode.id;
        this.nodeStates = { ...this.nodeStates, [autoNode.id]: "active" };

        if (module.run) {
          // Headless execution — this is the primary path for auto nodes.
          const outputs = await module.run(this.context);
          if (outputs) this.mergeRunOutputs(module, outputs);
        } else {
          // Legacy fallback: lifecycle hooks + adopt pre-declared outputs.
          if (module.onEnter) {
            await module.onEnter(this.context);
          }
          if (module.onLeave) {
            const left = await module.onLeave(this.context);
            if (left) this.context = left;
          }
          this.mergeOutputs(module);
        }

        this.nodeStates = { ...this.nodeStates, [autoNode.id]: "done" };

        ready = getReadyNodes(this.graph, this.context, this.nodeStates);
      }
    } finally {
      this.isRunningAuto = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private isRunningAuto = false;

  private activeNodeId: string | null = null;

  /** Last-completed fingerprint (JSON of declared output values) per node id. */
  private fingerprints: Record<string, string> = {};

  /** Nodes re-activated from `done`/`skipped` and awaiting re-completion (M3). */
  private reactivated = new Set<string>();

  /**
   * Stable fingerprint of a module's declared output values in the context.
   * Used to detect whether a re-completion actually changed anything (M3).
   */
  private computeFingerprint(module: ModuleDefinition): string {
    const picked: Record<string, unknown> = {};
    for (const key of module.io.outputs) {
      const value = (this.context as Record<string, unknown>)[key];
      if (value !== undefined) picked[key] = value;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(picked).sort()) {
      (sorted as Record<string, unknown>)[key] = picked[key];
    }
    return JSON.stringify(sorted);
  }

  /**
   * Reset every transitive downstream node of `fromNodeId` to `pending` and
   * clear their declared outputs from the context. Auto nodes re-run on the
   * next `runAutoNodes()`; interactive nodes become available again. The graph
   * itself is the invalidation map — no separate `invalidates` list needed.
   */
  private async invalidateDownstream(fromNodeId: string): Promise<void> {
    const outgoing = new Map<string, string[]>();
    for (const edge of this.graph.edges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge.to);
      outgoing.set(edge.from, list);
    }

    const stack = [fromNodeId];
    const reachable = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of outgoing.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          stack.push(next);
        }
      }
    }

    const nextContext: ConfiguratorContext = { ...this.context };
    for (const id of reachable) {
      // Only already-completed nodes carry data that can go stale.
      const status = this.nodeStates[id];
      if (status !== "done" && status !== "skipped") continue;

      const node = this.getNodeOrThrow(id);
      const module = this.inventory
        .getModuleOrThrow(node.moduleId)
        .getDefinition();
      for (const key of module.io.outputs) {
        delete (nextContext as Record<string, unknown>)[key];
      }
      this.nodeStates = { ...this.nodeStates, [id]: "pending" };
      delete this.fingerprints[id];
    }
    this.context = nextContext;
  }

  /** Initialise every node in the graph to `pending`. */
  private initialiseNodeStates(): Record<string, NodeStatus> {
    const states: Record<string, NodeStatus> = {};
    for (const node of this.graph.nodes) {
      states[node.id] = "pending";
    }
    return states;
  }

  /** Pick the initial active node: the restored one, else the first ready. */
  private pickInitialActiveNode(): string | null {
    const ready = getReadyNodes(this.graph, this.context, this.nodeStates);
    if (ready.length === 0) return null;
    // Prefer an interactive node so the user has a choice; fall back to the
    // first ready node (which may be auto — runAutoNodes will handle it).
    const interactive = ready.find((n) => n.auto !== true);
    return (interactive ?? ready[0]).id;
  }

  /** Pick the next interactive ready node, or `null` if none. */
  private pickNextInteractiveNode(): string | null {
    const interactive = getValidNextModules(
      this.graph,
      this.context,
      this.nodeStates,
    );
    return interactive[0]?.id ?? null;
  }

  /** Look up a node by id or throw. */
  private getNodeOrThrow(nodeId: string): WorkflowNode {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`[NodeEngine] Unknown node id: "${nodeId}"`);
    }
    return node;
  }

  /**
   * Merge a module's declared `io.outputs` from the current context into the
   * engine's working context. Outputs are read from the context because
   * modules write via `onUpdate` (which the shell syncs back into the engine).
   */
  private mergeOutputs(module: ModuleDefinition): void {
    const merged: ConfiguratorContext = { ...this.context };
    for (const key of module.io.outputs) {
      const value = (this.context as Record<string, unknown>)[key];
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    this.context = merged;
  }

  /**
   * Merge the partial returned by a module's headless `run()` into the context.
   *
   * Only keys declared in `module.io.outputs` are applied; an undeclared key is
   * dropped with a warning (the writer-discipline guard for the auto path).
   * `undefined` values are skipped, matching `mergeOutputs`.
   */
  private mergeRunOutputs(
    module: ModuleDefinition,
    outputs: Partial<ConfiguratorContext>,
  ): void {
    const allowed = new Set(module.io.outputs);
    const merged: ConfiguratorContext = { ...this.context };
    for (const [key, value] of Object.entries(
      outputs as Record<string, unknown>,
    )) {
      if (!allowed.has(key)) {
        console.warn(
          `[NodeEngine] Module "${module.meta.id}" run() wrote undeclared output "${key}" — ignored`,
        );
        continue;
      }
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    this.context = merged;
  }

  private notifyContextChange(): void {
    this.onContextChange?.(this.context);
  }

  /** Shallow equality check used to avoid redundant context notifications. */
  private shallowEqual(a: ConfiguratorContext, b: ConfiguratorContext): boolean {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (aRecord[key] !== bRecord[key]) return false;
    }
    return true;
  }
}
