import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@spatialhub/ui";
import { MODELBUILDER_ENABLED } from "./flags";
import { ModelBuilderConfigurator } from "./ModelBuilderConfigurator";
import { ModelBuilderLanding } from "./ModelBuilderLanding";
import { WorkflowBuilder } from "./workflow/WorkflowBuilder";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";
import { hasFlowSnapshot, loadFlowSnapshot, clearFlowSnapshot } from "./workflow/FlowPersistence";
import type { WorkflowDefinition } from "./types/workflow";
import type { ConfiguratorContext } from "./types/context";

/**
 * Route page for the ModelBuilder feature.
 *
 * Three views behind a tab toggle:
 * - **Landing** — the workflow picker (default). Lists all runnable workflows.
 *   Each workflow starts with a model-import module that asks whether to load
 *   an existing model into the context.
 * - **Configurator** — the playback shell for the active workflow.
 * - **Builder** — the admin UI to compose/validate/import/export workflows.
 *
 * If the feature flag is disabled, shows a placeholder instead of mounting
 * either view.
 *
 * On mount, if a persisted flow snapshot exists (Phase 6), the page offers to
 * resume the previous flow: it looks up the workflow by `workflowId` and seeds
 * the configurator with the snapshot's context + node states. Declining clears
 * the snapshot.
 */
export default function ModelBuilderPage() {
  const [activeTab, setActiveTab] = useState("landing");
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [initialContext, setInitialContext] = useState<ConfiguratorContext | undefined>(undefined);
  // A resumable snapshot found on mount, offered to the user via a banner.
  const [resumeOffer, setResumeOffer] = useState<{
    workflow: WorkflowDefinition;
    context: ConfiguratorContext;
    savedAt: string;
  } | null>(null);

  // On mount, check for a persisted flow snapshot and offer to resume it.
  useEffect(() => {
    if (!hasFlowSnapshot()) return;
    const snapshot = loadFlowSnapshot();
    if (!snapshot) return;
    const workflow = defaultWorkflowRegistry.get(snapshot.workflowId);
    if (!workflow) {
      // The workflow no longer exists — the snapshot is stale, drop it.
      clearFlowSnapshot();
      return;
    }
    setResumeOffer({
      workflow,
      context: {
        ...snapshot.context,
        nodeStates: snapshot.nodeStates,
      },
      savedAt: snapshot.savedAt,
    });
  }, []);

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

  const handleResume = () => {
    if (!resumeOffer) return;
    setActiveWorkflow(resumeOffer.workflow);
    setInitialContext(resumeOffer.context);
    setResumeOffer(null);
    setActiveTab("configurator");
  };

  const handleDismissResume = () => {
    clearFlowSnapshot();
    setResumeOffer(null);
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-auto max-w-6xl p-6">
      <TabsList>
        <TabsTrigger value="landing">Workflows</TabsTrigger>
        <TabsTrigger value="configurator">Configurator</TabsTrigger>
        <TabsTrigger value="builder">Workflow Builder</TabsTrigger>
      </TabsList>

      {resumeOffer && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Resume previous flow?</p>
            <p className="text-sm text-muted-foreground">
              You have an unfinished{" "}
              <span className="font-medium text-foreground">{resumeOffer.workflow.name}</span> flow
              saved on {new Date(resumeOffer.savedAt).toLocaleString()}. Pick up where you left off.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleResume}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={handleDismissResume}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
