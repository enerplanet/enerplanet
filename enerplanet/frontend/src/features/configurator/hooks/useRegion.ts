import { useCallback } from "react";
import { transformExtent } from "ol/proj";
import type { Map as OLMap } from "ol";
import { generateUUID } from "@/utils/uuid";
import { highlightSelectedRegionBoundary } from "@/features/configurator/utils/gridLayerUtils";
import { useModelStore } from "@/features/configurator/store/modelStore";

// ──────────────────────────────────────────────
// useRegionSelection
// ──────────────────────────────────────────────

interface RegionSelectionOptions {
  map: OLMap | null;
  editMode: boolean;
  handleClearAllPolygons: () => void;
  resetAddTransformerMode: () => void;
  clearBuildingAssignMode: () => void;
  setDraftId: (id: string) => void;
}

export const useRegionSelection = ({
  map,
  editMode,
  handleClearAllPolygons,
  resetAddTransformerMode,
  clearBuildingAssignMode,
  setDraftId,
}: RegionSelectionOptions) => {
  const availableRegions = useModelStore((s) => s.availableRegions);
  const handleClearAllWithModes = useCallback(() => {
    handleClearAllPolygons();
    resetAddTransformerMode();
    clearBuildingAssignMode();
    if (!editMode) {
      setDraftId(generateUUID());
    }
  }, [
    handleClearAllPolygons,
    resetAddTransformerMode,
    clearBuildingAssignMode,
    editMode,
    setDraftId,
  ]);

  const handleRegionSelect = useCallback(
    (region: {
      name?: string;
      bbox?: { west: number; south: number; east: number; north: number };
    }) => {
      if (!map || !region.bbox) return;
      handleClearAllWithModes();
      const { west, south, east, north } = region.bbox;
      const extent = transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857");
      map.getView().fit(extent, {
        padding: [60, 60, 60, 60],
        duration: 1500,
        maxZoom: 14,
        easing: (t: number) => t * (2 - t),
      });
      const selectedName = region.name || null;
      highlightSelectedRegionBoundary(map, selectedName);
    },
    [map, handleClearAllWithModes]
  );

  const handleBoundaryRegionClick = useCallback(
    (regionName: string) => {
      const region = availableRegions?.find(
        (r: { name: string }) => r.name.toLowerCase() === regionName.toLowerCase()
      );
      if (region) handleRegionSelect(region);
    },
    [availableRegions, handleRegionSelect]
  );

  return { handleClearAllWithModes, handleRegionSelect, handleBoundaryRegionClick };
};
