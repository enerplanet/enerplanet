import { useState, useEffect, useRef, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { pylovoService } from "../../../configurator/services/pylovoService";
import { loadGridLayers } from "../../../configurator/utils/gridLayerUtils";
import { useMapStore } from "../../../interactive-map/store/map-store";
import { useAuthStore } from "../../../../store/auth-store";
import type VectorLayer from "ol/layer/Vector";
import type VectorSource from "ol/source/Vector";

/**
 * Grid Generation module.
 *
 * Triggers `pylovoService.generateGrid` whenever the drawn polygons change.
 * The response (buildings, transformers, lines) is rendered on the map via
 * `loadGridLayers`. Writes `gridData` and `gridResultIds` to context.
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
  const { map } = useMapStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildingCount, setBuildingCount] = useState<number | null>(null);
  const layersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const genIdRef = useRef(0);

  // Clean up map layers on unmount
  useEffect(() => {
    return () => {
      layersRef.current.forEach((layer) => {
        if (map) map.removeLayer(layer);
      });
      layersRef.current = [];
    };
  }, [map]);

  const clearLayers = useCallback(() => {
    layersRef.current.forEach((layer) => {
      if (map) map.removeLayer(layer);
    });
    layersRef.current = [];
  }, [map]);

  const run = useCallback(async () => {
    const polygons = context.polygons;
    if (!polygons?.length) {
      clearLayers();
      onUpdate({ gridData: undefined, gridResultIds: [] });
      setBuildingCount(null);
      return;
    }

    // If the grid was already generated (e.g. by the region-select step on
    // polygon draw), just display the existing result instead of re-calling
    // the API.
    if (context.gridData) {
      setBuildingCount(context.gridData.buildings?.features?.length ?? 0);
      return;
    }

    const genId = ++genIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const user = useAuthStore.getState().user;
      const userId = user?.id ? String(user.id) : undefined;

      const result = await pylovoService.generateGrid({
        polygons,
        user_id: userId,
        model_id: context.modelId,
        draft_id: context.draftId,
        include_public_buildings: true,
        include_private_buildings: true,
      });

      // Discard stale response if a newer request was started
      if (genId !== genIdRef.current) return;

      const gridResultIds = (result.grids ?? []).map(
        (g: { grid_result_id: number }) => g.grid_result_id
      );

      // Render the grid on the map
      clearLayers();
      if (map) {
        const { layers } = loadGridLayers(map, result as never);
        layersRef.current = layers;
      }

      const count = result.buildings?.features?.length ?? 0;
      setBuildingCount(count);
      onUpdate({
        gridData: result as unknown as ConfiguratorContext["gridData"],
        gridResultIds,
      });
    } catch (err: unknown) {
      if (genId !== genIdRef.current) return;
      setError(err instanceof Error ? err.message : "Grid generation failed");
    } finally {
      if (genId === genIdRef.current) setLoading(false);
    }
  }, [
    context.polygons,
    context.modelId,
    context.draftId,
    map,
    onUpdate,
    clearLayers,
    context.gridData,
  ]);

  // Trigger grid generation whenever polygons change
  useEffect(() => {
    run();
    return () => {
      genIdRef.current++;
    };
  }, [run]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="text-sm text-muted-foreground">Generating grid…</div>
        <div className="h-[480px] overflow-hidden rounded-lg border border-border">
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading grid data…
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-4">
        <div className="text-sm text-destructive">Error: {error}</div>
        <div className="h-[480px] overflow-hidden rounded-lg border border-border" />
      </div>
    );
  }

  if (!context.polygons?.length) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No area drawn yet. Go back to the region selection step and draw an area.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-muted-foreground">
        {buildingCount !== null
          ? `Grid generated with ${buildingCount} building${buildingCount === 1 ? "" : "s"}.`
          : "Grid generated."}
      </div>
      <div className="h-[480px] overflow-hidden rounded-lg border border-border">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Grid rendered on the map.
        </div>
      </div>
    </div>
  );
}

export const gridGenerationModule = new GridGenerationModule();
