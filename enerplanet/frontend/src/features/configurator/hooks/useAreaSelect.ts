import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { modelService } from '@/features/model-dashboard/services/modelService';
import { useCreateModelMutation, useUpdateModelMutation2 } from '@/features/model-dashboard/hooks/useModelsQuery';
import GeoJSON from 'ol/format/GeoJSON';
import axios from '@/lib/axios';
import type { AreaData, UseAreaSelectProps, PylovoGridData } from '@/features/configurator/types/area-select';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation } from '@spatialhub/i18n';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { useMapProvider } from '@/providers/map-context';
import { getDefaultAdvancedParameters } from '@/features/configurator/constants/area-select-params';
import { pylovoService } from '@/features/configurator/services/pylovoService';
import { useModelStore } from '@/features/configurator/store/modelStore';
import { useCustomLocationLayers } from '@/features/configurator/hooks/useCustomLocationLayers';
import { usePylovoLayers } from '@/features/configurator/hooks/usePylovoLayers';
import { useTechDragDrop } from '@/features/configurator/hooks/useTechDragDrop';
import { useMapClickHandlers } from '@/features/configurator/hooks/useMapClickHandlers';
import { generateUUID } from '@/utils/uuid';

export { type AreaData } from '@/features/configurator/types/area-select';

const DASHBOARD_ROUTE = "/app/model-dashboard";

