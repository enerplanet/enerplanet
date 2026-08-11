import type {
  NodeStatus,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "../types/workflow";
import type { ConfiguratorContext } from "../types/context";
import type { ModuleDefinition } from "../types/module";
import { canRunModule } from "../modules/base/BaseModule";
// Import the module barrel so its `registerAll()` side-effect populates the
// default inventory singleton before we resolve any node moduleId.
import { defaultModuleInventory } from "../modules";
import { ModuleInventory } from "../modules/ModuleInventory";

/**
 * Node-network helpers for the modular-workflow graph model (Phase 2).
 *
 * These are pure, framework-agnostic functions that derive a directed graph
 * from a `WorkflowDefinition` and answer "which nodes can load right now"
 * based on the shared context. The graph engine (a later phase) will drive
 * execution on top of these helpers.
 */

/** Resolve a node's module definition via the inventory. */
function resolveModule(
  node: WorkflowNode,
  inventory: ModuleInventory,
): ModuleDefinition | undefined {
  const module = inventory.getModule(node.moduleId);
  return module?.getDefinition();
}

/**
 * Normalise a workflow into a list of nodes.
 *
 * Prefers the explicit `nodes` array (Phase 2). When absent, derives nodes
 * from the legacy `steps` array so the graph helpers work with existing
 * workflows unchanged.
 */
function getNodes(workflow: WorkflowDefinition): WorkflowNode[] {
  if (workflow.nodes && workflow.nodes.length > 0) {
    return workflow.nodes;
  }
  return workflow.steps.map((step, index) => ({
    id: step.moduleId + "-" + index,
    moduleId: step.moduleId,
    label: step.label,
    description: step.description,
    auto: step.auto,
    skippable: step.skippable,
    inputMapping: step.inputMapping,
    outputMapping: step.outputMapping,
  }));
}

/**
 * Derive the directed edges of a workflow's node network.
 *
 * Edges come from two sources:
 *   1. Each node's explicit `dependsOn` array.
 *   2. Each node's module `io.required` keys — for every required key, find
 *      which other nodes' modules output that key and add an edge from them.
 *
 * If a node has no explicit `dependsOn`, its dependencies are derived purely
 * from its module's `io.required` keys (source 2).
 */
function deriveEdges(
  nodes: WorkflowNode[],
  inventory: ModuleInventory,
): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];
  const seen = new Set<string>();

  // Index: context key -> node ids whose module outputs that key.
  const outputIndex = new Map<string, string[]>();
  for (const node of nodes) {
    const def = resolveModule(node, inventory);
    if (!def) continue;
    for (const out of def.io.outputs) {
      const list = outputIndex.get(out) ?? [];
      list.push(node.id);
      outputIndex.set(out, list);
    }
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };

  for (const node of nodes) {
    const def = resolveModule(node, inventory);

    // 1. Explicit dependsOn.
    for (const dep of node.dependsOn ?? []) {
      addEdge(dep, node.id);
    }

    // 2. Derived from io.required (only when no explicit dependsOn, or always
    //    as a supplement — we always add them so the graph is complete).
    if (def) {
      for (const req of def.io.required) {
        for (const producer of outputIndex.get(req) ?? []) {
          addEdge(producer, node.id);
        }
      }
    }
  }

  return edges;
}

/**
 * Build the derived graph for a workflow.
 *
 * Nodes come from `workflow.nodes` (or are derived from `workflow.steps`).
 * Edges are derived from each node's `dependsOn` plus its module's
 * `io.required` / `io.inputs` contract, resolved via the inventory.
 */
export function buildGraph(workflow: WorkflowDefinition): WorkflowGraph {
  const nodes = getNodes(workflow);
  const edges = deriveEdges(nodes, defaultModuleInventory);
  return { nodes, edges };
}

/** True when a node's explicit + derived dependencies are all `done`. */
function dependenciesDone(
  node: WorkflowNode,
  graph: WorkflowGraph,
  nodeStates: Record<string, NodeStatus>,
): boolean {
  const deps = graph.edges
    .filter((e) => e.to === node.id)
    .map((e) => e.from);
  return deps.every((dep) => nodeStates[dep] === "done");
}

