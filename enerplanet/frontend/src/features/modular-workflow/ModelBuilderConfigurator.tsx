import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Badge, Separator } from "@spatialhub/ui";
import { ChevronLeft, ChevronRight, RotateCcw, CheckCircle2 } from "lucide-react";
import type { ConfiguratorContext } from "./types/context";
import type { ModuleComplexity, ModuleProps } from "./types/module";
import type { WorkflowDefinition } from "./types/workflow";
import { WorkflowEngine } from "./workflow/WorkflowEngine";
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
}: ModelBuilderConfiguratorProps) {
  return (
    <ModelBuilderContextProvider initialContext={initialContext}>
      <ModelBuilderConfiguratorInner workflow={workflow} inventory={inventory} />
    </ModelBuilderContextProvider>
  );
}

function ModelBuilderConfiguratorInner({
  workflow,
  inventory,
}: {
  workflow: WorkflowDefinition;
  inventory?: import("./modules/ModuleInventory").ModuleInventory;
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

  if (completed) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <h2 className="text-xl font-semibold">Workflow complete</h2>
          <p className="text-sm text-muted-foreground">"{workflow.name}" finished successfully.</p>
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
