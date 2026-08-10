import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";

/**
 * Example module — Grid Generation.
 *
 * Demonstrates a module that reads from context (`polygons`, `advancedParams`)
 * and writes results back (`gridData`, `gridResultIds`).
 */
export class GridGenerationModule extends BaseModule {
  readonly meta = {
    id: "grid-generation",
    name: "Grid Generation",
    description: "Generate the low-voltage grid for the selected area.",
    icon: "grid",
    category: "simulation" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["polygons", "advancedParams"],
    outputs: ["gridData", "gridResultIds"],
    required: ["polygons"],
  };

  readonly component = GridGenerationComponent;

  // Called when entering the step — e.g. trigger the auto-run.
  override async onEnter(context: ConfiguratorContext): Promise<void> {
    // In a real implementation this would call pylovoService.generateGrid()
    // and write the result into context via onUpdate.
    void context;
  }
}

function GridGenerationComponent({ context, onUpdate }: ModuleProps) {
  // Auto-step: reads inputs from context, runs the service, writes outputs.
  void context;
  void onUpdate;
  return null;
}

export const gridGenerationModule = new GridGenerationModule();
