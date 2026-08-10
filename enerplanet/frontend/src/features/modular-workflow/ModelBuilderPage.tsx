import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@spatialhub/ui";
import { MODELBUILDER_ENABLED } from "./flags";
import { ModelBuilderConfigurator } from "./ModelBuilderConfigurator";
import { ModelBuilderLanding } from "./ModelBuilderLanding";
import { WorkflowBuilder } from "./workflow/WorkflowBuilder";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";
import type { WorkflowDefinition } from "./types/workflow";
import type { ConfiguratorContext } from "./types/context";

/**
 * Route page for the ModelBuilder feature.
 *
 * Three views behind a tab toggle:
 * - **Landing** — the model-aware workflow picker (default). Shows all runnable
 *   workflows, gated on whether an existing model is available. Starting a
 *   `from-existing-model` workflow loads the selected model into context first.
 * - **Configurator** — the playback shell for the active workflow.
 * - **Builder** — the admin UI to compose/validate/import/export workflows.
 *
 * If the feature flag is disabled, shows a placeholder instead of mounting
 * either view.
 */
export default function ModelBuilderPage() {
  const [activeTab, setActiveTab] = useState("landing");
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [initialContext, setInitialContext] = useState<ConfiguratorContext | undefined>(undefined);

  if (!MODELBUILDER_ENABLED) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <h2 className="text-lg font-semibold">ModelBuilder</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This feature is not enabled. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              VITE_MODELBUILDER_ENABLED=true
            </code>{" "}
            to enable it.
          </p>
        </div>
      </div>
    );
  }

  const handleStart = (workflow: WorkflowDefinition, context?: ConfiguratorContext) => {
    setActiveWorkflow(workflow);
    setInitialContext(context);
    setActiveTab("configurator");
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-auto max-w-6xl p-6">
      <TabsList>
        <TabsTrigger value="landing">Workflows</TabsTrigger>
        <TabsTrigger value="configurator">Configurator</TabsTrigger>
        <TabsTrigger value="builder">Workflow Builder</TabsTrigger>
      </TabsList>

      <TabsContent value="landing">
        <ModelBuilderLanding workflows={defaultWorkflowRegistry.getAll()} onStart={handleStart} />
      </TabsContent>

      <TabsContent value="configurator">
        {activeWorkflow ? (
          <ModelBuilderConfigurator
            workflow={activeWorkflow}
            initialContext={initialContext}
            onStartWorkflow={(next) => setActiveWorkflow(next)}
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No workflow selected. Pick one from the Workflows tab to begin.
          </div>
        )}
      </TabsContent>

      <TabsContent value="builder">
        <WorkflowBuilder
          registry={defaultWorkflowRegistry}
          onRegistered={(workflow) => setActiveWorkflow(workflow)}
        />
      </TabsContent>
    </Tabs>
  );
}
