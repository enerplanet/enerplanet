import { useEffect, useMemo, useState } from "react";
import { modelService } from "../model-dashboard/services/modelService";
import type { Model } from "../model-dashboard/services/modelService";
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
 * Shows every runnable workflow and gates them on whether an existing model is
 * available:
 *
 * - **No model exists** → only `from-scratch` workflows (create a new model)
 *   and pretests are shown. `from-existing-model` workflows are disabled.
 * - **A model exists** → all workflows are shown. Starting a
 *   `from-existing-model` workflow first loads the selected model into the
 *   shared context, then hands off to the playback shell.
 */
export function ModelBuilderLanding({
  workflows = defaultWorkflowRegistry.getAll(),
  onStart,
}: ModelBuilderLandingProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await modelService.getModels({ limit: 50 });
        if (cancelled) return;
        setModels(response.data ?? []);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load models");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasModel = models.length > 0;

  const { fromScratch, fromExisting } = useMemo(() => {
    const fromScratch: WorkflowDefinition[] = [];
    const fromExisting: WorkflowDefinition[] = [];
    for (const w of workflows) {
      if (w.startType === "from-existing-model") fromExisting.push(w);
      else fromScratch.push(w);
    }
    return { fromScratch, fromExisting };
  }, [workflows]);

  const handleStart = async (workflow: WorkflowDefinition) => {
    if (workflow.startType === "from-existing-model") {
      if (selectedModelId == null) return;
      setLoadingModel(true);
      setError(null);
      try {
        const response = await modelService.getModelById(selectedModelId);
        const data = response.data;
        if (!data) {
          setError("Model not found.");
          return;
        }
        const config = (data.config ?? {}) as Record<string, unknown>;
        const advancedParams = config.advancedParams as
          | ConfiguratorContext["advancedParams"]
          | undefined;
        const coords = data.coordinates as { type?: string; coordinates?: unknown } | undefined;
        const polygons = Array.isArray(coords?.coordinates)
          ? (coords.coordinates as unknown as [number, number][][])
          : undefined;

        onStart(workflow, {
          modelId: data.id,
          modelName: data.title,
          workspaceId: data.workspace_id,
          sourceModelId: data.id,
          region: data.region ? { country: data.country ?? "", state: data.region } : undefined,
          polygons,
          advancedParams,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load model");
      } finally {
        setLoadingModel(false);
      }
    } else {
      onStart(workflow);
    }
  };

  const renderWorkflowCard = (workflow: WorkflowDefinition, enabled: boolean) => (
    <div
      key={workflow.id}
      className={`flex flex-col rounded-lg border bg-card p-4 ${
        enabled ? "border-border" : "border-dashed opacity-60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{workflow.name}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {workflow.startType === "from-existing-model" ? "existing model" : "new model"}
        </span>
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
        className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        disabled={!enabled || loadingModel}
        onClick={() => handleStart(workflow)}
      >
        {workflow.startType === "from-existing-model"
          ? selectedModelId == null
            ? "Select a model first"
            : loadingModel
              ? "Loading…"
              : "Start"
          : "Start"}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Model Builder</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading
            ? "Checking for existing models…"
            : hasModel
              ? "You have existing models. Start a workflow to create a new model or modify an existing one."
              : "No models yet. Start a workflow to generate a new model."}
        </p>
      </div>

      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {hasModel && (
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="text-sm font-medium">Load an existing model</label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Required for "existing model" workflows. The selected model is loaded into the workspace
            before the workflow starts.
          </p>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={selectedModelId ?? ""}
            onChange={(e) => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Select a model —</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} (ID {m.id})
              </option>
            ))}
          </select>
        </div>
      )}

      {fromScratch.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Create a new model
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fromScratch.map((w) => renderWorkflowCard(w, true))}
          </div>
        </section>
      )}

      {fromExisting.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Modify / analyse an existing model
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fromExisting.map((w) => renderWorkflowCard(w, hasModel))}
          </div>
        </section>
      )}
    </div>
  );
}
