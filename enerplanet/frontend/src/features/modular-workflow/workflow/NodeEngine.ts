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
   */
  async completeNode(nodeId: string): Promise<void> {
    const node = this.getNodeOrThrow(nodeId);
    const module = this.inventory.getModuleOrThrow(node.moduleId).getDefinition();

    // 1. onLeave — may validate/transform and return an updated context.
    if (module.onLeave) {
      const left = await module.onLeave(this.context);
      if (left) this.context = left;
    }

    // 2. Merge the module's declared outputs into the context.
    this.mergeOutputs(module);

    // 3. Mark done.
    this.nodeStates = { ...this.nodeStates, [nodeId]: "done" };

    // 4. Recompute ready nodes and auto-run any newly-ready auto nodes.
    await this.runAutoNodes();

    // 5. Set the active node to the next ready interactive node.
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
   * Each auto node is activated, completed, and its outputs merged before the
   * next is considered, so newly-ready auto nodes cascade recursively.
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

        if (module.onEnter) {
          await module.onEnter(this.context);
        }
        if (module.onLeave) {
          const left = await module.onLeave(this.context);
          if (left) this.context = left;
        }
        this.mergeOutputs(module);

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

  private notifyContextChange(): void {
    this.onContextChange?.(this.context);
  }

  /** Shallow equality check used to avoid redundant context notifications. */
  private shallowEqual(a: ConfiguratorContext, b: ConfiguratorContext): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }
}
