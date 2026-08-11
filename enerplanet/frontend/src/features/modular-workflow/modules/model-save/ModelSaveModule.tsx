import { useState, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import {
  saveAreaData,
  mapSimulationSettingsToAdvancedParams,
} from "../../../configurator/services/saveService";

/**
 * Model Save module.
 *
 * Reads the full context and persists the model via the shared `saveAreaData`
 * pipeline, which reproduces the exact save payload shape from the legacy
 * configurator (see `configuratorflow.md` §5).
 *
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
    inputs: ["region", "polygons", "gridData", "simulationSettings", "modelName", "workspaceId"],
    outputs: ["modelId"],
    required: ["polygons", "simulationSettings"],
  };

  readonly component = ModelSaveComponent;

  override validate(context: ConfiguratorContext) {
    if (!context.polygons?.length) {
      return { valid: false, errors: ["No polygons to save."] };
    }
    if (!context.simulationSettings) {
      return {
        valid: false,
        errors: ["Simulation settings not configured."],
      };
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
      const sim = context.simulationSettings;
      if (!sim) {
        setError("Simulation settings are missing.");
        return;
      }

      // Map modular simulation settings to the shape buildSaveConfig expects
      const advancedParams = mapSimulationSettingsToAdvancedParams(sim);

      const result = await saveAreaData({
        fromDate: sim.fromDate,
        toDate: sim.toDate,
        modelName: sim.modelName,
        resolution: 60, // default; could be added to SimulationSettings later
        editMode: !!context.modelId,
        modelId: context.modelId,
        polygonCoordinates: context.polygons ?? [],
        workspaceId: context.workspaceId,
        pylovoData: context.gridData,
        advancedParams,
        draftId: context.draftId,
        userId: undefined, // caller should provide via auth store if needed
        originalModel: context.originalModel ?? null,
        onSaveStart: () => setSaving(true),
        onSaveEnd: () => setSaving(false),
      });

      if (result) {
        onUpdate({ modelId: result.modelId });
        setSaved(true);
      } else {
        setError("Validation failed — check that all required fields are filled.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSaving(false);
    }
  }, [context, onUpdate, saving, saved]);

  if (saved) {
    return <div className="p-4 text-green-600">Model saved (ID: {context.modelId})</div>;
  }

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
