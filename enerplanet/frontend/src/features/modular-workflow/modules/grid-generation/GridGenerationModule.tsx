import { useState, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Grid Generation module.
 *
 * Auto-step: on mount, calls `pylovoService.generateGrid(polygons, advancedParams)`.
 * Writes `gridData` and `gridResultIds` to context on success.
 */
export class GridGenerationModule extends BaseModule {
  readonly meta = {
    id: "grid-generation",
    name: "Grid Generation",
    description: "Generate the low-voltage grid for the selected area.",
    icon: "grid",
    category: "simulation" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["polygons", "advancedParams"],
    outputs: ["gridData", "gridResultIds"],
    required: ["polygons"],
  };

  readonly component = GridGenerationComponent;
}

function GridGenerationComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.gridData) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await pylovoService.generateGrid({
          polygons: context.polygons,
          include_public_buildings: true,
          include_private_buildings: true,
        });
        if (cancelled) return;
        const gridResultIds = (result.grids ?? []).map(
          (g: { grid_result_id: number }) => g.grid_result_id
        );
        onUpdate({
          gridData: result as unknown as ConfiguratorContext["gridData"],
          gridResultIds,
        });
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Grid generation failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-4 text-muted-foreground">Generating grid...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (context.gridData)
    return <div className="p-4 text-green-600">Grid generated successfully</div>;
  return null;
}

export const gridGenerationModule = new GridGenerationModule();
