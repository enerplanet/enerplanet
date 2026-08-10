import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import energyService from "../../../configurator/services/energyService";
import { BuildingDialog } from "../../../configurator/region-selector/components/BuildingDialog";

/**
 * Building Demand module.
 *
 * Wraps `energyService.estimateBuildingsEnergyDemand(gridData)` and the
 * configurator's `BuildingDialog`. Reads `gridData`, writes `buildingEstimates`
 * and `buildingFilters` to context.
 */
export class BuildingDemandModule extends BaseModule {
  readonly meta = {
    id: "building-demand",
    name: "Building Demand",
    description: "Estimate energy demand for buildings in the grid.",
    icon: "home",
    category: "analysis" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridData"],
    outputs: ["buildingEstimates", "buildingFilters"],
    required: ["gridData"],
  };

  readonly component = BuildingDemandComponent;
}

function BuildingDemandComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const runEstimation = useCallback(async () => {
    if (!context.gridData?.buildings?.features?.length) return;
    setLoading(true);
    setError(null);
    try {
      const buildings = context.gridData.buildings.features.map((f, idx) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return {
          id: (props.osm_id as string | number) ?? idx,
          type: (props.f_class as string) ?? "unknown",
          area: Number(props.area ?? 0),
        };
      });
      const estimates = await energyService.estimateBuildingsEnergyDemand(buildings);
      onUpdate({
        buildingEstimates: estimates,
        buildingFilters: {
          includePublic: true,
          includePrivate: true,
          excludedIds: new Set<number>(),
        },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Building demand estimation failed");
    } finally {
      setLoading(false);
    }
  }, [context.gridData, onUpdate]);

  useEffect(() => {
    if (!context.buildingEstimates) {
      runEstimation();
    }
  }, []);

  if (loading)
    return <div className="p-4 text-muted-foreground">Estimating building demand...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        {context.buildingEstimates
          ? `Estimated demand for ${context.buildingEstimates.size} buildings.`
          : "No building estimates yet."}
      </div>
      <button
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
        onClick={() => setDialogOpen(true)}
      >
        Review Buildings
      </button>
      <BuildingDialog
        open={dialogOpen}
        selectedBuilding={null}
        onClose={() => setDialogOpen(false)}
        onFClassDemandChange={() => {}}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

export const buildingDemandModule = new BuildingDemandModule();
