import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Style, Fill, Stroke } from "ol/style";
import { getCenter } from "ol/extent";
import type { Map as OLMap } from "ol";
import { pylovoService } from "@/features/configurator/services/pylovoService";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import { getMapProjectedCenterFromAnyCoordinates } from "@/features/configurator/utils/geometryUtils";

interface BuildingAssignOptions {
  map: OLMap | null;
  notification: {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
  };
  allPolygons: [number, number][][];
  refreshGrid: () => Promise<void>;
  pylovoGridData: any;
  existingModelId?: number;
  draftId?: string;
}

export interface BuildingAssignModeState {
  isBuildingAssignMode: boolean;
  selectedBuildingsForAssign: string[];
  assignStep: "select-buildings" | "select-transformer";
  isAssigning: boolean;
  reassignmentLineAnchor: [number, number] | null;
  toggleBuildingSelection: (rawOsmId: unknown, feature?: any) => void;
  assignSelectedBuildingsToTransformer: (rawGridId: unknown) => Promise<void>;
  clearBuildingAssignMode: () => void;
  setAssignStep: (step: "select-buildings" | "select-transformer") => void;
  setIsBuildingAssignMode: (active: boolean) => void;
  setSelectedBuildingsForAssign: (ids: string[]) => void;
  startBuildingAssignMode: () => void;
}

