import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Badge, Separator } from "@spatialhub/ui";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  LayoutDashboard,
  List,
  Play,
} from "lucide-react";
import type { ConfiguratorContext } from "./types/context";
import type { ModuleComplexity, ModuleProps } from "./types/module";
import type { WorkflowDefinition } from "./types/workflow";
import { WorkflowEngine } from "./workflow/WorkflowEngine";
import { defaultWorkflowRecommender } from "./workflow/WorkflowRecommender";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";
import { ModelBuilderContextProvider } from "./context/ModelBuilderContext";
import { useModelBuilderContext } from "./context/useModelBuilderContext";
import { ModelDiffViewer } from "./modules/model-diff/ModelDiffViewer";
import { serialiseModel } from "./modules/model-diff/serialiseModel";

export interface ModelBuilderConfiguratorProps {
  /** The workflow to play back. */
  workflow: WorkflowDefinition;
  /** Optional initial context state. */
  initialContext?: ConfiguratorContext;
  /** Optional module inventory override (defaults to the shared singleton). */
  inventory?: import("./modules/ModuleInventory").ModuleInventory;
  /** Called when the user chooses "Stop — go to dashboard". */
  onStop?: () => void;
  /** Called when the user chooses "Browse all workflows". */
  onBrowseAll?: () => void;
  /** Called when the user starts a recommended workflow. */
  onStartWorkflow?: (workflow: WorkflowDefinition) => void;
}

/**
 * Top-level playback shell for a workflow.
 *
 * Renders the active module's component inside a consistent shell with a step
 * progress bar, a global Basic/Expert toggle, Back/Next navigation, a
 * collapsible context summary, and a collapsible YAML diff panel at the bottom.
 */
export function ModelBuilderConfigurator({
  workflow,
  initialContext,
  inventory,
  onStop,
  onBrowseAll,
  onStartWorkflow,
}: ModelBuilderConfiguratorProps) {
  return (
    <ModelBuilderContextProvider initialContext={initialContext}>
      <ModelBuilderConfiguratorInner
        workflow={workflow}
        inventory={inventory}
        onStop={onStop}
        onBrowseAll={onBrowseAll}
        onStartWorkflow={onStartWorkflow}
      />
    </ModelBuilderContextProvider>
  );
}