export const useAreaSelect = ({
    onAreaSelected, onCancel, editMode = false, existingModelId, buildingLimit = 0,
    suppressDialogOnClickRef, draftId: draftIdProp,
}: UseAreaSelectProps & { buildingLimit?: number }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const modelId = editMode ? (existingModelId || Number.parseInt(params.id || '0', 10)) : undefined;
    const { notification, showSuccess, showError, hide } = useNotification();
    const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);
    const { map } = useMapStore();
    const { mapRef } = useMapProvider();

    // ── Local state not in store ──
    const [draftId] = useState<string | undefined>(draftIdProp || (editMode === false ? generateUUID() : undefined));
    const [loadedCoordinates, setLoadedCoordinates] = useState<[number, number][][]>();
    const [loadedConfig, setLoadedConfig] = useState<PylovoGridData | undefined>();
    const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);
    const isInternalNavRef = useRef(false);
    const gridGenIdRef = useRef(0);
    const originalModelRef = useRef<{ title: string; from_date: string; to_date: string; resolution: number; config: any; status: string } | null>(null);
    const editModeInitializedRef = useRef(false);

    // ── Store-bound state ──
    const modelName = useModelStore((s) => s.modelName); const setModelName = useModelStore((s) => s.setModelName);
    const fromDate = useModelStore((s) => s.fromDate); const setFromDate = useModelStore((s) => s.setFromDate);
    const toDate = useModelStore((s) => s.toDate); const setToDate = useModelStore((s) => s.setToDate);
    const resolution = useModelStore((s) => s.resolution); const setResolution = useModelStore((s) => s.setResolution);
    const isSaving = useModelStore((s) => s.isSaving); const setIsSaving = useModelStore((s) => s.setIsSaving);
    const isLoadingModel = useModelStore((s) => s.isLoadingModel); const setIsLoadingModel = useModelStore((s) => s.setIsLoadingModel);
    const isGeneratingGrid = useModelStore((s) => s.isGeneratingGrid); const setIsGeneratingGrid = useModelStore((s) => s.setIsGeneratingGrid);
    const showAreaSelectTour = useModelStore((s) => s.showAreaSelectTour); const setShowAreaSelectTour = useModelStore((s) => s.setShowAreaSelectTour);
    const allPolygons = useModelStore((s) => s.allPolygons); const setAllPolygons = useModelStore((s) => s.setAllPolygons);
    const isDrawing = useModelStore((s) => s.isDrawing); const setIsDrawing = useModelStore((s) => s.setIsDrawing);
    const allowMultiplePolygons = useModelStore((s) => s.allowMultiplePolygons); const setAllowMultiplePolygons = useModelStore((s) => s.setAllowMultiplePolygons);
    const clearTrigger = useModelStore((s) => s.clearTrigger); const incrementClearTrigger = useModelStore((s) => s.incrementClearTrigger);
    const cursorPos = useModelStore((s) => s.cursorPos); const setCursorPos = useModelStore((s) => s.setCursorPos);
    const showAdvancedParams = useModelStore((s) => s.showAdvancedParams); const setShowAdvancedParams = useModelStore((s) => s.setShowAdvancedParams);
    const advancedParams = useModelStore((s) => s.advancedParams); const setAdvancedParams = useModelStore((s) => s.setAdvancedParams);
    const isModified = useModelStore((s) => s.isModified); const setIsModified = useModelStore((s) => s.setIsModified);
    const showUnsavedDialog = useModelStore((s) => s.showUnsavedDialog); const setShowUnsavedDialog = useModelStore((s) => s.setShowUnsavedDialog);
    const includePublicBuildings = useModelStore((s) => s.includePublicBuildings); const setIncludePublicBuildings = useModelStore((s) => s.setIncludePublicBuildings);
    const includePrivateBuildings = useModelStore((s) => s.includePrivateBuildings); const setIncludePrivateBuildings = useModelStore((s) => s.setIncludePrivateBuildings);
    const excludedBuildingIds = useModelStore((s) => s.excludedBuildingIds); const toggleBuildingExclusion = useModelStore((s) => s.toggleBuildingExclusion);
    const clearExcludedBuildings = useModelStore((s) => s.clearExcludedBuildings);

    // ── 4 extracted internal hooks ──
    const customLocationsData = useCustomLocationLayers(map, allPolygons);
    const pylovoLayersData = usePylovoLayers({ map, editMode, loadedConfig });
    const techOperationsData = useTechDragDrop({ map, mapRef, pylovoLayersRef: pylovoLayersData.pylovoLayersRef, showSuccess, showError, t, setIsModified });
    const mapInteractionsData = useMapClickHandlers({ map, isDrawing, pylovoLayersRef: pylovoLayersData.pylovoLayersRef, suppressDialogOnClickRef, suppressMapInteractions: false });

    // ── Load existing model ──
    useEffect(() => { if (editMode && modelId) loadExistingModelData(modelId, { setModelName, setResolution, setFromDate, setToDate, setLoadedCoordinates, setIsLoadingModel, setLoadedConfig }, originalModelRef); }, [editMode, modelId]);
    useEffect(() => { if (editMode && loadedCoordinates?.length) setAllPolygons(loadedCoordinates); }, [editMode, loadedCoordinates]);
    useEffect(() => { checkAndShowAreaSelectTour(editMode, setShowAreaSelectTour); }, [editMode]);
    useEffect(() => { const h = () => setShowAreaSelectTour(true); globalThis.addEventListener('restart-area-select-tour', h); return () => globalThis.removeEventListener('restart-area-select-tour', h); }, []);
    useEffect(() => { if (editMode && !editModeInitializedRef.current && !isLoadingModel && originalModelRef.current) editModeInitializedRef.current = true; }, [editMode, isLoadingModel]);

    // ── Browser back intercept ──
    useEffect(() => { if (!editMode || !isModified || useAuthStore.getState().isSessionExpired) return; window.history.pushState(null, '', window.location.href); const h = () => { setShowUnsavedDialog(true); window.history.pushState(null, '', window.location.href); }; window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, [editMode, isModified]);
    useEffect(() => { if (!editMode || !isModified || useAuthStore.getState().isSessionExpired) return; const orig = window.history.pushState.bind(window.history); const patched: typeof window.history.pushState = (data, _u, url) => { if (isInternalNavRef.current) { isInternalNavRef.current = false; orig(data, _u, url); return; } let target: string | null = null; if (typeof url === 'string') try { target = new URL(url, window.location.origin).pathname; } catch { target = url; } if (target && target !== window.location.pathname) { setPendingNavigationUrl(target); setShowUnsavedDialog(true); return; } orig(data, _u, url); }; window.history.pushState = patched; return () => { window.history.pushState = orig; }; }, [editMode, isModified]);

    // ── Handlers ──
    const handleUpdateRange = useCallback((e: any) => { const f = ({ year, month, day }: any) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; setFromDate(f(e.start)); setToDate(f(e.end)); }, [setFromDate, setToDate]);
    const handleTourComplete = useCallback(() => { setShowAreaSelectTour(false); void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => { }); }, [setShowAreaSelectTour]);
    const handleTourSkip = useCallback(() => { setShowAreaSelectTour(false); void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => { }); }, [setShowAreaSelectTour]);
    const handleCancel = useCallback(() => { if (onCancel) { onCancel(); return; } if (isModified && editMode) { setShowUnsavedDialog(true); return; } isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); }, [onCancel, navigate, isModified, editMode, setShowUnsavedDialog]);
    const handleResetAdvancedParams = useCallback(() => setAdvancedParams(getDefaultAdvancedParameters()), [setAdvancedParams]);

    // Detect metadata changes
    useEffect(() => { if (!editMode || !editModeInitializedRef.current) return; const o = originalModelRef.current; if (!o) return; if (modelName !== o.title || fromDate !== o.from_date || toDate !== o.to_date || resolution !== o.resolution) setIsModified(true); }, [editMode, modelName, fromDate, toDate, resolution, setIsModified]);

    const handlePolygonDrawn = useCallback(async (coords: [number, number][], polygons: [number, number][][]) => {
        setAllPolygons(polygons);
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const user = useAuthStore.getState().user;
            const response = await pylovoService.generateGrid({
                polygon: coords, polygons, user_id: user?.id ? String(user.id) : undefined,
                model_id: modelId, draft_id: draftId, include_public_buildings: includePublicBuildings,
                include_private_buildings: includePrivateBuildings, excluded_building_ids: Array.from(excludedBuildingIds),
            });
            if (genId !== gridGenIdRef.current) return;
            const count = response.buildings?.features?.length || 0;
            if (buildingLimit > 0 && count > buildingLimit) { showError(t("gridNotifications.buildingLimitExceeded", { count, limit: buildingLimit })); setAllPolygons([]); incrementClearTrigger(); pylovoLayersData.processPylovoData({}); return; }
            if (count > 0) showSuccess(t("gridNotifications.gridGenerated", { count })); else showSuccess(t("gridNotifications.gridCompleteNoBuildings"));
            pylovoLayersData.processPylovoData(response as PylovoGridData);
            setIsModified(true);
        } catch { if (genId === gridGenIdRef.current) showError(t("gridNotifications.gridGenerationFailed")); }
        finally { if (genId === gridGenIdRef.current) setIsGeneratingGrid(false); }
    }, [pylovoLayersData, showSuccess, showError, includePublicBuildings, includePrivateBuildings, excludedBuildingIds, buildingLimit, t, modelId, draftId, setAllPolygons, setIsGeneratingGrid, setIsModified, incrementClearTrigger]);

    const handleClearAllPolygons = useCallback(() => {
        gridGenIdRef.current++;
        setAllPolygons([]); incrementClearTrigger();
        pylovoLayersData.processPylovoData({});
        mapInteractionsData.handleCloseTransformerDialog();
        mapInteractionsData.handleCloseBuildingDialog();
        clearExcludedBuildings();
        setIsModified(true);
    }, [pylovoLayersData, mapInteractionsData, setAllPolygons, incrementClearTrigger, clearExcludedBuildings, setIsModified]);

    const handlePolygonModified = useCallback(async (updatedPolygons: [number, number][][]) => {
        setAllPolygons(updatedPolygons);
        if (updatedPolygons.length === 0) return;
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const user = useAuthStore.getState().user;
            const response = await pylovoService.generateGrid({
                polygons: updatedPolygons, user_id: user?.id ? String(user.id) : undefined,
                model_id: modelId, draft_id: draftId, include_public_buildings: includePublicBuildings,
                include_private_buildings: includePrivateBuildings, excluded_building_ids: Array.from(excludedBuildingIds),
            });
            if (genId !== gridGenIdRef.current) return;
            showSuccess(t("gridNotifications.gridUpdated", { count: response.buildings?.features?.length || 0 }));
            pylovoLayersData.processPylovoData(response as PylovoGridData);
        } catch { if (genId === gridGenIdRef.current) showError(t("gridNotifications.gridRegenerationFailed")); }
        finally { if (genId === gridGenIdRef.current) setIsGeneratingGrid(false); }
        setIsModified(true);
    }, [pylovoLayersData, showSuccess, showError, includePublicBuildings, includePrivateBuildings, excludedBuildingIds, t, modelId, draftId, setAllPolygons, setIsGeneratingGrid, setIsModified]);

    // ── Save ──
    const getUpdatedPylovoData = useCallback(() => {
        const base = pylovoLayersData.pylovoGridData || {};
        if (!map) return base;
        const format = new GeoJSON();
        const updated = { ...base } as any;
        pylovoLayersData.pylovoLayersRef.current.forEach(layer => {
            const src = layer.getSource(); if (!src) return;
            const feats = src.getFeatures(); if (!feats.length) return;
            if (feats[0].get('feature_type') === 'building') updated.buildings = format.writeFeaturesObject(feats, { dataProjection: 'EPSG:4326', featureProjection: map.getView().getProjection() });
        });
        return updated as PylovoGridData;
    }, [pylovoLayersData, map]);

    const updateModelMutation = useUpdateModelMutation2();
    const createModelMutation = useCreateModelMutation();

    const handleQuickSave = useCallback(async () => {
        const data = getUpdatedPylovoData(); const user = useAuthStore.getState().user;
        const userId = user?.id ? String(user.id) : undefined;
        await saveAreaData({ fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, polygonCoordinates: allPolygons, workspaceId: currentWorkspace?.id, updateModelMutation, createModelMutation, setIsSaving, navigate, pylovoData: data, advancedParams, draftId, userId, originalModel: originalModelRef.current });
        setIsModified(false);
    }, [fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, allPolygons, currentWorkspace?.id, getUpdatedPylovoData, advancedParams, draftId, setIsSaving, setIsModified, updateModelMutation, createModelMutation, navigate]);

    const handleSave = useCallback(async () => { await handleQuickSave(); isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); }, [handleQuickSave, navigate]);

    const handleUnsavedDiscard = useCallback(() => { setShowUnsavedDialog(false); setIsModified(false); const url = pendingNavigationUrl; setPendingNavigationUrl(null); if (url) { isInternalNavRef.current = true; navigate(url); } else if (onCancel) onCancel(); else { isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); } }, [navigate, onCancel, pendingNavigationUrl, setShowUnsavedDialog, setIsModified]);

    // ── Build return values ──
    const state = { modelName, fromDate, toDate, resolution, isSaving, isLoadingModel, showAreaSelectTour, loadedCoordinates, loadedConfig, allPolygons, advancedParams, showAdvancedParams, isDrawing, allowMultiplePolygons, clearTrigger, cursorPos, isGeneratingGrid, includePublicBuildings, includePrivateBuildings, excludedBuildingIds, isModified, showUnsavedDialog };
    const actions = { setModelName, setResolution, handleUpdateRange, setShowAreaSelectTour, handleTourComplete, handleTourSkip, handleSave, handleCancel, setAllPolygons, setAdvancedParams, setShowAdvancedParams, handleResetAdvancedParams, handlePolygonDrawn, handlePolygonModified, handleClearAllPolygons, setAllowMultiplePolygons, setIsDrawing, setIncludePublicBuildings, setIncludePrivateBuildings, toggleBuildingExclusion, clearExcludedBuildings, handleQuickSave };

    return { state, actions, customLocations: customLocationsData, pylovoLayers: pylovoLayersData, techOperations: techOperationsData, mapInteractions: mapInteractionsData, notification: { data: notification, showSuccess, showError, hide }, setCursorPos, map, mapRef, handleQuickSave, unsavedDialog: { showUnsavedDialog, setShowUnsavedDialog, handleUnsavedDiscard }, setIsModified };
};