export const useBuildingAssignMode = ({
  map,
  notification,
  allPolygons,
  refreshGrid,
  pylovoGridData,
  existingModelId,
  draftId,
}: BuildingAssignOptions): BuildingAssignModeState => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  const [isBuildingAssignMode, setIsBuildingAssignMode] = useState(false);
  const [selectedBuildingsForAssign, setSelectedBuildingsForAssign] = useState<string[]>([]);
  const [assignStep, setAssignStep] = useState<"select-buildings" | "select-transformer">(
    "select-buildings"
  );
  const [isAssigning, setIsAssigning] = useState(false);
  const selectedBuildingFeaturesRef = useRef<Map<string, any>>(new Map());

  const clearBuildingAssignMode = useCallback(() => {
    // Clear highlight styles from all selected buildings
    selectedBuildingFeaturesRef.current.forEach((feature) => {
      feature.setStyle(undefined);
    });
    selectedBuildingFeaturesRef.current.clear();
    setIsBuildingAssignMode(false);
    setSelectedBuildingsForAssign([]);
    setAssignStep("select-buildings");
  }, []);

  const toggleBuildingSelection = useCallback((rawOsmId: unknown, feature?: any) => {
    if (rawOsmId === undefined || rawOsmId === null) return;
    const osmId = String(rawOsmId).trim();
    if (!osmId) return;

    setSelectedBuildingsForAssign((prev) => {
      if (prev.includes(osmId)) {
        if (feature) {
          feature.setStyle(undefined);
        }
        selectedBuildingFeaturesRef.current.delete(osmId);
        return prev.filter((id) => id !== osmId);
      }

      if (feature) {
        feature.setStyle(
          new Style({
            fill: new Fill({ color: "rgba(59, 130, 246, 0.5)" }),
            stroke: new Stroke({ color: "#2563eb", width: 3 }),
          })
        );
        selectedBuildingFeaturesRef.current.set(osmId, feature);
      }
      return [...prev, osmId];
    });
  }, []);

  const assignSelectedBuildingsToTransformer = useCallback(
    async (rawGridId: unknown) => {
      if (selectedBuildingsForAssign.length === 0) {
        notification.showError(t("simulation.building.selectBuildings"));
        return;
      }

      const parsedGridId =
        typeof rawGridId === "number" ? rawGridId : Number.parseInt(String(rawGridId), 10);
      if (!Number.isFinite(parsedGridId)) {
        notification.showError(t("simulation.building.selectTransformer"));
        return;
      }
      const targetGridId = parsedGridId;

      setIsAssigning(true);
      try {
        const userId = user?.id ? String(user.id) : undefined;
        let successCount = 0;
        for (const osmId of selectedBuildingsForAssign) {
          try {
            await pylovoService.assignBuilding(
              osmId,
              targetGridId,
              userId,
              existingModelId,
              draftId
            );
            successCount++;
          } catch (e) {
            console.error(`Failed to assign building ${osmId}:`, e);
            notification.showError(`Failed to assign building ${osmId} to transformer`);
          }
        }

        if (successCount === selectedBuildingsForAssign.length) {
          notification.showSuccess(t("simulation.building.assignAllSuccess"));
        } else if (successCount > 0) {
          notification.showSuccess(
            t("simulation.building.assignPartialSuccess", {
              success: successCount,
              total: selectedBuildingsForAssign.length,
            })
          );
        } else {
          notification.showError(t("simulation.building.assignFailed"));
        }

        if (allPolygons.length > 0) {
          await refreshGrid();
        }
      } catch (error) {
        console.error("Failed to assign buildings:", error);
        notification.showError(t("simulation.building.assignFailed"));
      } finally {
        setIsAssigning(false);
        clearBuildingAssignMode();
      }
    },
    [
      selectedBuildingsForAssign,
      notification,
      t,
      user?.id,
      existingModelId,
      draftId,
      allPolygons.length,
      refreshGrid,
      clearBuildingAssignMode,
    ]
  );

  const startBuildingAssignMode = useCallback(() => {
    setIsBuildingAssignMode(true);
    setSelectedBuildingsForAssign([]);
    setAssignStep("select-buildings");
  }, []);

  // Reassignment line anchor (visual dashed line from building to cursor)
  const reassignmentLineAnchor = useMemo<[number, number] | null>(() => {
    if (
      !isBuildingAssignMode ||
      assignStep !== "select-transformer" ||
      selectedBuildingsForAssign.length === 0
    ) {
      return null;
    }

    const selectedOsmId = selectedBuildingsForAssign[selectedBuildingsForAssign.length - 1];
    if (!selectedOsmId) return null;

    const selectedFeature = selectedBuildingFeaturesRef.current.get(selectedOsmId);
    if (selectedFeature) {
      const geometry = selectedFeature.getGeometry?.();
      if (geometry) {
        const extent = geometry.getExtent();
        if (extent) {
          const center = getCenter(extent);
          return [center[0], center[1]];
        }
      }
    }

    const buildingFeature: any = pylovoGridData?.buildings?.features?.find((f: any) => {
      const osmId = f?.properties?.osm_id;
      return osmId !== undefined && osmId !== null && String(osmId).trim() === selectedOsmId;
    });

    if (!buildingFeature?.geometry?.coordinates) return null;
    return getMapProjectedCenterFromAnyCoordinates(buildingFeature.geometry.coordinates);
  }, [
    isBuildingAssignMode,
    assignStep,
    selectedBuildingsForAssign,
    pylovoGridData,
  ]);

  // Map click handler for multi-building assignment mode
  useEffect(() => {
    if (!map || !isBuildingAssignMode) {
      return;
    }

    const handleMapClick = async (evt: any) => {
      if (isAssigning) return;

      const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => {
        const type = f.get("feature_type");
        if (type === "building" || type === "transformer") return f;
        return null;
      });

      if (!feature) return;

      const featureType = feature.get("feature_type");

      if (assignStep === "select-buildings") {
        // In building selection step - toggle building selection
        if (featureType === "building") {
          toggleBuildingSelection(feature.get("osm_id"), feature);
        }
      } else if (assignStep === "select-transformer") {
        // In transformer selection step
        if (featureType === "transformer") {
          await assignSelectedBuildingsToTransformer(
            feature.get("grid_result_id") ??
            feature.get("transformer_id") ??
            feature.get("trafo_id") ??
            feature.get("id")
          );
        } else {
          notification.showError(t("simulation.building.selectTransformer"));
        }
      }
    };

    // Escape key to cancel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearBuildingAssignMode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    const mapElement = map.getTargetElement();
    if (mapElement) {
      mapElement.style.cursor = assignStep === "select-buildings" ? "pointer" : "crosshair";
    }

    map.on("click", handleMapClick);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      map.un("click", handleMapClick);
      if (mapElement) {
        mapElement.style.cursor = "";
      }
    };
  }, [
    map,
    isBuildingAssignMode,
    assignStep,
    isAssigning,
    notification,
    t,
    clearBuildingAssignMode,
    toggleBuildingSelection,
    assignSelectedBuildingsToTransformer,
  ]);

  return {
    isBuildingAssignMode,
    selectedBuildingsForAssign,
    assignStep,
    isAssigning,
    reassignmentLineAnchor,
    toggleBuildingSelection,
    assignSelectedBuildingsToTransformer,
    clearBuildingAssignMode,
    setAssignStep,
    setIsBuildingAssignMode,
    setSelectedBuildingsForAssign,
    startBuildingAssignMode,
  };
};
