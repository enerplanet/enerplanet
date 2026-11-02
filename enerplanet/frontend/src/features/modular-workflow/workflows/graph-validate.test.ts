import { describe, it, expect } from "vitest";
import { validateGraph } from "../workflow/WorkflowGraph";
import fullEnergyPlanning from "./full-energy-planning.json";
import { defaultWorkflow } from "./defaultWorkflow";
import type { WorkflowDefinition } from "../types/workflow";

const workflows: Array<{ name: string; wf: WorkflowDefinition }> = [
  { name: "full-energy-planning", wf: fullEnergyPlanning as WorkflowDefinition },
  { name: "defaultWorkflow", wf: defaultWorkflow },
];

describe("workflow graph validation", () => {
  for (const { name, wf } of workflows) {
    it(`${name} validates`, () => {
      const result = validateGraph(wf);
      expect(result.errors).toEqual([]);
    });
  }
});