// ── Helper functions ──
async function loadExistingModelData(modelId: number, setters: any, originalRef: any) {
    setters.setIsLoadingModel(true);
    try {
        const r = await modelService.getModelById(modelId);
        if (r.success && r.data) {
            const m = r.data;
            if (m.title) setters.setModelName(m.title);
            if (m.resolution !== undefined) setters.setResolution(m.resolution);
            if (m.from_date) setters.setFromDate(new Date(m.from_date).toISOString().split('T')[0]);
            if (m.to_date) setters.setToDate(new Date(m.to_date).toISOString().split('T')[0]);
            if (m.coordinates?.type === 'MultiPolygon' && Array.isArray(m.coordinates.coordinates)) {
                const polygons = m.coordinates.coordinates.map((p: any) => p[0]).filter((p: any) => p?.length > 0);
                if (polygons.length > 0) setters.setLoadedCoordinates(polygons);
            }
            if (m.config) {
                const cfg: any = {};
                if (m.config.buildings) cfg.buildings = m.config.buildings;
                if (m.config.lines) cfg.lines = m.config.lines;
                if (m.config.mv_lines) cfg.mv_lines = m.config.mv_lines;
                if (m.config.transformers) cfg.transformers = m.config.transformers;
                if (m.config.grids) cfg.grids = m.config.grids;
                if (Object.keys(cfg).length > 0) setters.setLoadedConfig(cfg);
            }
            if (originalRef) originalRef.current = { title: m.title || '', from_date: m.from_date ? new Date(m.from_date).toISOString().split('T')[0] : '', to_date: m.to_date ? new Date(m.to_date).toISOString().split('T')[0] : '', resolution: m.resolution ?? 0, config: m.config || null, status: m.status || 'draft' };
        }
    } catch { /* ignore */ }
    finally { setters.setIsLoadingModel(false); }
}

