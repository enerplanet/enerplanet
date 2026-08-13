import { useEffect, Fragment, useCallback, useMemo, useState, useRef, type FC } from "react";
import { useLocation, useParams } from "react-router-dom";
import { parseDate } from "@internationalized/date";
import { transformExtent } from "ol/proj";
import { useTranslation } from "@spatialhub/i18n";

import { AreaSelectTour } from "@/features/guided-tour/AreaSelectTour";
import { MapContainer } from "@/components/shared/MapContainer";
import { useAreaSelect, type AreaData } from "@/features/configurator/hooks/useAreaSelect";
import { PolygonDrawer } from "@/features/polygon-drawer";
import { PolygonDrawingGuide } from "@/components/map-controls/PolygonDrawingGuide";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
import { type Workspace } from "@/components/workspace/services/workspaceService";
import Notification from "@/components/ui/Notification";
import { MapLibre3DOverlay } from "@/components/map-controls/maplibre";
import { GridActionBar } from "@/components/map-controls/GridActionBar";
import { useMapProvider } from "@/providers/map-context";
import { useAuthStore } from "@/store/auth-store";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useDefaultRegionStore } from "@/features/configurator/region-selector/store/default-region";
import { useReassignmentLine } from "@/features/configurator/hooks/useMapDisplay";
import { generateUUID } from "@/utils/uuid";
import { pylovoService } from "@/features/configurator/services/pylovoService";
import {
  usePolygonLimitsStore,
  type AccessLevel,
} from "@/features/polygon-drawer/store/polygon-limits-store";

// Extracted hooks
import {
  useAddTransformerMode,
  useMoveTransformerMode,
} from "@/features/configurator/hooks/useTransformerMode";
import { useBuildingAssignMode } from "@/features/configurator/hooks/useBuildingAssignMode";
import { useMultiEditMode } from "@/features/configurator/hooks/useMultiEditMode";
import { useBuildingDemandRecalculation } from "@/features/configurator/hooks/useBuildingDemandRecalculation";
import { useRegionName, useRegionSelection } from "@/features/configurator/hooks/useRegion";
import { useMapResize, useMapLibre3DHandlers } from "@/features/configurator/hooks/useMapDisplay";
import { useTransformerActions } from "@/features/configurator/hooks/useTransformerActions";
import { useTechDialogFlow } from "@/features/configurator/hooks/useTechDialogFlow";

// Extracted selectors
import {
  useGridResultIds,
  useGridIdToTrafoCapacity,
  useGridIdToPeakLoad,
  useGridIdToConnectedBuildings,
  useBuildingsInPolygonCount,
  usePeakLoadInPolygonKw,
  useCustomTransformers,
} from "@/features/configurator/region-selector/selectors/gridDataSelectors";

// Extracted components
import { MapOverlays } from "./components/MapOverlays";
import { MapHeader } from "./components/MapHeader";
import { SidebarPanel } from "./components/SidebarPanel";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { TransformerDialog } from "./components/TransformerDialog";
import { AddTransformerDialog } from "./components/AddTransformerDialog";
import { BuildingDialog } from "./components/BuildingDialog";
import { TechParameterDialog } from "./components/TechParameterDialog";
import { PowerFlowLegend } from "./components/PowerFlowLegend";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { MapInteractionBanners } from "./components/MapInteractionBanners";
import { TransformerCursorOverlay } from "./components/TransformerCursorOverlay";

const DATE_BOUNDS = { minYear: 2015, maxYear: 2025 };

const getDateBounds = () => ({
  minValue: parseDate(`${DATE_BOUNDS.minYear}-01-01`),
  maxValue: parseDate(`${DATE_BOUNDS.maxYear}-12-31`),
  minYear: DATE_BOUNDS.minYear,
  maxYear: DATE_BOUNDS.maxYear,
});

interface AreaSelectProps {
  onAreaSelected?: (areaData: AreaData) => void;
  onCancel?: () => void;
  editMode?: boolean;
  existingModelId?: number;
}

