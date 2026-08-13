import { useEffect, useRef, useCallback } from "react";
import type { Map as OLMap } from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import { LineString } from "ol/geom";
import { Style, Stroke } from "ol/style";
import {
  extractBuildingEnrichmentFromProps,
  extractPeakLoadFromProps,
  extractSelectedFClassFromProps,
} from "@/features/configurator/utils/buildingFeatureExtraction";
import { getFeatureFClasses, getPrimaryFClass } from "@/features/configurator/utils/fClassUtils";
import { buildFClassDetails } from "@/features/configurator/hooks/useAreaSelect/helpers/fClassDemand";
import { parseTechs, extractYearlyDemandCustomOnly } from "@/features/configurator/utils/parsing";
import { getClusterKeyFromProps } from "@/features/configurator/utils/geometryUtils";
import type { AddTransformerModeState, MoveTransformerModeState } from "@/features/configurator/hooks/useTransformerMode";
import type { BuildingAssignModeState } from "@/features/configurator/hooks/useBuildingAssignMode";

// ──────────────────────────────────────────────
// useMapResize
// ──────────────────────────────────────────────

export const useMapResize = (
  map: OLMap | null,
  mapRef: React.RefObject<HTMLDivElement | null>
) => {
  useEffect(() => {
    if (map && mapRef.current) {
      requestAnimationFrame(() => {
        if (map && mapRef.current) {
          map.updateSize();
        }
      });

      const timers = [
        setTimeout(() => {
          if (map && mapRef.current) map.updateSize();
        }, 100),
        setTimeout(() => {
          if (map && mapRef.current) {
            map.updateSize();
            map.render();
          }
        }, 300),
        setTimeout(() => {
          if (map && mapRef.current) {
            map.updateSize();
            map.render();
          }
        }, 500),
      ];

      return () => {
        for (const timer of timers) clearTimeout(timer);
      };
    }
  }, [map, mapRef]);
};

// ──────────────────────────────────────────────
// useReassignmentLine
// ──────────────────────────────────────────────

interface UseReassignmentLineOptions {
  map: OLMap | null;
  active: boolean;
  /** Building anchor in map projection coordinates (EPSG:3857) */
  buildingCoords: [number, number] | null;
}

/**
 * Manages a temporary dashed line from a building to the cursor
 * while the user is in reassignment mode.
 */
export function useReassignmentLine({ map, active, buildingCoords }: UseReassignmentLineOptions) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const featureRef = useRef<Feature<LineString> | null>(null);
  const strokeRef = useRef<Stroke | null>(null);

  useEffect(() => {
    if (!map || !active || !buildingCoords) {
      if (layerRef.current && map) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = null;
      featureRef.current = null;
      return;
    }

    const source = new VectorSource();
    const lineFeature = new Feature<LineString>({
      geometry: new LineString([buildingCoords, buildingCoords]),
    });

    const stroke = new Stroke({
      color: "rgba(59, 130, 246, 0.8)",
      width: 2,
      lineDash: [8, 6],
      lineDashOffset: 0,
      lineCap: "round",
    });
    strokeRef.current = stroke;

    lineFeature.setStyle(new Style({ stroke }));

    source.addFeature(lineFeature);

    const layer = new VectorLayer({
      source,
      zIndex: 9999,
    });

    map.addLayer(layer);
    layerRef.current = layer;
    featureRef.current = lineFeature;

    const onPointerMove = (evt: any) => {
      if (featureRef.current && buildingCoords) {
        const coord = evt.coordinate as [number, number];
        featureRef.current.getGeometry()?.setCoordinates([buildingCoords, coord]);
      }
    };

    let rafId: number | null = null;
    let dashOffset = 0;
    const animateDash = () => {
      if (strokeRef.current && featureRef.current) {
        dashOffset = (dashOffset - 0.8) % 14;
        strokeRef.current.setLineDashOffset(dashOffset);
        featureRef.current.changed();
      }
      rafId = requestAnimationFrame(animateDash);
    };
    rafId = requestAnimationFrame(animateDash);

    map.on("pointermove", onPointerMove);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      map.un("pointermove", onPointerMove);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = null;
      featureRef.current = null;
      strokeRef.current = null;
    };
  }, [map, active, buildingCoords]);
}

