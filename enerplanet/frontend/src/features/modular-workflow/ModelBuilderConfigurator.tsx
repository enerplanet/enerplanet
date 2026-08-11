import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Badge, Separator } from "@spatialhub/ui";
import {
  RotateCcw,
  CheckCircle2,
  LayoutDashboard,
  List,
  Play,
  SkipForward,
  Check,
  Circle,
  CircleDot,
  CircleCheck,
  CircleSlash,
  CircleAlert,
} from "lucide-react";
import type { ConfiguratorContext } from "./types/context";
import type { ModuleComplexity, ModuleProps } from "./types/module";
import type { NodeStatus, WorkflowDefinition } from "./types/workflow";
import { NodeEngine } from "./workflow/NodeEngine";
import { defaultWorkflowRecommender } from "./workflow/WorkflowRecommender";
import { defaultWorkflowRegistry } from "./workflow/WorkflowRegistry";
import { saveFlowSnapshot, clearFlowSnapshot } from "./workflow/FlowPersistence";
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
 * Drives the graph-aware `NodeEngine` instead of the linear `WorkflowEngine`.
 * Renders the active node's module inside a consistent shell with a node
 * progress bar, a node palette (all nodes + their status), an "Available next"
 * mix-and-match list, Complete/Skip actions, a global Basic/Expert toggle, a
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
  const engineRef = useRef<NodeEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new NodeEngine(workflow, context, {
      inventory,
      onContextChange: (engineContext) => {
        // Sync engine context back into the React provider.
        onUpdate(engineContext);
      },
    });
  }
  const engine = engineRef.current;

  // Force a re-render whenever the engine advances so the shell reflects the
  // new active node / node states. We bump a tick counter after each mutation.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showContextSummary, setShowContextSummary] = useState(false);

  // Recompute on every render — the component re-renders when `tick` changes,
  // so these always reflect the engine's current state.
  const activeNode = engine.getActiveNode();
  const activeModule = engine.getActiveModule();
  const nodeStates = engine.getNodeStates();
  const graph = engine.getGraph();
  const validNext = engine.getValidNextModules();
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
    void engine.updateContext(context);
  }, [context, engine]);

  // Persist the flow state to localStorage on every context change so it is
  // not discarded if the user leaves, loses connection, or exits while waiting
  // on a long model run. Lightly debounced to avoid excessive writes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveFlowSnapshot({
        workflowId: workflow.id,
        workflowVersion: workflow.version ? Number(workflow.version) : undefined,
        context,
        nodeStates,
        savedAt: new Date().toISOString(),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [context, nodeStates, workflow.id, workflow.version]);

  // Once the flow is complete, the state is no longer needed — clear the
  // persisted snapshot so a stale flow is not offered for resume later.
  useEffect(() => {
    if (completed) {
      clearFlowSnapshot();
    }
  }, [completed]);

  const handleModuleUpdate = useCallback(
    (updates: Partial<ConfiguratorContext>) => {
      onUpdate(updates);
      void engine.updateContext(updates);
    },
    [onUpdate, engine]
  );

  const handleComplexityChange = useCallback(
    (mode: ModuleComplexity) => {
      setUiMode(mode);
    },
    [setUiMode]
  );

  const handleActivateNode = useCallback(
    async (nodeId: string) => {
      setError(null);
      setBusy(true);
      try {
        await engine.activateNode(nodeId);
        bump();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [engine, bump]
  );

  const handleComplete = useCallback(async () => {
    const node = engine.getActiveNode();
    if (!node) return;
    setError(null);
    setBusy(true);
    try {
      await engine.completeNode(node.id);
      // Regenerate the model YAML after the step and preserve the previous.
      onUpdate({
        previousModelYaml: context.modelYaml,
        modelYaml: serialiseModel(engine.getContext()),
      });
      if (engine.isComplete()) {
        setCompleted(true);
      }
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [engine, onUpdate, context.modelYaml, bump]);

  const handleSkip = useCallback(async () => {
    const node = engine.getActiveNode();
    if (!node) return;
    setError(null);
    setBusy(true);
    try {
      await engine.skipNode(node.id);
      if (engine.isComplete()) {
        setCompleted(true);
      }
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [engine, bump]);

  const handleReset = useCallback(() => {
    reset();
    setCompleted(false);
    setError(null);
    engineRef.current = new NodeEngine(
      workflow,
      {},
      {
        inventory,
        onContextChange: (engineContext) => onUpdate(engineContext),
      }
    );
    bump();
  }, [reset, workflow, inventory, onUpdate, bump]);

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
      engineRef.current = new NodeEngine(next, context, {
        inventory,
        onContextChange: (engineContext) => onUpdate(engineContext),
      });
      bump();
    },
    [onStartWorkflow, reset, context, inventory, onUpdate, bump]
  );

  if (completed) {
    const nodesCompleted = graph.nodes.length;
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
                {nodesCompleted} node{nodesCompleted === 1 ? "" : "s"} completed
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
              {progress.current} / {progress.total} nodes
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

      {/* Active node label */}
      <div className="mb-4">
        <h1 className="text-lg font-semibold">{activeNode?.label ?? "No active node"}</h1>
        {activeNode?.description && (
          <p className="text-sm text-muted-foreground">{activeNode.description}</p>
        )}
        {activeModule && (
          <Badge variant="secondary" className="mt-1">
            {activeModule.meta.name}
          </Badge>
        )}
      </div>

      {/* Active module component */}
      <div className="rounded-lg border border-border bg-card p-4">
        {activeModule ? (
          <activeModule.component {...moduleProps} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No module is active. Choose a node from "Available next" below.
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Complete / Skip actions */}
      {activeNode && (
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={handleComplete} disabled={busy}>
            <Check className="mr-2 h-4 w-4" /> {busy ? "Working…" : "Complete step"}
          </Button>
          {activeNode.skippable === true && (
            <Button variant="outline" onClick={handleSkip} disabled={busy}>
              <SkipForward className="mr-2 h-4 w-4" /> Skip
            </Button>
          )}
        </div>
      )}

      <Separator className="my-4" />

      {/* Node palette: all nodes + their status */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold">Node palette</h2>
        <div className="flex flex-wrap gap-2">
          {graph.nodes.map((node) => {
            const status = nodeStates[node.id] ?? "pending";
            return (
              <button
                key={node.id}
                type="button"
                disabled={busy}
                onClick={() => handleActivateNode(node.id)}
                title={`${node.label} — ${status}`}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  status === "active"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <NodeStatusIcon status={status} />
                <span>{node.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Available next: interactive ready nodes the user may choose */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold">Available next</h2>
        {validNext.length > 0 ? (
          <div className="flex flex-col gap-2">
            {validNext.map((node) => (
              <button
                key={node.id}
                type="button"
                disabled={busy}
                onClick={() => handleActivateNode(node.id)}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40"
              >
                <span className="font-medium">{node.label}</span>
                <span className="text-muted-foreground">Activate</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No further nodes are ready. Complete the active step to continue.
          </p>
        )}
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

/** Small icon for a node's lifecycle status in the palette. */
function NodeStatusIcon({ status }: { status: NodeStatus }) {
  switch (status) {
    case "done":
      return <CircleCheck className="h-4 w-4 text-green-600" />;
    case "skipped":
      return <CircleSlash className="h-4 w-4 text-muted-foreground" />;
    case "active":
      return <CircleDot className="h-4 w-4 text-primary" />;
    case "ready":
      return <Circle className="h-4 w-4 text-blue-500" />;
    case "error":
      return <CircleAlert className="h-4 w-4 text-red-600" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}
