import { useCallback, useEffect, useRef } from "react";
import { toLonLat } from "ol/proj";
import type { Map as OLMap } from "ol";
import { useTranslation } from "@spatialhub/i18n";
import { pylovoService } from "@/features/configurator/services/pylovoService";
import { useAuthStore } from "@/store/auth-store";
import { isCoordinateInsidePolygons } from "@/features/configurator/utils/geometryUtils";
import { useModelStore } from "@/features/configurator/store/modelStore";

// ──────────────────────────────────────────────
// useAddTransformerMode
// ──────────────────────────────────────────────

interface AddTransformerOptions {
  map: OLMap | null;
  gridResultIds: number[];
  notification: {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
  };
  allPolygons: [number, number][][];
  refreshGrid: () => Promise<void>;
  existingModelId?: number;
  draftId?: string;
}

export interface AddTransformerModeState {
  isAddTransformerMode: boolean;
  newTransformerCoords: [number, number] | null;
  addTransformerDialogOpen: boolean;
  transformerCursorPos: { x: number; y: number } | null;
  toggleAddTransformerMode: () => void;
  setAddTransformerDialogOpen: (open: boolean) => void;
  setNewTransformerCoords: (coords: [number, number] | null) => void;
  setIsAddTransformerMode: (active: boolean) => void;
  resetAddTransformerMode: () => void;
  handleAddTransformer: (kva: number) => Promise<void>;
}

export const useAddTransformerMode = ({
  map,
  gridResultIds,
  notification,
  allPolygons,
  refreshGrid,
  existingModelId,
  draftId,
}: AddTransformerOptions): AddTransformerModeState => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const allPolygonsRef = useRef(allPolygons);
  allPolygonsRef.current = allPolygons;

  // Read/write mode + state from the unified store
  const activeMode = useModelStore((s) => s.activeMode);
  const setActiveMode = useModelStore((s) => s.setActiveMode);
  const newTransformerCoords = useModelStore((s) => s.newTransformerCoords);
  const setNewTransformerCoords = useModelStore((s) => s.setNewTransformerCoords);
  const addTransformerDialogOpen = useModelStore((s) => s.addTransformerDialogOpen);
  const setAddTransformerDialogOpen = useModelStore((s) => s.setAddTransformerDialogOpen);
  const transformerCursorPos = useModelStore((s) => s.transformerCursorPos);
  const setTransformerCursorPos = useModelStore((s) => s.setTransformerCursorPos);

  const isAddTransformerMode = activeMode === "add-transformer";

  const setIsAddTransformerMode = useCallback(
    (active: boolean) => {
      setActiveMode(active ? "add-transformer" : null);
    },
    [setActiveMode]
  );

  const toggleAddTransformerMode = useCallback(() => {
    setActiveMode(activeMode === "add-transformer" ? null : "add-transformer");
  }, [activeMode, setActiveMode]);

  const resetAddTransformerMode = useCallback(() => {
    setNewTransformerCoords(null);
    setAddTransformerDialogOpen(false);
    setActiveMode(null);
  }, [setNewTransformerCoords, setAddTransformerDialogOpen, setActiveMode]);

  const handleAddTransformer = useCallback(
    async (kva: number) => {
      if (!newTransformerCoords) {
        notification.showError("Invalid transformer location — please click on the map first");
        return;
      }

      try {
        const userId = user?.id ? String(user.id) : undefined;
        const result = await pylovoService.addTransformer({
          coordinates: newTransformerCoords,
          kva,
          grid_result_ids: gridResultIds,
          reassign_radius_m: 0,
          user_id: userId,
          model_id: existingModelId,
          draft_id: draftId,
        });

        notification.showSuccess(result.message || `Added transformer with ${kva} kVA`);

        if (allPolygons.length > 0) {
          await refreshGrid();
        }

        resetAddTransformerMode();
      } catch (error: any) {
        console.error("Failed to add transformer:", error);
        notification.showError(error?.message || "Failed to add transformer");
      }
    },
    [
      newTransformerCoords,
      gridResultIds,
      notification,
      allPolygons.length,
      refreshGrid,
      user?.id,
      existingModelId,
      draftId,
      resetAddTransformerMode,
    ]
  );

  // Map click handler for add transformer mode
  useEffect(() => {
    if (!map || !isAddTransformerMode) {
      setTransformerCursorPos(null);
      return;
    }

    const handleMapClick = (evt: any) => {
      const coords = map.getCoordinateFromPixel(evt.pixel);
      const lonLat = toLonLat(coords);
      const lonLatPair: [number, number] = [lonLat[0], lonLat[1]];

      if (!isCoordinateInsidePolygons(lonLatPair, allPolygonsRef.current)) {
        notification.showError(
          t("transformer.onlyInsidePolygon", "Transformers can only be placed inside the selected area")
        );
        return;
      }

      setNewTransformerCoords(lonLatPair);
      setAddTransformerDialogOpen(true);
    };

    const handleMouseMove = (evt: any) => {
      const mapElement = map.getTargetElement();
      if (mapElement) {
        const rect = mapElement.getBoundingClientRect();
        setTransformerCursorPos({
          x: evt.pixel[0] + rect.left,
          y: evt.pixel[1] + rect.top,
        });
      }
    };

    const handleMouseLeave = () => {
      setTransformerCursorPos(null);
    };

    map.on("click", handleMapClick);
    map.on("pointermove", handleMouseMove);

    const mapElement = map.getTargetElement();
    if (mapElement) {
      mapElement.style.cursor = "none";
      mapElement.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      map.un("click", handleMapClick);
      map.un("pointermove", handleMouseMove);
      if (mapElement) {
        mapElement.style.cursor = "";
        mapElement.removeEventListener("mouseleave", handleMouseLeave);
      }
      setTransformerCursorPos(null);
    };
  }, [map, isAddTransformerMode]);

  return {
    isAddTransformerMode,
    newTransformerCoords,
    addTransformerDialogOpen,
    transformerCursorPos,
    toggleAddTransformerMode,
    setAddTransformerDialogOpen,
    setNewTransformerCoords,
    setIsAddTransformerMode,
    resetAddTransformerMode,
    handleAddTransformer,
  };
};

