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
import { useHeatResolution } from "@/features/configurator/hooks/useHeatResolution";
import { useModelStore } from "@/features/configurator/store/modelStore";

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
import { HeatBootstrapDialog } from "./components/HeatBootstrapDialog";
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

  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;

    const handler = (e: BeforeUnloadEvent) => {
      if (useAuthStore.getState().isSessionExpired) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

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
  const activeMode = useModelStore((s) => s.activeMode);
  suppressDialogOnClickRef.current = activeMode !== null;

  // ── Heat-add bootstrap (one-time "auto-assign vs manual" prompt) ──
  const heatBootstrapOpen = useModelStore((s) => s.heatBootstrapOpen);
  const setHeatBootstrapOpen = useModelStore((s) => s.setHeatBootstrapOpen);
  const setHeatBootstrapPrompted = useModelStore((s) => s.setHeatBootstrapPrompted);
  const setHeatResolutionMode = useModelStore((s) => s.setHeatResolutionMode);

  // ── Available transformer sizes from API ─────────────────────────
  const [transformerSizes, setTransformerSizes] = useState<{ kva: number; cost_eur: number }[]>([]);
  useEffect(() => {
    pylovoService
      .getTransformerSizes()
      .then(setTransformerSizes)
      .catch((err) => {
        console.error("Failed to load transformer sizes:", err);
      });
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
  });

  // ── Transformer CRUD actions ─────────────────────────────────────
  const transformerActions = useTransformerActions({
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
    multiEditSelectedIds: multiEdit.multiEditSelectedIds,
  });

  // ── Heat resolution (expected-fit auto-resolve) ───────────────────
  const heatResolution = useHeatResolution({
    pylovoLayersRef: pylovoLayers.pylovoLayersRef,
    setIsModified,
  });

  // One-time "auto-assign vs manual" choice (fires after grid data loads).
  const handleHeatBootstrapAutoAssign = useCallback(async () => {
    setHeatResolutionMode("expected");
    await heatResolution.resolveAllBuildingsHeat();
    setHeatBootstrapPrompted(true);
    setHeatBootstrapOpen(false);
    notification.showSuccess(
      t("gridNotifications.heatResolved") || "Heat technologies auto-assigned."
    );
  }, [setHeatResolutionMode, heatResolution, setHeatBootstrapPrompted,
    setHeatBootstrapOpen, notification, t]);

  const handleHeatBootstrapManual = useCallback(() => {
    setHeatResolutionMode("manual");
    setHeatBootstrapPrompted(true);
    setHeatBootstrapOpen(false);
  }, [setHeatResolutionMode, setHeatBootstrapPrompted, setHeatBootstrapOpen]);

  // Toolbar "Resolve heat" — re-run the expected-fit auto-assign on demand.
  const [isResolvingHeat, setIsResolvingHeat] = useState(false);
  const handleResolveAllHeat = useCallback(async () => {
    if (isResolvingHeat) return;
    setIsResolvingHeat(true);
    try {
      const count = await heatResolution.resolveAllBuildingsHeat();
      notification.showSuccess(
        t("gridNotifications.heatResolved", { count }) ||
          `${count} building${count === 1 ? "" : "s"} heat-resolved.`
      );
    } finally {
      setIsResolvingHeat(false);
    }
  }, [isResolvingHeat, heatResolution, notification, t]);

  // ── 3D MapLibre handlers ─────────────────────────────────────────
  const ml3d = useMapLibre3DHandlers({
    mapInteractions,
    buildingAssign,
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
  const assignStep = useModelStore((s) => s.assignStep);
  const reassignmentLineAnchor = useModelStore((s) => s.reassignmentLineAnchor);
  useReassignmentLine({
    map,
    active: activeMode === "assign-buildings" && assignStep === "select-transformer",
    buildingCoords: reassignmentLineAnchor,
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

  // ── Drawing helpers ──────────────────────────────────────────────
  const showDrawHint =
    state.cursorPos &&
    !state.isDrawing &&
    (state.allowMultiplePolygons || state.allPolygons.length === 0);

  const handlePolygonDrawnWithLimit = async (
    coordinates: [number, number][],
    allPolygons: [number, number][][]
  ) => {
    await actions.handlePolygonDrawn(coordinates, allPolygons);
  };

  const isMapLibre3D = useMapStore((s) => s.selectedBaseLayerId === "maplibre_3d");

  // ── Render ───────────────────────────────────────────────────────
  return (
    <Fragment>
      <Notification
        isOpen={notification.data.open}
        message={notification.data.message}
        severity={notification.data.severity}
        onClose={notification.hide}
      />
      <LoadingOverlay isOpen={editMode && state.isLoadingModel} />

      <MapContainer
        key={editMode ? `edit-${existingModelId}` : "create"}
        modal={false}
        topBar={null}
        sidebar={
          <SidebarPanel
            state={state}
            actions={actions}
            allPolygonsCount={state.allPolygons.length}
            showAdvancedParams={state.showAdvancedParams}
            onOpenAdvancedParams={() => actions.setShowAdvancedParams(true)}
            onCloseAdvancedParams={() => actions.setShowAdvancedParams(false)}
            advancedParams={state.advancedParams}
            onAdvancedParamsChange={actions.setAdvancedParams}
            onResetAdvancedParams={actions.handleResetAdvancedParams}
            handleModelNameChange={(e) => actions.setModelName(e.target.value)}
            getDateBounds={getDateBounds}
            editMode={editMode}
            showTechDrawer={techOperations.showTechDrawer}
            onOpenTechDrawer={() => techOperations.setShowTechDrawer(true)}
            onCloseTechDrawer={() => techOperations.setShowTechDrawer(false)}
            onTechDragStart={techOperations.handleTechDragStart}
            onTechDragEnd={techOperations.handleTechDragEnd}
            onAddTechToAll={techOperations.handleAddTechToAll}
            onRemoveTechFromAll={techOperations.handleRemoveTechFromAll}
            appliedTechKeys={techOperations.appliedTechKeys}
            gridResultIds={gridResultIds}
            buildingsCount={buildingsInPolygonCount}
            peakLoadKw={peakLoadInPolygonKw}
            regionName={regionName}
            polygonCoordinates={state.allPolygons}
            isModified={state.isModified}
          />
        }
        onDrop={techOperations.handleMapDrop}
        onDragOver={techOperations.handleMapDragOver}
        mapOverlays={
          <>
            {map && isMapLibre3D && (
              <MapLibre3DOverlay
                olMap={map}
                buildingsGeoJSON={pylovoLayers.pylovoGridData?.buildings}
                linesGeoJSON={pylovoLayers.pylovoGridData?.lines}
                mvLinesGeoJSON={pylovoLayers.pylovoGridData?.mv_lines}
                transformersGeoJSON={pylovoLayers.pylovoGridData?.transformers}
                availableBoundaryGeoJSON={pylovoLayers.availableBoundaryGeoJSON}
                selectedBoundaryFeature={pylovoLayers.regionBoundary?.boundary}
                showBoundary={pylovoLayers.showBoundary}
                polygonCoordinates={state.allPolygons}
                selectedBuildingOsmIds={buildingAssign.selectedBuildingsForAssign}
                isBuildingAssignMode={buildingAssign.isBuildingAssignMode}
                visible={isMapLibre3D}
                isDrawing={state.isDrawing}
                onBuildingClick={ml3d.handleMl3dBuildingClick}
                onTransformerClick={ml3d.handleMl3dTransformerClick}
                onBuildingHover={ml3d.handleMl3dBuildingHover}
                onTransformerHover={ml3d.handleMl3dTransformerHover}
                onMvLineHover={ml3d.handleMl3dMvLineHover}
                onMapClick={ml3d.handleMl3dMapClick}
                onBoundaryRegionClick={regionSelection.handleBoundaryRegionClick}
              />
            )}
            <MapOverlays
              showDrawHint={Boolean(showDrawHint)}
              cursorPos={state.cursorPos}
              transformerTooltip={mapInteractions.transformerTooltip}
              buildingTooltip={mapInteractions.buildingTooltip}
              mvLineTooltip={mapInteractions.mvLineTooltip}
              isDraggingTech={!!techOperations.draggingTech}
              isGeneratingGrid={state.isGeneratingGrid}
              simulateEV={simulateEV}
              gridIdToTrafoCapacity={gridIdToTrafoCapacity}
              gridIdToPeakLoad={gridIdToPeakLoad}
            />
            {!editMode && (
              <PolygonDrawingGuide
                canDraw={state.allowMultiplePolygons || state.allPolygons.length === 0}
                isDrawing={state.isDrawing}
                polygonCount={state.allPolygons.length}
                currentPointCount={currentPointCount}
                enableEditing={true}
                isGeneratingGrid={state.isGeneratingGrid}
                hasGridData={(pylovoLayers.pylovoGridData?.buildings?.features?.length ?? 0) > 0}
                isRunningPowerFlow={pylovoLayers.isRunningPowerFlow}
                hasPowerFlowResults={pylovoLayers.powerFlowResults.size > 0}
              />
            )}
            <GridActionBar
              hasGridData={(pylovoLayers.pylovoGridData?.buildings?.features?.length ?? 0) > 0}
              isAddTransformerMode={addTransformer.isAddTransformerMode}
              onToggleAddTransformerMode={addTransformer.toggleAddTransformerMode}
              isBuildingAssignMode={buildingAssign.isBuildingAssignMode}
              onStartBuildingAssignMode={buildingAssign.startBuildingAssignMode}
              onRunPowerFlow={handleRunPowerFlow}
              isRunningPowerFlow={pylovoLayers.isRunningPowerFlow}
              hasPowerFlowResults={pylovoLayers.powerFlowResults.size > 0}
              onResolveAllHeat={handleResolveAllHeat}
              isResolvingHeat={isResolvingHeat}
            />
            <MapInteractionBanners
              isAddTransformerMode={addTransformer.isAddTransformerMode}
              isBuildingAssignMode={buildingAssign.isBuildingAssignMode}
              isAssigning={buildingAssign.isAssigning}
              assignStep={buildingAssign.assignStep}
              selectedBuildingsForAssign={buildingAssign.selectedBuildingsForAssign}
              isRunningPowerFlow={pylovoLayers.isRunningPowerFlow}
              onNextStep={() => buildingAssign.setAssignStep("select-transformer")}
              onBackStep={() => buildingAssign.setAssignStep("select-buildings")}
              onCancelAssign={buildingAssign.clearBuildingAssignMode}
              onCancelAddTransformer={addTransformer.resetAddTransformerMode}
            />
            <PowerFlowLegend
              visible={pylovoLayers.powerFlowResults.size > 0}
              customTransformers={customTransformers}
            />
          </>
        }
        mapHeader={
          <MapHeader
            allPolygonsCount={state.allPolygons.length}
            allowMultiplePolygons={state.allowMultiplePolygons}
            onToggleAllowMultiplePolygons={actions.setAllowMultiplePolygons}
            onClearAllPolygons={regionSelection.handleClearAllWithModes}
            isLoadingPreference={isLoadingPreference}
            currentWorkspace={currentWorkspace}
            preferredWorkspaceId={preferredWorkspaceId ?? undefined}
            normalizedWorkspaceId={normalizedWorkspaceId}
            onWorkspaceChange={handleWorkspaceChange}
            onOpenCreateWorkspace={() => setIsCreateWsOpen(true)}
            includePublicBuildings={state.includePublicBuildings}
            includePrivateBuildings={state.includePrivateBuildings}
            onTogglePublicBuildings={actions.setIncludePublicBuildings}
            onTogglePrivateBuildings={actions.setIncludePrivateBuildings}
            simulateEV={simulateEV}
            onToggleSimulateEV={setSimulateEV}
            availableRegions={editMode ? undefined : pylovoLayers.availableRegions}
            onRegionSelect={editMode ? undefined : regionSelection.handleRegionSelect}
          />
        }
        showSidebar={true}
      />

      <AreaSelectTour
        isOpen={state.showAreaSelectTour}
        onComplete={actions.handleTourComplete}
        onSkip={actions.handleTourSkip}
      />

      <PolygonDrawer
        map={map}
        onPolygonDrawn={handlePolygonDrawnWithLimit}
        onPolygonModified={actions.handlePolygonModified}
        onDrawingChange={actions.setIsDrawing}
        onPointCountChange={setCurrentPointCount}
        onClearAll={regionSelection.handleClearAllWithModes}
        allowMultiple={state.allowMultiplePolygons}
        clearTrigger={state.clearTrigger}
        initialPolygons={editMode ? state.loadedCoordinates : undefined}
        disableAfterDraw={!state.allowMultiplePolygons}
        enableEditing={true}
        labels={{
          clickToClose: t("drawing.clickToClose"),
          start: t("drawing.start"),
        }}
      />

      <TransformerDialog
        open={mapInteractions.transformerDialogOpen}
        selectedTransformer={mapInteractions.selectedTransformer}
        transformerSizes={transformerSizes}
        onClose={mapInteractions.handleCloseTransformerDialog}
        onChangeKva={transformerActions.handleTransformerKvaChange}
        onOpenChange={mapInteractions.setTransformerDialogOpen}
        onDeleteTransformer={transformerActions.handleDeleteTransformer}
        onMoveTransformer={(gridResultId) => {
          moveTransformer.startMoveTransformer(gridResultId);
          mapInteractions.setTransformerDialogOpen(false);
        }}
        isUserPlaced={mapInteractions.selectedTransformer?.osmId?.startsWith("user/") || false}
      />

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

      <BuildingDialog
        open={mapInteractions.buildingDialogOpen}
        selectedBuilding={mapInteractions.selectedBuilding}
        onClose={mapInteractions.handleCloseBuildingDialog}
        onFClassDemandChange={buildingDemand.handleFClassDemandChange}
        onHeatDemandChange={buildingDemand.handleHeatDemandChange}
        onSelectedFClassChange={buildingDemand.handleSelectedFClassChange}
        onOpenChange={mapInteractions.setBuildingDialogOpen}
        onEditTech={(techKey) => {
          if (mapInteractions.selectedBuildingFeature) {
            mapInteractions.setBuildingDialogOpen(false);
            techOperations.handleEditTechFromDialog(
              techKey,
              mapInteractions.selectedBuildingFeature
            );
          }
        }}
        onRemoveTech={(techKey) => {
          if (mapInteractions.selectedBuildingFeature) {
            const updatedTechs = techOperations.handleRemoveTechFromDialog(
              techKey,
              mapInteractions.selectedBuildingFeature
            );
            mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
              prev ? { ...prev, techs: updatedTechs } : null
            );
          }
        }}
        onFloorsChange={buildingDemand.handleFloorsChange}
        onAreaChange={buildingDemand.handleAreaChange}
        onHouseholdSizeChange={buildingDemand.handleHouseholdSizeChange}
        onRecalculateDemand={buildingDemand.handleRecalculateDemand}
        onAddTech={
          multiEdit.isMultiEdit
            ? techDialogFlow.handleApplyTechToSelected
            : techDialogFlow.handleAddTechFromDialog
        }
        isMultiEdit={multiEdit.isMultiEdit}
        onToggleMultiEdit={multiEdit.toggleMultiEdit}
        multiEditCount={multiEdit.multiEditSelectedIds.size}
        onApplyTechToAll={techDialogFlow.handleApplyTechToSelected}
        isExcluded={(() => {
          const osmId = mapInteractions.selectedBuilding?.osmId;
          if (!osmId) return false;
          const numId = typeof osmId === "number" ? osmId : Number.parseInt(String(osmId), 10);
          return numId < 0 && state.excludedBuildingIds.has(Math.abs(numId));
        })()}
        onToggleExclude={actions.toggleBuildingExclusion}
        onSave={() => setIsModified(true)}
        onApplyTemplate={(templateTechs) => {
          if (mapInteractions.selectedBuildingFeature) {
            const feature = mapInteractions.selectedBuildingFeature;
            for (const [techKey, techData] of Object.entries(templateTechs)) {
              feature.set(`tech_${techKey}`, JSON.stringify(techData));
            }
            mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
              prev ? { ...prev, techs: { ...prev.techs, ...templateTechs } } : null
            );
          }
          setIsModified(true);
        }}
      />

      <HeatBootstrapDialog
        open={heatBootstrapOpen}
        onOpenChange={setHeatBootstrapOpen}
        onAutoAssign={handleHeatBootstrapAutoAssign}
        onManual={handleHeatBootstrapManual}
      />

      <CreateWorkspaceModal
        isOpen={isCreateWsOpen}
        onClose={() => setIsCreateWsOpen(false)}
        onSuccess={(newWorkspace) => {
          setIsCreateWsOpen(false);
          handleWorkspaceChange(newWorkspace);
        }}
      />

      <TechParameterDialog
        open={techOperations.techDialogOpen}
        onOpenChange={techOperations.setTechDialogOpen}
        technology={techOperations.selectedTechForDialog}
        building={techOperations.selectedBuildingForTech}
        onSave={techOperations.handleSaveTechToBuildingBulk}
        onClose={() => {
          techOperations.setTechDialogOpen(false);
          techOperations.setSelectedTechForDialog(null);
          techOperations.setSelectedBuildingForTech(null);
          techOperations.setIsAddingTechToAll(false);
          if (techDialogFlow.techAddedFromBuildingDialogRef.current) {
            techDialogFlow.techAddedFromBuildingDialogRef.current = false;
            const feat = mapInteractions.selectedBuildingFeature;
            if (feat) {
              const updatedTechs = feat.get("techs") || {};
              mapInteractions.setSelectedBuilding(
                (prev: typeof mapInteractions.selectedBuilding) =>
                  prev ? { ...prev, techs: { ...updatedTechs } } : null
              );
            }
            mapInteractions.setBuildingDialogOpen(true);
          }
        }}
        showApplyToAll={techOperations.isAddingTechToAll}
      />

      <TransformerCursorOverlay
        isAddTransformerMode={addTransformer.isAddTransformerMode}
        isMoveTransformerMode={moveTransformer.isMoveTransformerMode}
        cursorPos={
          addTransformer.isAddTransformerMode
            ? addTransformer.transformerCursorPos
            : moveTransformer.transformerCursorPos
        }
      />

      <UnsavedChangesDialog
        open={unsavedDialog.showUnsavedDialog}
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