async function checkAndShowAreaSelectTour(editMode: boolean, setShow: (v: boolean) => void) {
    if (editMode) return;
    try { const { data } = await axios.get('/settings'); if (data.success && data.data && !data.data.area_select_tour_completed) setTimeout(() => setShow(true), 1000); } catch { /* ignore */ }
}

async function saveAreaData(params: any) {
    const { fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, polygonCoordinates, workspaceId, updateModelMutation, createModelMutation, setIsSaving, pylovoData, advancedParams, draftId, userId, originalModel } = params;
    if (!fromDate || !toDate || !modelName?.trim() || !polygonCoordinates?.length) return;
    setIsSaving(true);
    try {
        await new Promise(r => setTimeout(r, 1200));
        const areaData: AreaData = { fromDate, toDate, resolution, modelName: modelName.trim(), timestamp: new Date().toISOString() };
        if (onAreaSelected) { onAreaSelected(areaData); return; }
        const coords = { type: "MultiPolygon", coordinates: polygonCoordinates.map((p: number[][]) => [p]) };
        const config: any = pylovoData ? { ...pylovoData } : undefined;
        if (config && advancedParams?.pypsa_enabled !== false) {
            config.pypsa = { trafo_mv_lv_used: true, trafo_mv_lv_type: advancedParams?.trafo_mv_lv_type || "0.4 MVA 20/0.4 kV", line_type_mv: advancedParams?.line_type_mv || "NA2XS2Y 1x185 RM/25 12/20 kV", line_type_lv: advancedParams?.line_type_lv || "NAYY 4x150 SE" };
        } else if (config) { config.pypsa = false; }
        const modelData = { title: areaData.modelName, from_date: areaData.fromDate, to_date: areaData.toDate, resolution: areaData.resolution, workspace_id: workspaceId, coordinates: coords, config };
        if (editMode && modelId) {
            let hasChanges = !originalModel;
            if (originalModel) hasChanges = originalModel.title !== areaData.modelName || originalModel.from_date !== areaData.fromDate || originalModel.to_date !== areaData.toDate || originalModel.resolution !== areaData.resolution;
            await updateModelMutation.mutateAsync({ id: modelId, data: hasChanges ? { ...modelData, status: 'modified' } : modelData });
        } else {
            const newModel = await createModelMutation.mutateAsync(modelData);
            if (draftId && newModel?.data?.id) try { await pylovoService.finalizeTransformers(draftId, newModel.data.id, userId); } catch { /* non-critical */ }
        }
        params.navigate(DASHBOARD_ROUTE);
    } catch { /* ignore */ }
    finally { setIsSaving(false); }
}