// ──────────────────────────────────────────────
// useMapLibre3DHandlers
// ──────────────────────────────────────────────

interface MapInteractionsLike {
  setSelectedBuilding: (building: any) => void;
  setBuildingDialogOpen: (open: boolean) => void;
  setSelectedTransformer: (transformer: any) => void;
  setTransformerDialogOpen: (open: boolean) => void;
  setBuildingTooltip: (tooltip: any) => void;
  setTransformerTooltip: (tooltip: any) => void;
  setMvLineTooltip: (tooltip: any) => void;
}

interface Ml3dHandlersOptions {
  addTransformer: AddTransformerModeState;
  moveTransformer: MoveTransformerModeState;
  buildingAssign: BuildingAssignModeState;
  mapInteractions: MapInteractionsLike;
  gridIdToConnectedBuildings: Record<string, { count: number; types: string[] }>;
  notification: { showError: (message: string) => void };
  t: (key: string) => string;
}

export const useMapLibre3DHandlers = ({
  addTransformer,
  moveTransformer,
  buildingAssign,
  mapInteractions,
  gridIdToConnectedBuildings,
  notification,
  t,
}: Ml3dHandlersOptions) => {
  const handleMl3dBuildingClick = useCallback(
    (props: Record<string, any>) => {
      if (addTransformer.isAddTransformerMode || moveTransformer.isMoveTransformerMode) return;
      if (buildingAssign.isBuildingAssignMode) {
        if (buildingAssign.assignStep === "select-buildings") {
          buildingAssign.toggleBuildingSelection(props.osm_id);
        } else {
          notification.showError(t("simulation.building.selectTransformer"));
        }
        return;
      }
      const fClasses = getFeatureFClasses(props);
      const primaryFClass = getPrimaryFClass(props) || "unknown";
      const enrichment = extractBuildingEnrichmentFromProps(props);
      const totalDemand = extractYearlyDemandCustomOnly(props);
      const totalPeak = extractPeakLoadFromProps(props);
      const effectiveFClasses = fClasses.length > 0 ? fClasses : [primaryFClass];
      const selectedFClass = extractSelectedFClassFromProps(
        props,
        effectiveFClasses,
        primaryFClass
      );
      const fClassDetails = buildFClassDetails(
        effectiveFClasses,
        totalDemand,
        totalPeak,
        props.f_class_demands ?? props.fclass_details
      );
      mapInteractions.setSelectedBuilding({
        osmId: props.osm_id,
        type: primaryFClass,
        fClass: primaryFClass,
        fClasses,
        selectedFClass,
        yearlyDemandKwh: totalDemand,
        peakLoadKw: totalPeak,
        area: props.area || 0,
        gridResultId: props.grid_result_id,
        techs: parseTechs(props.techs),
        fClassDetails,
        ...enrichment,
      });
      mapInteractions.setBuildingDialogOpen(true);
    },
    [
      buildingAssign,
      addTransformer.isAddTransformerMode,
      moveTransformer.isMoveTransformerMode,
      notification,
      t,
      mapInteractions,
    ]
  );

  const handleMl3dTransformerClick = useCallback(
    (props: Record<string, any>) => {
      if (addTransformer.isAddTransformerMode || moveTransformer.isMoveTransformerMode) return;
      if (buildingAssign.isBuildingAssignMode) {
        if (buildingAssign.assignStep === "select-transformer") {
          void buildingAssign.assignSelectedBuildingsToTransformer(
            props.grid_result_id ?? props.transformer_id ?? props.trafo_id ?? props.id
          );
        } else {
          notification.showError(t("simulation.building.selectBuildings"));
        }
        return;
      }
      mapInteractions.setSelectedTransformer({
        gridResultId: props.grid_result_id,
        osmId: props.osm_id || "",
        ratedPowerKva: props.rated_power_kva || 0,
      });
      mapInteractions.setTransformerDialogOpen(true);
    },
    [
      buildingAssign,
      addTransformer.isAddTransformerMode,
      moveTransformer.isMoveTransformerMode,
      notification,
      t,
      mapInteractions,
    ]
  );

  const handleMl3dBuildingHover = useCallback(
    (props: Record<string, any> | null, pixel: [number, number]) => {
      if (!props) {
        mapInteractions.setBuildingTooltip(null);
        return;
      }
      const fClasses = getFeatureFClasses(props);
      const primary = getPrimaryFClass(props) || "unknown";
      const enrichment = extractBuildingEnrichmentFromProps(props);
      mapInteractions.setBuildingTooltip({
        x: pixel[0],
        y: pixel[1],
        type: primary,
        fClass: primary,
        fClasses,
        yearlyDemandKwh: extractYearlyDemandCustomOnly(props),
        techs: parseTechs(props.techs),
        gridResultId: props.grid_result_id ?? props.transformer_id,
        ...enrichment,
      });
    },
    [mapInteractions]
  );

  const handleMl3dTransformerHover = useCallback(
    (props: Record<string, any> | null, pixel: [number, number]) => {
      if (!props) {
        mapInteractions.setTransformerTooltip(null);
        return;
      }
      const clusterKey = getClusterKeyFromProps(props);
      const rawGridId =
        props.grid_result_id ??
        props.transformer_id ??
        props.trafo_id ??
        props.cluster_id ??
        props.id;
      const gridResultId =
        typeof rawGridId === "number" ? rawGridId : Number.parseInt(String(rawGridId), 10);
      const connected = clusterKey ? gridIdToConnectedBuildings[clusterKey] : undefined;

      mapInteractions.setTransformerTooltip({
        x: pixel[0],
        y: pixel[1],
        ratedPowerKva: props.rated_power_kva || 0,
        gridResultId: Number.isFinite(gridResultId) ? gridResultId : rawGridId,
        connectedBuildingCount: connected?.count ?? 0,
        connectedBuildingTypes: connected?.types ?? [],
      });
    },
    [mapInteractions, gridIdToConnectedBuildings]
  );

  const handleMl3dMvLineHover = useCallback(
    (props: Record<string, any> | null, pixel: [number, number]) => {
      if (!props) {
        mapInteractions.setMvLineTooltip(null);
        return;
      }
      mapInteractions.setMvLineTooltip({
        x: pixel[0],
        y: pixel[1],
        voltage: props.voltage || (props.vn_kv ? `${props.vn_kv} kV` : "20 kV"),
        lengthM: props.length_m || props.length || 0,
        cableType: props.cable_type || props.std_type || "",
        normallyOpen: props.normally_open || false,
        fromBus: props.from_bus || props.from_node || "",
        toBus: props.to_bus || props.to_node || "",
      });
    },
    [mapInteractions]
  );

  const handleMl3dMapClick = useCallback(
    (lngLat: [number, number]) => {
      if (addTransformer.isAddTransformerMode) {
        addTransformer.setNewTransformerCoords(lngLat);
        addTransformer.setAddTransformerDialogOpen(true);
      }
    },
    [
      addTransformer.isAddTransformerMode,
      addTransformer.setNewTransformerCoords,
      addTransformer.setAddTransformerDialogOpen,
    ]
  );

  return {
    handleMl3dBuildingClick,
    handleMl3dTransformerClick,
    handleMl3dBuildingHover,
    handleMl3dTransformerHover,
    handleMl3dMvLineHover,
    handleMl3dMapClick,
  };
};
