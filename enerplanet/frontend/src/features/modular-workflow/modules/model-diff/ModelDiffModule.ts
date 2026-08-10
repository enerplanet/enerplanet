import { BaseModule } from "../base/BaseModule";
import { ModelDiffViewer } from "./ModelDiffViewer";

/**
 * Model YAML Diff module.
 *
 * Renders the full model as YAML and shows a diff (A → B) of changes made by
 * the current workflow step. Per §9.6 this module is automatically appended to
 * every workflow step — it is not a user-visible step in the progress bar but
 * renders as a collapsible panel at the bottom of the ModelBuilder shell.
 */
export class ModelDiffModule extends BaseModule {
  readonly meta = {
    id: "model-diff",
    name: "Model YAML Diff",
    description: "View and edit the raw model definition as YAML.",
    icon: "file-code",
    category: "analysis" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: ["modelYaml"],
    outputs: ["modelYaml", "previousModelYaml", "modelYamlEditMode"],
    required: [],
  };

  readonly component = ModelDiffViewer;
}

export const modelDiffModule = new ModelDiffModule();

// Re-export the viewer for direct use in the shell.
export { ModelDiffViewer } from "./ModelDiffViewer";
