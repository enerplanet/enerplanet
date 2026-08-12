/**
 * Built-in workflow definitions (Plan P2, README_V2 §2.1/§2.3).
 *
 * These ship hardcoded in the frontend until the workflows API lands
 * (see BACKEND_REQUIREMENTS.md §2). They are plain data — the future
 * React Flow admin editor will produce exactly this shape.
 */
import type { WorkflowDefinition } from "../types";

/** Default planning workflow: A→F from the README. */
export const defaultPlanningWorkflow: WorkflowDefinition = {
  id: "default-planning",
  version: 1,
  name: "Default Planning",
  start: "null",
  nodes: [
    { id: "model-settings", type: "module:model-settings" },
    { id: "area-grid", type: "module:area-grid" },
    { id: "demand", type: "module:demand" },
    { id: "technologies", type: "module:technologies" },
    { id: "run", type: "module:run" },
    { id: "results", type: "module:results" },
  ],
};

/**
 * Optimization workflow: starts from an existing context (context-load),
 * re-runs demand/tech/run with the goal stored in meta.optimizationGoal.
 * Grid is reused from the loaded context (autofill inserts area-grid only
 * if the load lacked it).
 */
export const optimizationWorkflow: WorkflowDefinition = {
  id: "optimization",
  version: 1,
  name: "Optimization",
  start: "context-load",
  nodes: [
    { id: "model-settings", type: "module:model-settings" },
    { id: "demand", type: "module:demand" },
    { id: "technologies", type: "module:technologies" },
    { id: "run", type: "module:run" },
    { id: "results", type: "module:results" },
  ],
};

export const builtinWorkflows: WorkflowDefinition[] = [defaultPlanningWorkflow, optimizationWorkflow];

export function getBuiltinWorkflow(id: string): WorkflowDefinition {
  const wf = builtinWorkflows.find((w) => w.id === id);
  if (!wf) throw new Error(`Unknown workflow: ${id}`);
  return wf;
}
