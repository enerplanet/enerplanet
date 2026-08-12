import type { WorkflowDefinition } from "./types/workflow";
import type { ConfiguratorContext } from "./types/context";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";

export interface ModelBuilderLandingProps {
  /** All workflows to offer. Defaults to the registry's full set. */
  workflows?: WorkflowDefinition[];
  /** Called when the user starts a workflow. */
  onStart: (workflow: WorkflowDefinition, initialContext?: ConfiguratorContext) => void;
}

/**
 * Landing screen for the ModelBuilder.
 *
 * Lists every runnable workflow. Each workflow starts with a model-import
 * module that asks whether to load an existing model into the context.
 * If yes, the model is loaded; if no, the workflow proceeds with an empty
 * context. Users can skip or redo steps and change data at any point.
 */
export function ModelBuilderLanding({
  workflows = defaultWorkflowRegistry.getAll(),
  onStart,
}: ModelBuilderLandingProps) {
  const handleStart = (workflow: WorkflowDefinition) => {
    onStart(workflow);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Model Builder</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a workflow to generate a new model or modify an existing one. Each workflow begins
          by asking whether you'd like to import an existing model into the context.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workflows.map((workflow) => (
          <div
            key={workflow.id}
            className="flex flex-col rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{workflow.name}</h3>
            </div>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{workflow.description}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {workflow.tags?.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
            <button
              className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              onClick={() => handleStart(workflow)}
            >
              Start
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