/**
 * Return the nodes that are ready to load right now.
 *
 * A node is ready when:
 *   - it is not already `done` / `skipped` / `active`,
 *   - all of its dependencies are `done`,
 *   - its module's `io.required` keys exist in the context
 *     (reuses `canRunModule` / `validate`).
 *
 * This is the core "if the context is valid the node can load" logic.
 */
export function getReadyNodes(
  graph: WorkflowGraph,
  context: ConfiguratorContext,
  nodeStates: Record<string, NodeStatus>,
): WorkflowNode[] {
  const ready: WorkflowNode[] = [];

  for (const node of graph.nodes) {
    const status = nodeStates[node.id];
    if (status === "done" || status === "skipped" || status === "active") {
      continue;
    }

    if (!dependenciesDone(node, graph, nodeStates)) {
      continue;
    }

    const def = resolveModule(node, defaultModuleInventory);
    if (!def) continue;

    const validation = canRunModule(def, context);
    if (validation.valid) {
      ready.push(node);
    }
  }

  return ready;
}

/**
 * Return the interactive (non-auto) ready nodes a user may choose next.
 *
 * This is the "mix and match" palette — the subset of ready nodes that
 * require user interaction (as opposed to `auto` nodes that run by
 * themselves).
 */
export function getValidNextModules(
  graph: WorkflowGraph,
  context: ConfiguratorContext,
  nodeStates: Record<string, NodeStatus>,
): WorkflowNode[] {
  return getReadyNodes(graph, context, nodeStates).filter(
    (node) => node.auto !== true,
  );
}

/**
 * True when every node in the graph is `done` or `skipped`.
 */
export function isComplete(
  graph: WorkflowGraph,
  nodeStates: Record<string, NodeStatus>,
): boolean {
  return graph.nodes.every(
    (node) =>
      nodeStates[node.id] === "done" || nodeStates[node.id] === "skipped",
  );
}

/**
 * Validate a workflow's node network.
 *
 * Checks that:
 *   - every node's `moduleId` is registered,
 *   - the dependency chain is acyclic,
 *   - every node's `io.required` keys are satisfiable by either a dependency
 *     (a node that outputs the key) or a seeded context key.
 *
 * Returns `{ valid, errors }`.
 */
export function validateGraph(
  workflow: WorkflowDefinition,
  seed?: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodes = getNodes(workflow);
  const inventory = defaultModuleInventory;

  // 1. Every moduleId registered.
  for (const node of nodes) {
    if (!inventory.getModule(node.moduleId)) {
      errors.push(
        `Node "${node.label}" references unknown module: "${node.moduleId}"`,
      );
    }
  }

  // 2. Acyclic dependency chain (DFS with a visited stack).
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, node.dependsOn ?? []);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      const cycle = [...path, id].join(" -> ");
      errors.push(`Dependency cycle detected: ${cycle}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of adjacency.get(id) ?? []) {
      visit(dep, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) {
    visit(node.id, []);
  }

  // 3. Every required key satisfiable by a dependency or seed.
  const available = new Set<string>(seed ?? []);
  const outputIndex = new Map<string, string[]>();
  for (const node of nodes) {
    const def = resolveModule(node, inventory);
    if (!def) continue;
    for (const out of def.io.outputs) {
      const list = outputIndex.get(out) ?? [];
      list.push(node.id);
      outputIndex.set(out, list);
    }
  }
  for (const node of nodes) {
    const def = resolveModule(node, inventory);
    if (!def) continue;
    for (const req of def.io.required) {
      const producers = outputIndex.get(req) ?? [];
      const producedByDependency = producers.some((producer) =>
        (node.dependsOn ?? []).includes(producer),
      );
      if (!available.has(req) && !producedByDependency) {
        errors.push(
          `Node "${node.label}" requires "${req}" but it is not produced by a dependency or seeded`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
