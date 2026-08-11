import type { WorkflowDefinition } from "../types/workflow";

/**
 * Default workflow used when mounting the ModelBuilder on its own route.
 *
 * Uses the modules currently registered in the prototype inventory
 * (`region-select`, `grid-generation`, `model-diff`). The `model-diff` module
 * is not a user-visible step — it renders as the collapsible YAML panel at the
 * bottom of every step, so it is intentionally omitted from `steps`.
 */
export const defaultWorkflow: WorkflowDefinition = {
  id: "quick-grid-analysis",
  name: "Quick Grid Analysis",
  description: "Select a region, generate a grid, and inspect the model YAML.",
  version: "1.0.0",
  startType: "from-scratch",
  tags: ["quick", "grid"],
  followUpWorkflows: ["full-energy-planning"],
  steps: [
    { moduleId: "region-select", label: "Select Region", skippable: false },
    { moduleId: "grid-generation", label: "Generate Grid", auto: true },
  ],
  nodes: [
    {
      id: "region-select",
      moduleId: "region-select",
      label: "Select Region",
      skippable: false,
    },
    {
      id: "grid-generation",
      moduleId: "grid-generation",
      label: "Generate Grid",
      dependsOn: ["region-select"],
      auto: true,
    },
  ],
};
