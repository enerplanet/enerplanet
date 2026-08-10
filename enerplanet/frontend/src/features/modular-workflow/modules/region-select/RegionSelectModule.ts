import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";

/**
 * Example module — Region Selection.
 *
 * Demonstrates the BaseModule template:
 *   - reads nothing from context (inputs: [])
 *   - writes `region` and `polygons` to context (outputs)
 *   - requires nothing to run (required: [])
 */
export class RegionSelectModule extends BaseModule {
  readonly meta = {
    id: "region-select",
    name: "Region Selection",
    description: "Select a country, state, and draw the area boundary.",
    icon: "map",
    category: "input" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: [],
    outputs: ["region", "polygons"],
    required: [],
  };

  readonly component = RegionSelectComponent;

  // Custom validation: a region must be selected before proceeding.
  override validate(context: ConfiguratorContext) {
    if (!context.region) {
      return { valid: false, errors: ["No region selected yet."] };
    }
    return { valid: true };
  }
}

function RegionSelectComponent({ context, onUpdate }: ModuleProps) {
  // In a real implementation this would render the map / region picker and
  // call onUpdate({ region, polygons }) when the user makes a selection.
  void context;
  void onUpdate;
  return null;
}

export const regionSelectModule = new RegionSelectModule();
