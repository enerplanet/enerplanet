import { useState, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { modelService } from "../../../model-dashboard/services/modelService";

/**
 * Model Save module.
 *
 * Reads the full context and persists the model via `modelService.createModel`.
 * Writes `modelId` to context on success.
 */
export class ModelSaveModule extends BaseModule {
  readonly meta = {
    id: "model-save",
    name: "Save Model",
    description: "Save the configured model to the workspace.",
    icon: "save",
    category: "output" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["region", "polygons", "gridData", "advancedParams", "modelName", "workspaceId"],
    outputs: ["modelId"],
    required: ["polygons"],
  };

  readonly component = ModelSaveComponent;

  override validate(context: ConfiguratorContext) {
    if (!context.polygons?.length) {
      return { valid: false, errors: ["No polygons to save."] };
    }
    return { valid: true };
  }
}

function ModelSaveComponent({ context, onUpdate }: ModuleProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      const coordinatesGeoJSON = {
        type: "MultiPolygon",
        coordinates: (context.polygons ?? []).map((polygon: number[][]) => [polygon]),
      };
      const response = await modelService.createModel({
        title: context.modelName ?? "Untitled Model",
        workspace_id: context.workspaceId,
        coordinates: coordinatesGeoJSON as never,
        from_date: "2024-01-01",
        to_date: "2024-12-31",
        config: {
          advancedParams: context.advancedParams,
        },
      });
      const modelId = response.data?.id;
      if (modelId) {
        onUpdate({ modelId });
        setSaved(true);
      } else {
        setError("Save succeeded but no model ID was returned.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSaving(false);
    }
  }, [context, onUpdate, saving, saved]);

  if (saved) return <div className="p-4 text-green-600">Model saved (ID: {context.modelId})</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        Save the current model configuration to your workspace.
      </div>
      {error && <div className="text-sm text-destructive">Error: {error}</div>}
      <button
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Model"}
      </button>
    </div>
  );
}

export const modelSaveModule = new ModelSaveModule();