// ──────────────────────────────────────────────
// useMoveTransformerMode
// ──────────────────────────────────────────────

interface MoveTransformerOptions {
  map: OLMap | null;
  notification: {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
  };
  allPolygons: [number, number][][];
  handlePolygonDrawn: (
    coordinates: [number, number][],
    allPolygons: [number, number][][]
  ) => Promise<void>;
  existingModelId?: number;
  draftId?: string;
}

export interface MoveTransformerModeState {
  isMoveTransformerMode: boolean;
  transformerToMove: number | null;
  transformerCursorPos: { x: number; y: number } | null;
  startMoveTransformer: (gridResultId: number) => void;
  setTransformerToMove: (id: number | null) => void;
  setIsMoveTransformerMode: (active: boolean) => void;
}

export const useMoveTransformerMode = ({
  map,
  notification,
  allPolygons,
  handlePolygonDrawn,
  existingModelId,
  draftId,
}: MoveTransformerOptions): MoveTransformerModeState => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const allPolygonsRef = useRef(allPolygons);
  allPolygonsRef.current = allPolygons;

  // Read/write mode + state from the unified store
  const activeMode = useModelStore((s) => s.activeMode);
  const setActiveMode = useModelStore((s) => s.setActiveMode);
  const transformerToMove = useModelStore((s) => s.transformerToMove);
  const setTransformerToMove = useModelStore((s) => s.setTransformerToMove);
  const transformerCursorPos = useModelStore((s) => s.transformerCursorPos);
  const setTransformerCursorPos = useModelStore((s) => s.setTransformerCursorPos);

  const isMoveTransformerMode = activeMode === "move-transformer";

  const setIsMoveTransformerMode = useCallback(
    (active: boolean) => {
      setActiveMode(active ? "move-transformer" : null);
    },
    [setActiveMode]
  );

  const startMoveTransformer = useCallback(
    (gridResultId: number) => {
      setTransformerToMove(gridResultId);
      setActiveMode("move-transformer");
    },
    [setTransformerToMove, setActiveMode]
  );

  // Map click handler for move transformer mode
  useEffect(() => {
    if (!map || !isMoveTransformerMode || !transformerToMove) {
      return;
    }

    const handleMapClick = async (evt: any) => {
      const coords = map.getCoordinateFromPixel(evt.pixel);
      const lonLat = toLonLat(coords);
      const lonLatPair: [number, number] = [lonLat[0], lonLat[1]];

      if (!isCoordinateInsidePolygons(lonLatPair, allPolygonsRef.current)) {
        notification.showError(
          t("transformer.onlyInsidePolygon", "Transformers can only be placed inside the selected area")
        );
        return;
      }

      try {
        const userId = user?.id ? String(user.id) : undefined;
        await pylovoService.moveTransformer(
          transformerToMove,
          [lonLat[0], lonLat[1]],
          userId,
          existingModelId,
          draftId
        );
        notification.showSuccess(t("transformer.movingSuccess"));
        if (allPolygons.length > 0) {
          const lastPolygon = allPolygons[allPolygons.length - 1];
          await handlePolygonDrawn(lastPolygon, allPolygons);
        }
      } catch (error) {
        console.error("Failed to move transformer:", error);
        notification.showError(t("transformer.movingFailed"));
      } finally {
        setActiveMode(null);
        setTransformerToMove(null);
      }
    };

    const handleMouseMove = (evt: any) => {
      const mapElement = map.getTargetElement();
      if (mapElement) {
        const rect = mapElement.getBoundingClientRect();
        setTransformerCursorPos({
          x: evt.pixel[0] + rect.left,
          y: evt.pixel[1] + rect.top,
        });
      }
    };

    const handleMouseLeave = () => {
      setTransformerCursorPos(null);
    };

    map.on("click", handleMapClick);
    map.on("pointermove", handleMouseMove);

    const mapElement = map.getTargetElement();
    if (mapElement) {
      mapElement.style.cursor = "none";
      mapElement.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      map.un("click", handleMapClick);
      map.un("pointermove", handleMouseMove);
      if (mapElement) {
        mapElement.style.cursor = "";
        mapElement.removeEventListener("mouseleave", handleMouseLeave);
      }
      setTransformerCursorPos(null);
    };
  }, [
    map,
    isMoveTransformerMode,
    transformerToMove,
    notification,
    t,
    allPolygons,
    handlePolygonDrawn,
    user?.id,
    existingModelId,
    draftId,
    setActiveMode,
    setTransformerToMove,
    setTransformerCursorPos,
  ]);

  return {
    isMoveTransformerMode,
    transformerToMove,
    transformerCursorPos,
    startMoveTransformer,
    setTransformerToMove,
    setIsMoveTransformerMode,
  };
};
