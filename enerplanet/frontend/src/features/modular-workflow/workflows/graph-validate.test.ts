import { describe, it, expect } from "vitest";
import { validateGraph } from "../workflow/WorkflowGraph";
import quickGridAnalysis from "./quick-grid-analysis.json";
import fullEnergyPlanning from "./full-energy-planning.json";
import costOptimization from "./cost-optimization.json";
import { defaultWorkflow } from "./defaultWorkflow";
import type { WorkflowDefinition } from "../types/workflow";

const workflows: Array<{ name: string; wf: WorkflowDefinition; seed?: string[] }> = [
  { name: "quick-grid-analysis", wf: quickGridAnalysis as WorkflowDefinition },
  { name: "full-energy-planning", wf: fullEnergyPlanning as WorkflowDefinition },
  // polygons/region/grid seeded by the model-load entry module
  {
    name: "cost-optimization",
    wf: costOptimization as WorkflowDefinition,
    seed: ["polygons", "region", "gridData", "gridResultIds"],
  },
  { name: "defaultWorkflow", wf: defaultWorkflow },
];

describe("workflow graph validation", () => {
  for (const { name, wf, seed } of workflows) {
    it(`${name} validates`, () => {
      const result = validateGraph(wf, seed);
      expect(result.errors).toEqual([]);
    });
  }
});