function ModelBuilderConfiguratorInner({
  workflow,
  inventory,
  onStop,
  onBrowseAll,
  onStartWorkflow,
}: {
  workflow: WorkflowDefinition;
  inventory?: import("./modules/ModuleInventory").ModuleInventory;
  onStop?: () => void;
  onBrowseAll?: () => void;
  onStartWorkflow?: (workflow: WorkflowDefinition) => void;
}) {
  const { context, onUpdate, setUiMode, snapshot, reset } = useModelBuilderContext();
  // The engine owns the working context for navigation. We keep it in a ref
  // so it survives re-renders without being recreated.
  const engineRef = useRef<WorkflowEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new WorkflowEngine(workflow, context, {
      inventory,
      onContextChange: (engineContext) => {
        // Sync engine context back into the React provider.
        onUpdate(engineContext);
      },
    });
  }
  const engine = engineRef.current;

  // Force a re-render when the engine advances so the shell reflects the new
  // current step. We track the current index in local state.
  const [stepIndex, setStepIndex] = useState(engine.getCurrentIndex());
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showContextSummary, setShowContextSummary] = useState(false);

  // Recompute on every render — the component re-renders when `stepIndex`
  // changes, so this always reflects the engine's current step.
  let currentModule: import("./types/module").ModuleDefinition | null = null;
  try {
    currentModule = engine.getCurrentModule();
  } catch {
    currentModule = null;
  }

  const currentStep = engine.getCurrentStep();
  const progress = engine.getProgress();
  const complexity: ModuleComplexity = context.uiMode ?? "basic";

  // Snapshot the current context before the workflow run (data handoff rule 4)
  // and serialise the initial model YAML.
  useEffect(() => {
    snapshot();
    onUpdate({ modelYaml: serialiseModel(context) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the engine's context whenever the React context changes (e.g. a
  // module called onUpdate). This keeps the engine's working copy in sync.
  useEffect(() => {
    engine.updateContext(context);
  }, [context, engine]);

  const handleModuleUpdate = useCallback(
    (updates: Partial<ConfiguratorContext>) => {
      onUpdate(updates);
      engine.updateContext(updates);
    },
    [onUpdate, engine]
  );

  const handleComplexityChange = useCallback(
    (mode: ModuleComplexity) => {
      setUiMode(mode);
    },
    [setUiMode]
  );

  const handleNext = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await engine.next();
      setStepIndex(engine.getCurrentIndex());
      if (engine.isComplete()) {
        setCompleted(true);
      }
      // Regenerate the model YAML after the step and preserve the previous.
      onUpdate({
        previousModelYaml: context.modelYaml,
        modelYaml: serialiseModel(engine.getContext()),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [engine, onUpdate, context.modelYaml]);

  const handlePrevious = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await engine.previous();
      setStepIndex(engine.getCurrentIndex());
      setCompleted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [engine]);

  const handleReset = useCallback(() => {
    reset();
    setCompleted(false);
    setError(null);
    setStepIndex(0);
  }, [reset]);

  const moduleProps: ModuleProps = {
    context,
    onUpdate: handleModuleUpdate,
    complexity,
    onComplexityChange: handleComplexityChange,
  };

  // Recommended follow-up workflows for the completion screen. Resolved against
  // the default registry so follow-up IDs become real workflow definitions.
  const recommendations = useMemo(
    () =>
      defaultWorkflowRecommender.getRecommendations(
        context,
        workflow.id,
        defaultWorkflowRegistry.getAll()
      ),
    [context, workflow.id]
  );

  const handleStartWorkflow = useCallback(
    (next: WorkflowDefinition) => {
      if (onStartWorkflow) {
        onStartWorkflow(next);
        return;
      }
      // Fallback: restart the engine with the selected workflow in place.
      reset();
      setCompleted(false);
      setError(null);
      setStepIndex(0);
      engineRef.current = new WorkflowEngine(next, context, {
        inventory,
        onContextChange: (engineContext) => onUpdate(engineContext),
      });
      setStepIndex(0);
    },
    [onStartWorkflow, reset, context, inventory, onUpdate]
  );

  if (completed) {
    const stepsCompleted = workflow.steps.length;
    const { gridStatistics, powerFlowResult, costBreakdown } = context;
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <h2 className="text-xl font-semibold">Workflow complete</h2>
          <p className="text-sm text-muted-foreground">"{workflow.name}" finished successfully.</p>

          {/* Summary of what was done */}
          <div className="w-full rounded-lg border border-border bg-muted/30 p-4 text-left">
            <h3 className="text-sm font-semibold">Summary</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">{workflow.name}</span> —{" "}
                {stepsCompleted} step{stepsCompleted === 1 ? "" : "s"} completed
              </li>
              {workflow.tags && workflow.tags.length > 0 && (
                <li>
                  Tags:{" "}
                  {workflow.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="mr-1">
                      {t}
                    </Badge>
                  ))}
                </li>
              )}
            </ul>
          </div>

          {/* Key results / metrics */}
          {(gridStatistics || powerFlowResult || costBreakdown) && (
            <div className="w-full rounded-lg border border-border bg-muted/30 p-4 text-left">
              <h3 className="text-sm font-semibold">Key results</h3>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {gridStatistics && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Buildings</dt>
                      <dd className="font-medium">{gridStatistics.buildings.count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Transformers</dt>
                      <dd className="font-medium">{gridStatistics.transformers.count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Cable length</dt>
                      <dd className="font-medium">
                        {gridStatistics.cables.total_length_km.toFixed(2)} km
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Est. cost</dt>
                      <dd className="font-medium">
                        {gridStatistics.costs.total_estimated_cost_eur.toLocaleString()} €
                      </dd>
                    </div>
                  </>
                )}
                {powerFlowResult && (
                  <div>
                    <dt className="text-muted-foreground">Power flow</dt>
                    <dd className="font-medium">
                      {powerFlowResult.converged ? "Converged" : "Not converged"}
                      {powerFlowResult.summary
                        ? ` · ${powerFlowResult.summary.max_line_loading_percent.toFixed(1)}% max line load`
                        : ""}
                    </dd>
                  </div>
                )}
                {costBreakdown && costBreakdown.length > 0 && (
                  <div>
                    <dt className="text-muted-foreground">Cost breakdown</dt>
                    <dd className="font-medium">
                      {costBreakdown.length} categor{costBreakdown.length === 1 ? "y" : "ies"}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* What would you like to do? */}
          <div className="w-full rounded-lg border border-border p-4 text-left">
            <h3 className="text-sm font-semibold">What would you like to do?</h3>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="outline" onClick={onStop}>
                <LayoutDashboard className="mr-2 h-4 w-4" /> Stop — go to dashboard
              </Button>
              {recommendations.map((rec) => (
                <Button key={rec.id} variant="default" onClick={() => handleStartWorkflow(rec)}>
                  <Play className="mr-2 h-4 w-4" /> {rec.name}
                </Button>
              ))}
              <Button variant="ghost" onClick={onBrowseAll}>
                <List className="mr-2 h-4 w-4" /> Browse all workflows
              </Button>
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Start over
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header: progress bar + mode toggle */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">{workflow.name}</span>
            <span className="text-muted-foreground">
              Step {progress.current} / {progress.total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Button
            variant={complexity === "basic" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleComplexityChange("basic")}
          >
            Basic
          </Button>
          <Button
            variant={complexity === "expert" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleComplexityChange("expert")}
          >
            Expert
          </Button>
        </div>
      </div>

      {/* Step label */}
      <div className="mb-4">
        <h1 className="text-lg font-semibold">{currentStep?.label}</h1>
        {currentStep?.description && (
          <p className="text-sm text-muted-foreground">{currentStep.description}</p>
        )}
        {currentModule && (
          <Badge variant="secondary" className="mt-1">
            {currentModule.meta.name}
          </Badge>
        )}
      </div>

      {/* Module component */}
      <div className="rounded-lg border border-border bg-card p-4">
        {currentModule ? (
          <currentModule.component {...moduleProps} />
        ) : (
          <p className="text-sm text-muted-foreground">Module not found for this step.</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-4 flex items-center justify-between">
        <Button variant="outline" onClick={handlePrevious} disabled={stepIndex === 0 || busy}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handleNext} disabled={busy}>
          {busy ? "Working…" : "Next"} <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <Separator className="my-4" />

      {/* Context summary (collapsible) */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowContextSummary((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <span>Context Summary</span>
          <span>{showContextSummary ? "Hide" : "Show"}</span>
        </button>
        {showContextSummary && (
          <pre className="mt-2 max-h-[240px] overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
            {JSON.stringify(context, null, 2)}
          </pre>
        )}
      </div>

      {/* YAML diff panel (rendered by the model-diff module) */}
      <ModelDiffViewer
        context={context}
        onUpdate={handleModuleUpdate}
        complexity={complexity}
        onComplexityChange={handleComplexityChange}
      />
    </div>
  );
}
