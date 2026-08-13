import { useMemo } from "react";
import { toFiniteNumber } from "@/features/configurator/utils/parsing";
import { getClusterKeyFromProps } from "@/features/configurator/utils/geometryUtils";
import { getFeatureFClasses } from "@/features/configurator/utils/fClassUtils";

interface PylovoGridData {
  buildings?: { type: string; features: any[] };
  lines?: { type: string; features: any[] };
  mv_lines?: { type: string; features: any[] };
  transformers?: { type: string; features: any[] };
  grids?: unknown;
}

/** Extract unique grid_result_ids from grids, transformers, and buildings. */
export const useGridResultIds = (pylovoGridData: PylovoGridData | undefined): number[] =>
  useMemo(() => {
    const ids = new Set<number>();
    const addGridId = (raw: unknown) => {
      const parsed = toFiniteNumber(raw);
      if (parsed === null) return;
      const id = Math.trunc(parsed);
      if (id > 0) ids.add(id);
    };

    if (Array.isArray(pylovoGridData?.grids)) {
      (pylovoGridData.grids as Array<{ grid_result_id?: unknown }>).forEach((g) => {
        addGridId(g?.grid_result_id);
      });
    }

    if (Array.isArray(pylovoGridData?.transformers?.features)) {
      pylovoGridData.transformers.features.forEach((feature: any) => {
        addGridId(
          feature?.properties?.grid_result_id ??
          feature?.properties?.transformer_id ??
          feature?.properties?.trafo_id
        );
      });
    }

    if (Array.isArray(pylovoGridData?.buildings?.features)) {
      pylovoGridData.buildings.features.forEach((feature: any) => {
        addGridId(
          feature?.properties?.grid_result_id ??
          feature?.properties?.transformer_id ??
          feature?.properties?.trafo_id
        );
      });
    }

    return Array.from(ids).sort((a, b) => a - b);
  }, [pylovoGridData]);

/** Lookup of transformer capacity (kVA) by grid_result_id. */
export const useGridIdToTrafoCapacity = (
  pylovoGridData: PylovoGridData | undefined
): Record<number, number> =>
  useMemo(() => {
    const lookup: Record<number, number> = {};
    if (pylovoGridData?.transformers?.features) {
      pylovoGridData.transformers.features.forEach((feature: any) => {
        const props = feature.properties;
        if (props?.grid_result_id && props?.rated_power_kva) {
          lookup[props.grid_result_id] =
            (lookup[props.grid_result_id] || 0) + props.rated_power_kva;
        }
      });
    }
    return lookup;
  }, [pylovoGridData]);

/** Lookup of peak load (kW) by grid_result_id from buildings. */
export const useGridIdToPeakLoad = (
  pylovoGridData: PylovoGridData | undefined
): Record<number, number> =>
  useMemo(() => {
    const lookup: Record<number, number> = {};
    if (pylovoGridData?.buildings?.features) {
      pylovoGridData.buildings.features.forEach((feature: any) => {
        const props = feature.properties;
        const gridId = props?.grid_result_id;
        const peakKw = props?.peak_load_in_kw ?? props?.peak_load_kw;
        if (gridId !== undefined && peakKw !== undefined && peakKw !== null) {
          lookup[gridId] = (lookup[gridId] || 0) + Number(peakKw);
        }
      });
    }
    return lookup;
  }, [pylovoGridData]);

/** Count of buildings in the current polygon. */
export const useBuildingsInPolygonCount = (
  pylovoGridData: PylovoGridData | undefined
): number =>
  useMemo(() => {
    const features = (pylovoGridData as any)?.buildings?.features;
    return Array.isArray(features) ? features.length : 0;
  }, [pylovoGridData]);

/** Total peak load (kW) across all buildings in the polygon. */
export const usePeakLoadInPolygonKw = (
  pylovoGridData: PylovoGridData | undefined
): number =>
  useMemo(() => {
    const features = (pylovoGridData as any)?.buildings?.features;
    if (!Array.isArray(features)) return 0;
    return features.reduce((sum: number, f: any) => {
      const props = f?.properties;
      const peakKw = props?.peak_load_in_kw ?? props?.peak_load_kw ?? 0;
      return sum + Number(peakKw);
    }, 0);
  }, [pylovoGridData]);

/** Connected building stats per transformer (count + types) for 3D hover tooltips. */
export const useGridIdToConnectedBuildings = (
  pylovoGridData: PylovoGridData | undefined
): Record<string, { count: number; types: string[] }> =>
  useMemo(() => {
    const lookup: Record<string, { count: number; types: string[] }> = {};
    if (pylovoGridData?.buildings?.features) {
      pylovoGridData.buildings.features.forEach((feature: any) => {
        const props = feature?.properties ?? {};
        const clusterKey = getClusterKeyFromProps(props);
        if (!clusterKey) return;

        if (!lookup[clusterKey]) {
          lookup[clusterKey] = { count: 0, types: [] };
        }
        lookup[clusterKey].count += 1;

        const fClasses = getFeatureFClasses(props);
        for (const fClass of fClasses) {
          if (!lookup[clusterKey].types.includes(fClass)) {
            lookup[clusterKey].types.push(fClass);
          }
        }
      });
    }
    return lookup;
  }, [pylovoGridData]);

/** User-placed transformers (osmId starts with 'user/') with building counts. */
export const useCustomTransformers = (
  pylovoGridData: PylovoGridData | undefined
): Array<{ gridResultId: number; osmId: string; buildingCount: number }> =>
  useMemo(() => {
    if (!pylovoGridData?.transformers?.features) return [];

    // Build lookup of building counts per grid_result_id
    const buildingCounts: Record<number, number> = {};
    if (pylovoGridData?.buildings?.features) {
      pylovoGridData.buildings.features.forEach((feature: any) => {
        const gridId = feature.properties?.grid_result_id;
        if (gridId !== undefined) {
          buildingCounts[gridId] = (buildingCounts[gridId] || 0) + 1;
        }
      });
    }

    // Filter for user-placed transformers (osmId starts with 'user/')
    return pylovoGridData.transformers.features
      .filter((feature: any) => {
        const osmId = feature.properties?.osm_id || "";
        return osmId.startsWith("user/");
      })
      .map((feature: any) => {
        const props = feature.properties;
        const gridResultId = props?.grid_result_id;
        return {
          gridResultId,
          osmId: props?.osm_id || "",
          buildingCount: buildingCounts[gridResultId] || 0,
        };
      });
  }, [pylovoGridData]);
