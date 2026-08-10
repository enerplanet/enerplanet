import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { modelService } from "../../../model-dashboard/services/modelService";
import type { Model } from "../../../model-dashboard/services/modelService";

/**
 * Model Load module.
 *
 * Lists the user's existing models and lets them pick one to load into the
 * shared context. Hydrates `modelId`, `modelName`, `workspaceId`, `region`,
 * `polygons`, and `advancedParams` from the stored model so downstream
 * `from-existing-model` workflows can operate on it.
 */
export class ModelLoadModule extends BaseModule {
  readonly meta = {
    id: "model-load",
    name: "Load Model",
    description: "Load an existing model into the workspace to modify or analyse.",
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

  override validate(context: ConfiguratorContext) {
    if (!context.modelId) {
      return { valid: false, errors: ["No model loaded yet."] };
    }
    return { valid: true };
  }
}

function ModelLoadComponent({ context, onUpdate }: ModuleProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading models…</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        Pick an existing model to load into the workspace. Its region, area, and parameters will be
        restored so you can modify or analyse it.
      </div>

      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {models.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No existing models found. Start a "from scratch" workflow to create one.
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
                {loadingModel && context.modelId === model.id ? "Loading…" : "Load"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {context.modelId && (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          Loaded model: <span className="font-medium">{context.modelName}</span> (ID{" "}
          {context.modelId})
        </div>
      )}
    </div>
  );
}

export const modelLoadModule = new ModelLoadModule();
