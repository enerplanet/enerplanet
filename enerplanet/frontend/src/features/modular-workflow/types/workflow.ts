
export interface WorkflowStep {
  /** Module ID from the catalog */
  moduleId: string;
  /** Human-readable label for this step */
  label: string;
  /** Optional description shown in the UI */
  description?: string;
  /** Data mapping: context key → module input key */
  inputMapping?: Record<string, string>;
  /** Data mapping: module output key → context key */
  outputMapping?: Record<string, string>;
  /** If true, user can skip this step (uses defaults) */
  skippable?: boolean;
  /** If true, this step runs automatically without user interaction */
  auto?: boolean;
}

/**
 * A single node in the node-network model.
 *
 * Unlike the linear `steps` array, nodes declare their own dependencies
 * (`dependsOn`) and can be mixed and matched. A node only loads when the
 * shared context is valid for it (see `WorkflowGraph` helpers).
 */
export interface WorkflowNode {
  /** Unique node ID within the workflow */
  id: string;
  /** Module ID from the catalog */
  moduleId: string;
  /** Human-readable label for this node */
  label: string;
  /** Optional description shown in the UI */
  description?: string;
  /** IDs of other nodes that must complete before this one can run */
  dependsOn?: string[];
  /** If true, this node runs automatically without user interaction */
  auto?: boolean;
  /** If true, the user can skip this node (uses defaults) */
  skippable?: boolean;
  /** Data mapping: context key → module input key */
  inputMapping?: Record<string, string>;
  /** Data mapping: module output key → context key */
  outputMapping?: Record<string, string>;
}

/** Lifecycle state of a single node in the graph. */
export type NodeStatus =
  | "pending"
  | "ready"
  | "active"
  | "done"
  | "skipped"
  | "error";

/** A directed edge in the derived workflow graph. */
export interface WorkflowEdge {
  from: string;
  to: string;
}

/**
 * The derived node-network for a workflow.
 *
 * `edges` are derived from each node's explicit `dependsOn` plus the module's
 * `io.required` / `io.inputs` contract (resolved via the inventory).
 */
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowDefinition {
  /** Unique workflow ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this workflow does */
  description: string;
  /** Ordered list of steps (legacy linear model — kept for the legacy shell) */
  steps: WorkflowStep[];
  /**
   * Node-network model (Phase 2). Optional for backward compatibility — when
   * absent, the graph helpers can derive nodes from `steps`.
   */
  nodes?: WorkflowNode[];
  /** Workflow IDs to recommend after this one completes (context-dependent) */
  followUpWorkflows?: string[];
  /** Tags for categorization and recommendation matching */
  tags?: string[];
  /** Version for migration support */
  version: string;
}
