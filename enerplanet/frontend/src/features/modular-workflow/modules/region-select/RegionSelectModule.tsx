import { useState, useEffect, useCallback, useRef } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { MapContainer } from "../../../../components/shared/MapContainer";
import { PolygonDrawer } from "../../../polygon-drawer";
import { useMapStore } from "../../../interactive-map/store/map-store";
import { transformExtent } from "ol/proj";
import { pylovoService } from "../../../configurator/services/pylovoService";
import { loadGridLayers } from "../../../configurator/utils/gridLayerUtils";
import { useAuthStore } from "../../../../store/auth-store";
import type { AvailableRegion } from "../../../configurator/region-selector/components/RegionSelector";
import type VectorLayer from "ol/layer/Vector";
import type VectorSource from "ol/source/Vector";

/**
 * Region Selection module.
 *
 * Lets the user pick a region and draw the model area boundary directly on the
 * map. The drawn polygon is written to `context.polygons`, which is required by
 * the grid-generation step.
 *
 * Reuses the shared `MapContainer` and `PolygonDrawer` components but is
 * otherwise detached from the configurator's `AreaSelect` flow.
 */
export class RegionSelectModule extends BaseModule {
  readonly meta = {
    id: "region-select",
    name: "Region Selection",
    description: "Pick a region and draw the area boundary on the map.",
    icon: "map",
    category: "input" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: [],
    outputs: ["region", "polygons"],
    required: [],
  };

  readonly component = RegionSelectWrapper;

  override validate(context: ConfiguratorContext) {
    if (!context.polygons?.length) {
      return { valid: false, errors: ["No area drawn yet."] };
    }
    return { valid: true };
  }
}

function RegionSelectWrapper({ context, onUpdate }: ModuleProps) {
  const { map } = useMapStore();
  const [regions, setRegions] = useState<AvailableRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearTrigger, setClearTrigger] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
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

  const generateGrid = useCallback(
    async (polygons: [number, number][][]) => {
      if (!polygons?.length) {
        clearLayers();
        onUpdate({ gridData: undefined, gridResultIds: [] });
        setBuildingCount(null);
        return;
      }
      const genId = ++genIdRef.current;
      setGenerating(true);
      setGenError(null);
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
        if (genId !== genIdRef.current) return;
        const gridResultIds = (result.grids ?? []).map(
          (g: { grid_result_id: number }) => g.grid_result_id
        );
        clearLayers();
        if (map) {
          const { layers } = loadGridLayers(map, result as never);
          layersRef.current = layers;
        }
        setBuildingCount(result.buildings?.features?.length ?? 0);
        onUpdate({
          gridData: result as unknown as ConfiguratorContext["gridData"],
          gridResultIds,
        });
      } catch (err: unknown) {
        if (genId !== genIdRef.current) return;
        setGenError(err instanceof Error ? err.message : "Grid generation failed");
      } finally {
        if (genId === genIdRef.current) setGenerating(false);
      }
    },
    [map, onUpdate, clearLayers, context.modelId, context.draftId]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await pylovoService.getAvailableRegions();
        if (cancelled) return;
        if (response.status !== "success" || !response.regions?.length) {
          setRegions([]);
          return;
        }
        const mapped = response.regions
          .filter((r) => r.region?.name)
          .map((r) => ({
            name: r.region!.name,
            gridCount: r.grid_count,
            country: r.region?.country,
            countryCode: r.region?.country_code || r.country_code,
            stateCode: r.region?.state_code || r.state_code,
            has3d: r.has_3d || false,
            bbox: r.bbox,
          }));
        setRegions(mapped);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load regions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRegionSelect = useCallback(
    (region: AvailableRegion) => {
      onUpdate({
        region: {
          country: region.country ?? "",
          state: region.name,
        },
      });
      // Move the map to the selected region so the user can draw the sub-area
      // they actually want to simulate. The region is only a data subset — the
      // drawn polygon defines the simulated area.
      if (map && region.bbox) {
        const { west, south, east, north } = region.bbox;
        const extent = transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857");
        map.getView().fit(extent, { padding: [60, 60, 60, 60] });
      }
    },
    [onUpdate, map]
  );

  const handlePolygonDrawn = useCallback(
    (_coordinates: [number, number][], allPolygons: [number, number][][]) => {
      onUpdate({ polygons: allPolygons });
      void generateGrid(allPolygons);
    },
    [onUpdate, generateGrid]
  );

  const handlePolygonModified = useCallback(
    (allPolygons: [number, number][][]) => {
      onUpdate({ polygons: allPolygons });
      void generateGrid(allPolygons);
    },
    [onUpdate, generateGrid]
  );

  const handleClear = useCallback(() => {
    setClearTrigger((n) => n + 1);
    genIdRef.current++;
    clearLayers();
    onUpdate({ polygons: [], gridData: undefined, gridResultIds: [] });
    setBuildingCount(null);
    setGenError(null);
  }, [onUpdate, clearLayers]);

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-muted-foreground">
        Draw the area where the model should be situated on the map. This area is required to
        generate the grid.
      </div>

      {error && <div className="text-sm text-destructive">Error: {error}</div>}

      {/* Region quick-pick */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Quick region:</span>
        {loading ? (
          <span className="text-sm text-muted-foreground">Loading regions…</span>
        ) : (
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const region = regions.find((r) => r.name === e.target.value);
              if (region) handleRegionSelect(region);
            }}
          >
            <option value="">— Select a region —</option>
            {regions.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={handleClear}
        >
          Clear area
        </button>
      </div>

      {/* Map with polygon drawing */}
      <div className="h-[480px] overflow-hidden rounded-lg border border-border">
        <MapContainer
          modal={false}
          topBar={
            <div className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
              <span className="text-sm font-medium">Draw the model area</span>
              <span className="text-xs text-muted-foreground">
                Click to add points, double-click to close the polygon
              </span>
            </div>
          }
        />
      </div>

      <PolygonDrawer
        map={map}
        onPolygonDrawn={handlePolygonDrawn}
        onPolygonModified={handlePolygonModified}
        onClearAll={handleClear}
        allowMultiple={false}
        clearTrigger={clearTrigger}
        initialPolygons={context.polygons?.length ? context.polygons : undefined}
        disableAfterDraw={false}
        enableEditing
        labels={{ clickToClose: "Close polygon", start: "Start drawing" }}
      />

      {context.polygons?.length ? (
        <div className="text-sm text-muted-foreground">
          Area drawn: {context.polygons.length} polygon
          {context.polygons.length > 1 ? "s" : ""} ·{" "}
          {context.region
            ? `${context.region.country} / ${context.region.state}`
            : "no region selected"}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No area drawn yet.</div>
      )}

      {generating && <div className="text-sm text-muted-foreground">Generating grid…</div>}
      {genError && <div className="text-sm text-destructive">Grid error: {genError}</div>}
      {!generating && !genError && buildingCount !== null && (
        <div className="text-sm text-green-600">
          Grid generated with {buildingCount} building{buildingCount === 1 ? "" : "s"}.
        </div>
      )}
    </div>
  );
}

export const regionSelectModule = new RegionSelectModule();
