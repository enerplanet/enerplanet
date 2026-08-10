import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@spatialhub/ui";
import { MODELBUILDER_ENABLED } from "./flags";
import { ModelBuilderConfigurator } from "./ModelBuilderConfigurator";
import { WorkflowBuilder } from "./workflow/WorkflowBuilder";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";
import { defaultWorkflow } from "./workflows/defaultWorkflow";
import type { WorkflowDefinition } from "./types/workflow";

/**
 * Route page for the ModelBuilder feature.
 *
 * Offers two views behind a simple tab toggle:
 * - **Configurator** — the playback shell for a workflow
 * - **Builder** — the admin UI to compose/validate/import/export workflows
 *
 * If the feature flag is disabled, shows a placeholder instead of mounting
 * either view.
 */
export default function ModelBuilderPage() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition>(defaultWorkflow);

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

  return (
    <Tabs defaultValue="configurator" className="mx-auto max-w-6xl p-6">
      <TabsList>
        <TabsTrigger value="configurator">Configurator</TabsTrigger>
        <TabsTrigger value="builder">Workflow Builder</TabsTrigger>
      </TabsList>

      <TabsContent value="configurator">
        <ModelBuilderConfigurator
          workflow={activeWorkflow}
          onStartWorkflow={(next) => setActiveWorkflow(next)}
        />
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
