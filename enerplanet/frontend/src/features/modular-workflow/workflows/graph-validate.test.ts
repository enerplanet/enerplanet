import { describe, it, expect } from "vitest";
import { validateGraph } from "../workflow/WorkflowGraph";
import quickGridAnalysis from "./quick-grid-analysis.json";
import fullEnergyPlanning from "./full-energy-planning.json";
import evHostingAnalysis from "./ev-hosting-analysis.json";
import costOptimization from "./cost-optimization.json";
import { defaultWorkflow } from "./defaultWorkflow";
import type { WorkflowDefinition } from "../types/workflow";

const workflows: Array<{ name: string; wf: WorkflowDefinition; seed?: string[] }> = [
  { name: "quick-grid-analysis", wf: quickGridAnalysis as WorkflowDefinition },
  { name: "full-energy-planning", wf: fullEnergyPlanning as WorkflowDefinition },
  { name: "ev-hosting-analysis", wf: evHostingAnalysis as WorkflowDefinition },
  // from-existing-model: polygons/region seeded by model-load
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
