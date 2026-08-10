import type { WorkflowDefinition } from "../types/workflow";
import quickGridAnalysis from "./quick-grid-analysis.json";
import fullEnergyPlanning from "./full-energy-planning.json";
import evHostingAnalysis from "./ev-hosting-analysis.json";
import costOptimization from "./cost-optimization.json";

/**
 * All default workflows available in the ModelBuilder.
 */
export const defaultWorkflows: WorkflowDefinition[] = [
  quickGridAnalysis as WorkflowDefinition,
  fullEnergyPlanning as WorkflowDefinition,
  evHostingAnalysis as WorkflowDefinition,
  costOptimization as WorkflowDefinition,
];

export { defaultWorkflow } from "./defaultWorkflow";