export const AreaSelect: FC<AreaSelectProps> = ({
  onAreaSelected,
  onCancel,
  editMode = false,
  existingModelId: existingModelIdProp,
}: AreaSelectProps) => {
  const { t } = useTranslation();
  const { clearDrawingLayers } = useMapProvider();

  // Get model ID from URL params in edit mode
  const { id: urlModelId } = useParams<{ id: string }>();
  const existingModelId = existingModelIdProp ?? (urlModelId ? Number(urlModelId) : undefined);

  // Set document title based on mode
  useDocumentTitle(editMode ? "Edit Model" : "New Model", " | EnerPlanET");

  const location = useLocation();
  const passedWorkspaceId = location.state?.workspaceId;
  const normalizedWorkspaceId =
    typeof passedWorkspaceId === "number" ? passedWorkspaceId : undefined;

  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const preferredWorkspaceId = useWorkspaceStore((state) => state.preferredWorkspaceId);
  const isLoadingPreference = useWorkspaceStore((state) => state.isLoading);
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);
  const initializeWorkspace = useWorkspaceStore((state) => state.initializeWorkspace);

  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [wsReloadKey, setWsReloadKey] = useState(0);
  const [simulateEV, setSimulateEV] = useState(false);
  const [currentPointCount, setCurrentPointCount] = useState(0);

  // Draft ID for scoping user-placed transformers to this model session
  const [draftId, setDraftId] = useState<string | undefined>(() => {
    return editMode === false ? generateUUID() : undefined;
  });

  // Store ref for cleanup
  const clearDrawingLayersRef = useRef(clearDrawingLayers);
  clearDrawingLayersRef.current = clearDrawingLayers;

  // Polygon limits - fetch on mount
  const fetchLimits = usePolygonLimitsStore((state) => state.fetchLimits);
  const limits = usePolygonLimitsStore((state) => state.limits);
  const user = useAuthStore((state) => state.user);

  const buildingLimit = useMemo(() => {
    const accessLevel = (user?.access_level ?? "very_low") as AccessLevel;
    return limits[accessLevel] ?? 50;
  }, [user?.access_level, limits]);

  useEffect(() => {
    fetchLimits();
  }, [fetchLimits]);

  useEffect(() => {
    initializeWorkspace();
  }, [initializeWorkspace]);

  useEffect(() => {
    if (!isLoadingPreference) {
      setTimeout(() => setWsReloadKey((prev: number) => prev + 1), 0);
    }
  }, [isLoadingPreference, preferredWorkspaceId]);

  const handleWorkspaceChange = useCallback(
    (workspace: Workspace | null) => {
      setCurrentWorkspace(workspace);
    },
    [setCurrentWorkspace]
  );

  // Ref that the map-interaction layer reads at click time to know whether
  // a mode (add/move transformer, building assign) is suppressing dialogs.
  // A ref is used because the mode states live in hooks called after useAreaSelect.
  const suppressDialogOnClickRef = useRef(false);

  const {
    state,
    actions,
    pylovoLayers,
    techOperations,
    mapInteractions,
    notification,
    setCursorPos,
    map,
    mapRef,
    unsavedDialog,
    setIsModified,
  } = useAreaSelect({
    onAreaSelected,
    onCancel,
    editMode,
    existingModelId,
    buildingLimit,
    suppressDialogOnClickRef,
    draftId,
  });

  // Fly to default region immediately when map is ready (before saved map location kicks in)
  const hasAppliedDefaultRegion = useRef(false);
  const defaultRegion = useDefaultRegionStore((s) => s.defaultRegion);
  useEffect(() => {
    if (!map || hasAppliedDefaultRegion.current || editMode) return;
    if (!defaultRegion?.bbox) return;
    hasAppliedDefaultRegion.current = true;
    const view = map.getView();
    view.cancelAnimations();
    const { west, south, east, north } = defaultRegion.bbox;
    const extent = transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857");
    view.fit(extent, {
      padding: [60, 60, 60, 60],
      duration: 0,
      maxZoom: 14,
    });
  }, [map, defaultRegion, editMode]);

  // Unsaved changes guard — skip when navigating due to session expiry
  const isDirty = state.allPolygons.length > 0;
  const isSessionExpired = useAuthStore((state) => state.isSessionExpired);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (useAuthStore.getState().isSessionExpired) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, isSessionExpired]);

  // ── Extracted hooks ──────────────────────────────────────────────

  const refreshGrid = useCallback(async () => {
    if (state.allPolygons.length > 0) {
      await actions.handlePolygonModified(state.allPolygons);
    }
  }, [state.allPolygons, actions]);

  const addTransformer = useAddTransformerMode({
    map,
    gridResultIds: useGridResultIds(pylovoLayers.pylovoGridData),
    notification,
    allPolygons: state.allPolygons,
    refreshGrid,
    existingModelId,
    draftId,
  });

  const moveTransformer = useMoveTransformerMode({
    map,
    notification,
    allPolygons: state.allPolygons,
    handlePolygonDrawn: actions.handlePolygonDrawn,
    existingModelId,
    draftId,
  });

  const buildingAssign = useBuildingAssignMode({
    map,
    notification,
    allPolygons: state.allPolygons,
    refreshGrid,
    pylovoGridData: pylovoLayers.pylovoGridData,
    existingModelId,
    draftId,
  });

  const multiEdit = useMultiEditMode();

  const buildingDemand = useBuildingDemandRecalculation({
    selectedBuilding: mapInteractions.selectedBuilding,
    setSelectedBuilding: mapInteractions.setSelectedBuilding,
    pylovoLayers,
    notification,
  });

  // ── Derived data (selectors) ─────────────────────────────────────

  const gridResultIds = useGridResultIds(pylovoLayers.pylovoGridData);
  const gridIdToTrafoCapacity = useGridIdToTrafoCapacity(pylovoLayers.pylovoGridData);
  const gridIdToPeakLoad = useGridIdToPeakLoad(pylovoLayers.pylovoGridData);
  const gridIdToConnectedBuildings = useGridIdToConnectedBuildings(pylovoLayers.pylovoGridData);
  const buildingsInPolygonCount = useBuildingsInPolygonCount(pylovoLayers.pylovoGridData);
  const peakLoadInPolygonKw = usePeakLoadInPolygonKw(pylovoLayers.pylovoGridData);
  const customTransformers = useCustomTransformers(pylovoLayers.pylovoGridData);

  // ── Update ref so useMapInteractions reads the latest value at click time ──
  suppressDialogOnClickRef.current =
    addTransformer.isAddTransformerMode ||
    moveTransformer.isMoveTransformerMode ||
    buildingAssign.isBuildingAssignMode;

  // ── Available transformer sizes from API ─────────────────────────
  const [transformerSizes, setTransformerSizes] = useState<{ kva: number; cost_eur: number }[]>([]);
  useEffect(() => {
    pylovoService.getTransformerSizes().then(setTransformerSizes);
  }, []);

  // ── Reverse geocode polygon centroid to get region name ──────────
  const regionName = useRegionName(state.allPolygons);

  // ── Map resize handling ──────────────────────────────────────────
  useMapResize(map, mapRef);

  // ── Region selection helpers ─────────────────────────────────────
  const regionSelection = useRegionSelection({
    map,
    editMode,
    handleClearAllPolygons: actions.handleClearAllPolygons,
    resetAddTransformerMode: addTransformer.resetAddTransformerMode,
    clearBuildingAssignMode: buildingAssign.clearBuildingAssignMode,
    setDraftId: (id: string) => setDraftId(id),
    availableRegions: pylovoLayers.availableRegions ?? [],
  });

  // ── Transformer CRUD actions ─────────────────────────────────────
  const transformerActions = useTransformerActions({
    selectedTransformer: mapInteractions.selectedTransformer,
    setSelectedTransformer: mapInteractions.setSelectedTransformer,
    updateTransformerKva: pylovoLayers.updateTransformerKva,
    notification,
    userId: user?.id ? String(user.id) : undefined,
    existingModelId,
    draftId,
    allPolygons: state.allPolygons,
    handlePolygonModified: actions.handlePolygonModified,
  });

  // ── Tech dialog flow ─────────────────────────────────────────────
  const techDialogFlow = useTechDialogFlow({
    mapInteractions,
    techOperations,
    multiEditSelectedIds: multiEdit.multiEditSelectedIds,
  });

  // ── 3D MapLibre handlers ─────────────────────────────────────────
  const ml3d = useMapLibre3DHandlers({
    addTransformer,
    moveTransformer,
    buildingAssign,
    mapInteractions,
    gridIdToConnectedBuildings,
    notification,
    t,
  });

  // ── Mouse tracking for overlays ──────────────────────────────────
  useEffect(() => {
    const el = mapRef?.current as HTMLElement | null;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      setCursorPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
    };
    const onLeave = () => setCursorPos(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [mapRef, setCursorPos]);

  // ── Cleanup polygon on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      clearDrawingLayersRef.current();
    };
  }, []);

  // ── Reassignment line (visual dashed line from building to cursor) ──
  useReassignmentLine({
    map,
    active:
      buildingAssign.isBuildingAssignMode && buildingAssign.assignStep === "select-transformer",
    buildingCoords: buildingAssign.reassignmentLineAnchor,
  });

  // ── Handle run power flow ────────────────────────────────────────
  const handleRunPowerFlow = useCallback(async () => {
    try {
      const success = await pylovoLayers.runPowerFlowAnalysis();
      if (success) {
        notification.showSuccess(
          t("simulation.powerFlow.success") ||
            "Power flow analysis completed. Line colors now show load utilization."
        );
      } else {
        notification.showError(
          t("simulation.powerFlow.noData") || "No grid data available for power flow analysis."
        );
      }
      return success;
    } catch (error) {
      console.error("Power flow analysis error:", error);
      notification.showError(
        t("simulation.powerFlow.error") || "Power flow analysis failed. Check console for details."
      );
      return false;
    }
  }, [pylovoLayers, notification, t]);

        onContinue={() => unsavedDialog.setShowUnsavedDialog(false)}
        onDiscard={unsavedDialog.handleUnsavedDiscard}
        onOpenChange={(open: boolean) => {
          if (!open) {
            unsavedDialog.setShowUnsavedDialog(false);
          }
        }}
      />
    </Fragment>
  );
};
      {/* Add Transformer Dialog */}
      <AddTransformerDialog
        open={addTransformer.addTransformerDialogOpen}
        coords={addTransformer.newTransformerCoords}
        transformerSizes={transformerSizes}
        onAdd={addTransformer.handleAddTransformer}
        onClose={() => {
          addTransformer.setAddTransformerDialogOpen(false);
          addTransformer.setNewTransformerCoords(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            addTransformer.setAddTransformerDialogOpen(false);
            addTransformer.setNewTransformerCoords(null);
          }
        }}
      />
