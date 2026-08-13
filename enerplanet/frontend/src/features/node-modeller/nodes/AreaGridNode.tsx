/**
 * Node B — Area Selection & Grid (Plan P3, README_V2 §2.1).
 * Draw polygons on the map → generate grid via adapter → live stats badge.
 */
import { useCallback, useMemo, useState } from "react";
import type { NodeUiProps } from "../components/context-store";
import { MapCanvas } from "./shared/MapCanvas";

export function AreaGridNode({ store, api, goNext }: NodeUiProps) {
  const { region, grid, meta } = store.ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [stats, setStats] = useState<Record<string, unknown>>();

  const onPolygons = useCallback(
    (polygons: GeoJSON.FeatureCollection) =>
      store.dispatch({ type: "set-region", payload: { polygons } }),
    [store]
  );

  const displayFeatures = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...grid.lines,
        ...grid.mvLines,
        ...grid.transformers,
        ...grid.buildings.map((b) => ({
          type: "Feature" as const,
          geometry: b.geometry,
          properties: { osmId: b.osmId, ...b.properties },
        })),
      ],
    }),
    [grid]
  );

  const canGenerate = (region.polygons?.features.length ?? 0) > 0 && !busy;

  const generate = async () => {
    if (!region.polygons) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.generateGrid({
        polygons: region.polygons,
        fromDate: meta.fromDate,
        toDate: meta.toDate,
      });
      store.dispatch({
        type: "set-grid",
        payload: {
          buildings: result.buildings,
          lines: result.lines,
          mvLines: result.mvLines,
          transformers: result.transformers,
          grids: result.grids,
          draftId: result.draftId,
        },
      });
      // advisory stats badge — failures never block
      try {
        setStats(await api.gridStatistics(store.ctx));
      } catch {
        setStats(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grid generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Area & Grid</h2>
          <p className="text-sm text-muted-foreground">
            Draw one or more areas on the map, then generate the grid. Buildings, lines and
            transformers appear on the map.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{region.polygons?.features.length ?? 0} area(s)</span>
          <span>·</span>
          <span>{grid.buildings.length} buildings</span>
          <span>·</span>
          <span>{grid.transformers.length} transformers</span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border">
        <MapCanvas
          className="h-full w-full"
          onPolygonsChange={onPolygons}
          displayFeatures={displayFeatures}
        />
        {stats && (
          <div className="absolute bottom-2 left-2 max-w-xs rounded-md border bg-background/95 p-2 text-xs shadow">
            {Object.entries(stats)
              .slice(0, 6)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{k}</span>
                  <span>{String(v)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Generating…" : "Generate grid"}
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={grid.buildings.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          Next: Demand
        </button>
      </div>
    </div>
  );
}
