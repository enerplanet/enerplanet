import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { modelService } from "../../../model-dashboard/services/modelService";
import type { Model } from "../../../model-dashboard/services/modelService";

/**
 * Model Load module — the entry prompt for every workflow.
 *
 * Asks the user whether they want to import an existing model into the shared
 * context. If yes, shows a model picker and hydrates `modelId`, `modelName`,
 * `workspaceId`, `region`, `polygons`, and `advancedParams` from the stored
 * model. If no, the workflow proceeds with an empty context.
 *
 * The module is skippable and always valid — the user can complete it without
 * loading a model, allowing them to start fresh or skip/redo steps later.
 */
export class ModelLoadModule extends BaseModule {
  readonly meta = {
    id: "model-load",
    name: "Import Model",
    description: "Import an existing model into the context, or start fresh.",
    icon: "folder-open",
    category: "input" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: [],
    outputs: [
      "modelId",
      "modelName",
      "workspaceId",
      "region",
      "polygons",
      "advancedParams",
      "sourceModelId",
    ],
    required: [],
  };

  readonly component = ModelLoadComponent;

  /** Always valid — the user may proceed with or without loading a model. */
  override validate(_context: ConfiguratorContext) {
    return { valid: true };
  }
}

function ModelLoadComponent({ context, onUpdate }: ModuleProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState<boolean>(false);

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

  const handleLoad = useCallback(
    async (model: Model) => {
      setLoadingModel(true);
      setError(null);
      try {
        const response = await modelService.getModelById(model.id);
        const data = response.data;
        if (!data) {
          setError("Model not found.");
          return;
        }
        // Hydrate the shared context from the stored model.
        const config = (data.config ?? {}) as Record<string, unknown>;
        const advancedParams = config.advancedParams as
          | ConfiguratorContext["advancedParams"]
          | undefined;
        const coords = data.coordinates as { type?: string; coordinates?: unknown } | undefined;
        const polygons = Array.isArray(coords?.coordinates)
          ? (coords.coordinates as unknown as [number, number][][])
          : undefined;

        onUpdate({
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
    },
    [onUpdate]
  );

  // Already loaded — show confirmation.
  if (context.modelId) {
    return (
      <div className="p-4 space-y-3">
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          Loaded model: <span className="font-medium">{context.modelName}</span> (ID{" "}
          {context.modelId})
        </div>
        <p className="text-xs text-muted-foreground">
          The model's region, area, and parameters are available in the context. You can skip or
          redo any step to change the data.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading models…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-medium">
        Would you like to import an existing model into the context?
      </div>
      <p className="text-xs text-muted-foreground">
        Importing a model restores its region, area, and parameters so you can modify or analyse it.
        If you choose not to, you can start fresh and configure everything from scratch.
      </p>

      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      <div className="flex gap-3">
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => setShowPicker(true)}
          disabled={showPicker}
        >
          Yes, import a model
        </button>
        <button
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            // User chose not to import — proceed with empty context.
            // The module is always valid, so the user can click "Complete step".
          }}
        >
          No, start fresh
        </button>
      </div>

      {showPicker && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Select a model to import:</div>
          {models.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No existing models found. Click "No, start fresh" to proceed.
            </div>
          ) : (
            <ul className="space-y-2">
              {models.map((model) => (
                <li
                  key={model.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{model.title}</div>
                    <div className="text-xs text-muted-foreground">
                      ID {model.id} · {model.region ?? "no region"} ·{" "}
                      {new Date(model.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="ml-3 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    onClick={() => handleLoad(model)}
                    disabled={loadingModel}
                  >
                    {loadingModel ? "Loading…" : "Load"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export const modelLoadModule = new ModelLoadModule();
