import type { WorkflowDefinition } from "../types/workflow";
import fullEnergyPlanning from "./full-energy-planning.json";

/**
 * All default workflows available in the ModelBuilder.
 */
export const defaultWorkflows: WorkflowDefinition[] = [
  fullEnergyPlanning as WorkflowDefinition,
];

export { defaultWorkflow } from "./defaultWorkflow";
