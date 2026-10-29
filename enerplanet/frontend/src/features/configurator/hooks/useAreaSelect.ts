import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { modelService } from '@/features/model-dashboard/services/modelService';
import { useCreateModelMutation, useUpdateModelMutation2 } from '@/features/model-dashboard/hooks/useModelsQuery';
import GeoJSON from 'ol/format/GeoJSON';
import axios from '@/lib/axios';
import { applyWeatherToConfig, weatherFromConfig } from './useAreaSelect/helpers/weatherSettings';
import type { AreaData, UseAreaSelectProps, PylovoGridData } from '@/features/configurator/types/area-select';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation } from '@spatialhub/i18n';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { useMapProvider } from '@/providers/map-context';
import { getDefaultAdvancedParameters } from '@/features/configurator/constants/area-select-params';
import { pylovoService, siteScope } from '@/features/configurator/services/pylovoService';
import { useModelStore } from '@/features/configurator/store/modelStore';
import { useCustomLocationLayers } from '@/features/configurator/hooks/useCustomLocationLayers';
import { usePylovoLayers } from '@/features/configurator/hooks/usePylovoLayers';
import { useTechDragDrop } from '@/features/configurator/hooks/useTechDragDrop';
import { useMapClickHandlers } from '@/features/configurator/hooks/useMapClickHandlers';
import { generateUUID } from '@/utils/uuid';
import { collectBuildingsFromLayers } from '@/features/configurator/hooks/useAreaSelect/helpers/layerConnections';
import { carryOverBuildingEdits } from '@/features/configurator/hooks/useAreaSelect/helpers/buildingEdits';
import { hasUnsavedChanges, settingsChanged } from '@/features/configurator/hooks/useAreaSelect/helpers/modelSettings';
import { areaBuildingLimit } from '@/features/configurator/utils/areaLimit';

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
    const { showSuccess, showError, showWarning } = useNotification();
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

    // Reset global store on mount — prevents stale data from a previous model session
    // The configurator always opens on the standard 2D map, whichever base map was last chosen.
    useEffect(() => { useModelStore.getState().reset(); useMapStore.getState().setSelectedBaseLayerId('osm_standard'); }, []);

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
    const clearTrigger = useModelStore((s) => s.clearTrigger); const incrementClearTrigger = useModelStore((s) => s.incrementClearTrigger);
    const pointerOnMap = useModelStore((s) => s.pointerOnMap); const setPointerOnMap = useModelStore((s) => s.setPointerOnMap);
    const showAdvancedParams = useModelStore((s) => s.showAdvancedParams); const setShowAdvancedParams = useModelStore((s) => s.setShowAdvancedParams);
    const advancedParams = useModelStore((s) => s.advancedParams); const setAdvancedParams = useModelStore((s) => s.setAdvancedParams);
    const isModified = useModelStore((s) => s.isModified); const setIsModified = useModelStore((s) => s.setIsModified);
    const showUnsavedDialog = useModelStore((s) => s.showUnsavedDialog); const setShowUnsavedDialog = useModelStore((s) => s.setShowUnsavedDialog);
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
    useEffect(() => { if (editMode && loadedCoordinates?.length) setAllPolygons(loadedCoordinates); }, [editMode, loadedCoordinates, setAllPolygons]);
    useEffect(() => { checkAndShowAreaSelectTour(editMode, setShowAreaSelectTour); }, [editMode]);
    useEffect(() => { const h = () => setShowAreaSelectTour(true); globalThis.addEventListener('restart-area-select-tour', h); return () => globalThis.removeEventListener('restart-area-select-tour', h); }, []);
    useEffect(() => { if (editMode && !editModeInitializedRef.current && !isLoadingModel && originalModelRef.current) editModeInitializedRef.current = true; }, [editMode, isLoadingModel]);

    // ── Browser back intercept ──
    const unsaved = hasUnsavedChanges(editMode, isModified, allPolygons.length);
    useEffect(() => { if (!unsaved || useAuthStore.getState().isSessionExpired) return; window.history.pushState(null, '', window.location.href); const h = () => { setShowUnsavedDialog(true); window.history.pushState(null, '', window.location.href); }; window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, [unsaved]);
    useEffect(() => { if (!unsaved || useAuthStore.getState().isSessionExpired) return; const orig = window.history.pushState.bind(window.history); const patched: typeof window.history.pushState = (data, _u, url) => { if (isInternalNavRef.current) { isInternalNavRef.current = false; orig(data, _u, url); return; } let target: string | null = null; if (typeof url === 'string') try { target = new URL(url, window.location.origin).pathname; } catch { target = url; } if (target && target !== window.location.pathname) { setPendingNavigationUrl(target); setShowUnsavedDialog(true); return; } orig(data, _u, url); }; window.history.pushState = patched; return () => { window.history.pushState = orig; }; }, [unsaved]);

    // ── Handlers ──
    // The weather and the stored series cover one calendar year, so a period stays in one year:
    // when one date's year changes the other follows it, keeping its day.
    const handleUpdateRange = useCallback((e: any) => {
        const f = ({ year, month, day }: any) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        let { start, end } = e;
        const startYear = fromDate ? Number(fromDate.slice(0, 4)) : start.year;
        const endYear = toDate ? Number(toDate.slice(0, 4)) : end.year;
        // A year being typed reports each digit; it counts once it has four.
        if (start.year !== end.year && start.year >= 1000 && end.year >= 1000) {
            if (start.year !== startYear && end.year === endYear) end = end.set({ year: start.year });
            else if (end.year !== endYear && start.year === startYear) start = start.set({ year: end.year });
            else end = { year: start.year, month: 12, day: 31 };
            showWarning(t("simulation.periodWithinYear", { year: start.year }));
        }
        setFromDate(f(start)); setToDate(f(end));
    }, [fromDate, toDate, setFromDate, setToDate, showWarning, t]);
    const handleTourComplete = useCallback(() => { setShowAreaSelectTour(false); void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => { }); }, [setShowAreaSelectTour]);
    const handleTourSkip = useCallback(() => { setShowAreaSelectTour(false); void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => { }); }, [setShowAreaSelectTour]);
    const handleCancel = useCallback(() => { if (onCancel) { onCancel(); return; } if (unsaved) { setShowUnsavedDialog(true); return; } isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); }, [onCancel, navigate, unsaved, setShowUnsavedDialog]);
    const handleResetAdvancedParams = useCallback(() => setAdvancedParams(getDefaultAdvancedParameters()), [setAdvancedParams]);

    // Detect metadata changes
    const cookingCarrier = useModelStore((s) => s.cookingCarrier); const runMode = useModelStore((s) => s.runMode); const weather = useModelStore((s) => s.weather);
    const siteMode = useModelStore((s) => s.siteMode);
    const setGridStale = useModelStore((s) => s.setGridStale);
    // Whether the area changed since the shown grid was generated; a site whose
    // area is unchanged keeps its stations and is regenerated in place.
    const areaChangedRef = useRef(false);
    // An area over the building limit: it stays on the map and is not fetched.
    const [areaOverLimit, setAreaOverLimit] = useState<{ count: number; capped: boolean; limit: number } | null>(null);
    const countIdRef = useRef(0);
    // Counts the area's buildings before anything is fetched and reports
    // whether it fits; a count that fails lets the fetch go ahead, so an
    // unavailable count never blocks modelling.
    const areaFits = useCallback(async (polygons: [number, number][][], mode = siteMode): Promise<boolean> => {
        const countId = ++countIdRef.current;
        const areaLimit = areaBuildingLimit(buildingLimit, mode);
        if (areaLimit <= 0) { setAreaOverLimit(null); return true; }
        let count: number, capped: boolean;
        try { ({ count, capped } = await pylovoService.countBuildings(polygons)); }
        catch (err) { console.warn('Building count failed; the area is fetched without it', err); setAreaOverLimit(null); return true; }
        if (countId !== countIdRef.current) return false;
        setAreaOverLimit(count > areaLimit ? { count, capped, limit: areaLimit } : null);
        return count <= areaLimit;
    }, [buildingLimit, siteMode]);
    useEffect(() => { if (!editMode || !editModeInitializedRef.current) return; const o = originalModelRef.current; if (!o) return; if (settingsChanged(o, { title: modelName, fromDate, toDate, resolution, cookingCarrier, runMode, weather })) setIsModified(true); }, [editMode, modelName, fromDate, toDate, resolution, cookingCarrier, runMode, weather, setIsModified]);

    const handlePolygonDrawn = useCallback(async (coords: [number, number][], polygons: [number, number][][]) => {
        setAllPolygons(polygons);
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const fits = await areaFits(polygons);
            if (genId !== gridGenIdRef.current) return;
            if (!fits) { setGridStale(true); setIsModified(true); return; }
            const user = useAuthStore.getState().user;
            const response = siteMode ? await pylovoService.generateSiteGrid(modelName.trim() || 'Site', polygons) : await pylovoService.generateGrid({
                polygon: coords, polygons, user_id: user?.id ? String(user.id) : undefined,
                model_id: modelId, draft_id: draftId,
                include_private_buildings: includePrivateBuildings, excluded_building_ids: Array.from(excludedBuildingIds),
            });
            if (genId !== gridGenIdRef.current) return;
            const count = response.buildings?.features?.length || 0;
            if (buildingLimit > 0 && count > buildingLimit) { showError(t("gridNotifications.buildingLimitExceeded", { count, limit: buildingLimit })); setAllPolygons([]); incrementClearTrigger(); pylovoLayersData.processPylovoData({}); return; }
            if (count > 0) showSuccess(t("gridNotifications.gridGenerated", { count })); else showSuccess(t("gridNotifications.gridCompleteNoBuildings"));
            pylovoLayersData.processPylovoData(carryOverBuildingEdits(collectBuildingsFromLayers(pylovoLayersData.pylovoLayersRef.current), response as PylovoGridData));
            areaChangedRef.current = false; setGridStale(false);
            setIsModified(true);
        } catch (err) { if (genId === gridGenIdRef.current) showError(gridErrorMessage(err, siteMode, t("gridNotifications.gridGenerationFailed"))); }
        finally { if (genId === gridGenIdRef.current) setIsGeneratingGrid(false); }
    }, [pylovoLayersData, showSuccess, showError, includePrivateBuildings, excludedBuildingIds, buildingLimit, t, modelId, draftId, setAllPolygons, setIsGeneratingGrid, setIsModified, incrementClearTrigger, siteMode, modelName, setGridStale, areaFits]);

    const handleClearAllPolygons = useCallback(() => {
        gridGenIdRef.current++; countIdRef.current++;
        setAreaOverLimit(null);
        setAllPolygons([]); incrementClearTrigger();
        pylovoLayersData.processPylovoData({});
        mapInteractionsData.handleCloseTransformerDialog();
        mapInteractionsData.handleCloseBuildingDialog();
        clearExcludedBuildings();
        areaChangedRef.current = false; setGridStale(false);
        setIsModified(true);
    }, [pylovoLayersData, mapInteractionsData, setAllPolygons, incrementClearTrigger, clearExcludedBuildings, setIsModified, setGridStale]);

    const regenerateArea = useCallback(async (updatedPolygons: [number, number][][], mode = siteMode) => {
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const fits = await areaFits(updatedPolygons, mode);
            if (genId !== gridGenIdRef.current) return;
            if (!fits) { setGridStale(true); return; }
            const user = useAuthStore.getState().user;
            const response = mode ? await pylovoService.generateSiteGrid(modelName.trim() || 'Site', updatedPolygons) : await pylovoService.generateGrid({
                polygons: updatedPolygons, user_id: user?.id ? String(user.id) : undefined,
                model_id: modelId, draft_id: draftId,
                include_private_buildings: includePrivateBuildings, excluded_building_ids: Array.from(excludedBuildingIds),
            });
            if (genId !== gridGenIdRef.current) return;
            showSuccess(t("gridNotifications.gridUpdated", { count: response.buildings?.features?.length || 0 }));
            pylovoLayersData.processPylovoData(carryOverBuildingEdits(collectBuildingsFromLayers(pylovoLayersData.pylovoLayersRef.current), response as PylovoGridData));
            areaChangedRef.current = false; setGridStale(false);
        } catch (err) { if (genId === gridGenIdRef.current) showError(gridErrorMessage(err, mode, t("gridNotifications.gridRegenerationFailed"))); }
        finally { if (genId === gridGenIdRef.current) setIsGeneratingGrid(false); }
        setIsModified(true);
    }, [pylovoLayersData, showSuccess, showError, includePrivateBuildings, excludedBuildingIds, t, modelId, draftId, setIsGeneratingGrid, setIsModified, siteMode, modelName, setGridStale, areaFits]);

    // Default mode reads pylovo's precomputed postcode grids, so an edited area
    // is fetched at once. A site is generated from its edits, so in site mode an
    // edit only marks the grid stale; Regenerate grid (handleRegenerateGrid) runs it.
    const handlePolygonModified = useCallback(async (updatedPolygons: [number, number][][]) => {
        setAllPolygons(updatedPolygons);
        if (updatedPolygons.length === 0) return;
        if (!siteMode) { await regenerateArea(updatedPolygons); return; }
        areaChangedRef.current = true;
        setGridStale(true);
        setIsModified(true);
        await areaFits(updatedPolygons);
    }, [setAllPolygons, setGridStale, setIsModified, siteMode, regenerateArea, areaFits]);

    // Regenerates the shown site after an edit to its stations, keeping the same site and area.
    const handleSiteRegenerate = useCallback(async (siteId: number) => {
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const response = await pylovoService.regenerateSiteGrid(siteId);
            if (genId !== gridGenIdRef.current) return;
            showSuccess(t("gridNotifications.gridUpdated", { count: response.buildings?.features?.length || 0 }));
            pylovoLayersData.processPylovoData(carryOverBuildingEdits(collectBuildingsFromLayers(pylovoLayersData.pylovoLayersRef.current), response as PylovoGridData));
            setGridStale(false);
            setIsModified(true);
        } catch (err) { if (genId === gridGenIdRef.current) showError(gridErrorMessage(err, true, t("gridNotifications.gridRegenerationFailed"))); }
        finally { if (genId === gridGenIdRef.current) setIsGeneratingGrid(false); }
    }, [pylovoLayersData, showSuccess, showError, t, setIsGeneratingGrid, setIsModified, setGridStale]);

    // A site whose area is unchanged is regenerated in place, so pylovo re-clusters
    // its buildings around the edited stations; a changed area gets a new grid.
    const handleRegenerateGrid = useCallback(async () => {
        const site = siteScope(pylovoLayersData.pylovoGridData);
        if (site && !areaChangedRef.current) await handleSiteRegenerate(site.site_id);
        else if (allPolygons.length > 0) await regenerateArea(allPolygons);
    }, [pylovoLayersData.pylovoGridData, handleSiteRegenerate, regenerateArea, allPolygons]);

    // A drawn area keeps its polygons across a mode switch and gets a grid in the
    // new mode. The grid is stale until that succeeds, so a failure leaves Regenerate grid.
    const handleSwitchGridMode = useCallback(async (on: boolean) => {
        useModelStore.getState().setSiteMode(on);
        if (allPolygons.length === 0) return;
        areaChangedRef.current = true;
        setGridStale(true);
        await regenerateArea(allPolygons, on);
    }, [allPolygons, regenerateArea, setGridStale]);

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

    /** Saves the model and returns its id, or undefined when it was not saved. */
    const saveModel = useCallback(async (): Promise<number | undefined> => {
        const data = getUpdatedPylovoData(); const user = useAuthStore.getState().user;
        const userId = user?.id ? String(user.id) : undefined;
        return saveAreaData({ fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, polygonCoordinates: allPolygons, workspaceId: currentWorkspace?.id, updateModelMutation, createModelMutation, setIsSaving, pylovoData: data, advancedParams, draftId, userId, originalModel: originalModelRef.current });
    }, [fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, allPolygons, currentWorkspace?.id, getUpdatedPylovoData, advancedParams, draftId, setIsSaving, updateModelMutation, createModelMutation]);

    const handleQuickSave = useCallback(async () => {
        const id = await saveModel();
        setIsModified(false);
        // A new model reopens in edit mode, so the next save updates it rather than creating another.
        if (id && !editMode) { isInternalNavRef.current = true; navigate(`/app/model-dashboard/edit/${id}`, { replace: true }); }
    }, [saveModel, setIsModified, editMode, navigate]);

    /** Saves a new or changed model, then starts the analysis of its buildings; returns whether it started. */
    const handleAnalyse = useCallback(async (): Promise<boolean> => {
        let id = editMode ? modelId : undefined;
        if (!id || isModified) {
            id = await saveModel();
            if (!id) { showError(t("simulation.analysis.saveFailed")); return false; }
            setIsModified(false);
        }
        try {
            await modelService.analyseModel(id);
        } catch (err) {
            showError((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? t("simulation.analysis.startFailed"));
            return false;
        }
        // A new model opens in edit mode so its progress and results show.
        if (!editMode) { isInternalNavRef.current = true; navigate(`/app/model-dashboard/edit/${id}`, { replace: true }); }
        return true;
    }, [editMode, modelId, isModified, saveModel, setIsModified, showError, t, navigate]);

    const handleSave = useCallback(async () => { await handleQuickSave(); isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); }, [handleQuickSave, navigate]);

    const handleUnsavedDiscard = useCallback(() => { setShowUnsavedDialog(false); setIsModified(false); const url = pendingNavigationUrl; setPendingNavigationUrl(null); if (url) { isInternalNavRef.current = true; navigate(url); } else if (onCancel) onCancel(); else { isInternalNavRef.current = true; navigate(DASHBOARD_ROUTE); } }, [navigate, onCancel, pendingNavigationUrl, setShowUnsavedDialog, setIsModified]);

    // ── Build return values ──
    const state = { areaOverLimit, modelName, fromDate, toDate, resolution, isSaving, isLoadingModel, showAreaSelectTour, loadedCoordinates, loadedConfig, allPolygons, advancedParams, showAdvancedParams, isDrawing, clearTrigger, pointerOnMap, isGeneratingGrid, includePrivateBuildings, excludedBuildingIds, isModified, showUnsavedDialog };
    const actions = { setModelName, setResolution, handleUpdateRange, setShowAreaSelectTour, handleTourComplete, handleTourSkip, handleSave, handleCancel, setAllPolygons, setAdvancedParams, setShowAdvancedParams, handleResetAdvancedParams, handlePolygonDrawn, handlePolygonModified, handleSiteRegenerate, handleRegenerateGrid, handleSwitchGridMode, handleClearAllPolygons, setIsDrawing, setIncludePrivateBuildings, toggleBuildingExclusion, clearExcludedBuildings, handleQuickSave, handleAnalyse };

    return { state, actions, customLocations: customLocationsData, pylovoLayers: pylovoLayersData, techOperations: techOperationsData, mapInteractions: mapInteractionsData, notification: { showSuccess, showError }, setPointerOnMap, map, mapRef, handleQuickSave, unsavedDialog: { showUnsavedDialog, setShowUnsavedDialog, handleUnsavedDiscard }, setIsModified };
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
            if (m.config?.cookingCarrier === 'gas' || m.config?.cookingCarrier === 'electric') useModelStore.getState().setCookingCarrier(m.config.cookingCarrier);
            useModelStore.getState().setRunMode(m.config?.mode === 'operate' ? 'operate' : 'plan');
            useModelStore.getState().setWeather(weatherFromConfig(m.config));
            useModelStore.getState().setSiteMode((m.config?.site as { mode?: string } | undefined)?.mode === 'site');
            if (m.config) {
                const cfg: any = {};
                if (m.config.buildings) cfg.buildings = m.config.buildings;
                if (m.config.lines) cfg.lines = m.config.lines;
                if (m.config.mv_lines) cfg.mv_lines = m.config.mv_lines;
                if (m.config.transformers) cfg.transformers = m.config.transformers;
                if (m.config.grids) cfg.grids = m.config.grids;
                if (m.config.meta) cfg.meta = m.config.meta;
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

/** A site refusal (no 3D-linked buildings, over the limit) carries a message the user can act on; other failures keep the generic one. */
function gridErrorMessage(err: unknown, siteMode: boolean, fallback: string): string {
    if (!siteMode) return fallback;
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    return e.response?.data?.error || e.message || fallback;
}

/** Saves the area as a model and returns its id, or undefined when it was not saved. */
async function saveAreaData(params: any): Promise<number | undefined> {
    const { fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, polygonCoordinates, workspaceId, updateModelMutation, createModelMutation, setIsSaving, pylovoData, advancedParams, draftId, userId, originalModel } = params;
    if (!fromDate || !toDate || !modelName?.trim() || !polygonCoordinates?.length) return undefined;
    setIsSaving(true);
    try {
        await new Promise(r => setTimeout(r, 1200));
        const areaData: AreaData = { fromDate, toDate, resolution, modelName: modelName.trim(), timestamp: new Date().toISOString() };
        if (onAreaSelected) { onAreaSelected(areaData); return undefined; }
        const coords = { type: "MultiPolygon", coordinates: polygonCoordinates.map((p: number[][]) => [p]) };
        const config: any = pylovoData ? { ...pylovoData } : undefined;
        if (config && advancedParams?.pypsa_enabled !== false) {
            config.pypsa = { trafo_mv_lv_used: true, trafo_mv_lv_type: advancedParams?.trafo_mv_lv_type || "0.4 MVA 20/0.4 kV", line_type_mv: advancedParams?.line_type_mv || "NA2XS2Y 1x185 RM/25 12/20 kV", line_type_lv: advancedParams?.line_type_lv || "NAYY 4x150 SE" };
        } else if (config) { config.pypsa = false; }
        if (config) config.cookingCarrier = useModelStore.getState().cookingCarrier;
        if (config) config.mode = useModelStore.getState().runMode;
        if (config) applyWeatherToConfig(config, useModelStore.getState().weather, Number(fromDate.slice(0, 4)));
        const site = siteScope(pylovoData);
        if (config && site) config.site = { mode: 'site', ...site };
        const modelData = { title: areaData.modelName, from_date: areaData.fromDate, to_date: areaData.toDate, resolution: 60 /* static: only 60-minute steps are supported */, workspace_id: workspaceId, coordinates: coords, config };
        if (editMode && modelId) {
            let hasChanges = !originalModel;
            if (originalModel) { const { cookingCarrier, runMode, weather } = useModelStore.getState(); hasChanges = settingsChanged(originalModel, { title: areaData.modelName, fromDate: areaData.fromDate, toDate: areaData.toDate, resolution: areaData.resolution, cookingCarrier, runMode, weather }); }
            await updateModelMutation.mutateAsync({ id: modelId, data: hasChanges ? { ...modelData, status: 'modified' } : modelData });
            return modelId;
        } else {
            const newModel = await createModelMutation.mutateAsync(modelData);
            if (draftId && newModel?.data?.id) try { await pylovoService.finalizeTransformers(draftId, newModel.data.id, userId); } catch { /* non-critical */ }
            // Not fatal: an analysis finds the same results stored by key.
            if (draftId && newModel?.data?.id) await modelService.claimDraftSeries(newModel.data.id, draftId).catch((err) => console.warn(`claiming draft ${draftId} series for model ${newModel.data.id} failed`, err));
            return newModel?.data?.id;
        }
    } catch (err) { console.error('saving the model failed', err); return undefined; }
    finally { setIsSaving(false); }
}
