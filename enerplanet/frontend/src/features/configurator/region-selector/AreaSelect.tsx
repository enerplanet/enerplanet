import { useEffect, Fragment, type FC } from "react";
import { Loader2 } from "lucide-react";
import { AreaSelectTour } from "@/features/guided-tour/AreaSelectTour";
import { MapContainer } from "@/components/shared/MapContainer";
import { useAreaSelect, type AreaData } from "@/features/configurator/hooks/useAreaSelect";
import { PolygonDrawer } from "@/features/polygon-drawer";
import { PolygonDrawingGuide } from "@/components/map-controls/PolygonDrawingGuide";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";
import { useLocation, useParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
import { type Workspace } from "@/components/workspace/services/workspaceService";
import Notification from "@/components/ui/Notification";
import { MapOverlays } from "./components/MapOverlays";
import { MapHeader } from "./components/MapHeader";
import { SidebarPanel } from "./components/SidebarPanel";
import { TransformerDialog } from "./components/TransformerDialog";
import { BuildingDialog } from "./components/BuildingDialog";
import { TechParameterDialog } from "./components/TechParameterDialog";
import { PowerFlowLegend } from "./components/PowerFlowLegend";
import { MapLegend } from "@/components/map-controls/MapLegend";
import { GridActionBar } from "@/components/map-controls/GridActionBar";
import { parseDate } from "@internationalized/date";
import { usePolygonLimitsStore, type AccessLevel } from "@/features/polygon-drawer/store/polygon-limits-store";
import { useMemo, useState, useCallback, useRef } from "react";
import { pylovoService } from "@/features/configurator/services/pylovoService";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import { useMapProvider } from "@/providers/map-context";
import { highlightSelectedRegionBoundary } from "@/features/configurator/utils/gridLayerUtils";
import { useReassignmentLine } from "@/features/configurator/hooks/useReassignmentLine";
import { generateUUID } from "@/utils/uuid";
import { getFeatureFClasses, getPrimaryFClass, isResidentialFClass, normalizeFClass } from "@/features/configurator/utils/fClassUtils";
import {
    extractBuildingEnrichmentFromProps,
    extractPeakLoadFromProps,
    extractSelectedFClassFromProps,
    extractYearlyDemandFromProps as extractYearlyDemandFromFeatureProps,
    normalizeFClassToken,
} from "@/features/configurator/utils/buildingFeatureExtraction";
import { fromLonLat, toLonLat } from "ol/proj";
import { transformExtent } from "ol/proj";
import { getCenter } from "ol/extent";
import { Style, Fill, Stroke } from "ol/style";
import { MapLibre3DOverlay } from "@/components/map-controls/maplibre";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useDefaultRegionStore } from "@/features/configurator/region-selector/store/default-region";
import energyService from "@/features/configurator/services/energyService";

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

const parseFlexibleNumberString = (input: string): number | undefined => {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const compact = trimmed.replace(/[\s\u00A0\u202F]/g, "");

    // 1,234.56
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    // 1.234,56
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/\./g, "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    const normalized = compact.includes(",") && !compact.includes(".")
        ? compact.replace(",", ".")
        : compact;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        return parseFlexibleNumberString(value);
    }
    return undefined;
};

const parseTechs = (value: unknown): Record<string, unknown> => {
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

const extractYearlyDemandFromProps = (props: Record<string, unknown>): number =>
    extractYearlyDemandFromFeatureProps(props, { demandEnergyFallback: "custom_only" });

interface FClassDetail {
    fClass: string;
    yearlyDemandKwh: number;
    peakLoadKw: number;
}

const parseStoredFClassDetails = (
    storedDetails: unknown,
    fallbackClasses: string[],
): FClassDetail[] | null => {
    if (!storedDetails) return null;

    let parsed: unknown = storedDetails;
    if (typeof storedDetails === "string") {
        try {
            parsed = JSON.parse(storedDetails);
        } catch {
            return null;
        }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const classOrder = fallbackClasses
        .map((value) => normalizeFClassToken(value))
        .filter(Boolean);

    const byClass = new Map<string, FClassDetail>();
    parsed.forEach((raw, index) => {
        if (!raw || typeof raw !== "object") return;
        const record = raw as Record<string, unknown>;
        const fallbackClass = classOrder[index] ?? classOrder[0] ?? "unknown";
        const fClass =
            normalizeFClassToken(record.fClass ?? record.f_class ?? record.class) || fallbackClass;

        const yearlyDemandKwh =
            toFiniteNumber(
                record.yearlyDemandKwh ??
                record.yearly_demand_kwh ??
                record.demand_energy ??
                record.yearly_consumption_kwh
            ) ?? 0;
        const peakLoadKw =
            toFiniteNumber(
                record.peakLoadKw ??
                record.peak_load_kw ??
                record.peak_load_in_kw
            ) ?? 0;

        byClass.set(fClass, { fClass, yearlyDemandKwh, peakLoadKw });
    });

    if (byClass.size === 0) return null;
    return Array.from(byClass.values());
};

const buildInitialFClassDetails = (
    props: Record<string, unknown>,
    effectiveFClasses: string[],
    selectedFClass: string,
    totalDemand: number,
    totalPeak: number,
): { details: FClassDetail[]; synthetic: boolean } => {
    const stored = parseStoredFClassDetails(
        props.f_class_demands ?? props.fclass_details,
        effectiveFClasses
    );
    if (stored && stored.length > 0) {
        return { details: stored, synthetic: false };
    }

    const anchorClass = selectedFClass || effectiveFClasses[0] || "unknown";
    return {
        details: [{
            fClass: anchorClass,
            yearlyDemandKwh: Math.round(totalDemand * 100) / 100,
            peakLoadKw: Math.round(totalPeak * 100) / 100,
        }],
        synthetic: true,
    };
};

export const AreaSelect: FC<AreaSelectProps> = ({
    onAreaSelected,
    onCancel,
    editMode = false,
    existingModelId: existingModelIdProp
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
    const normalizedWorkspaceId = typeof passedWorkspaceId === "number" ? passedWorkspaceId : undefined;

    const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);
    const preferredWorkspaceId = useWorkspaceStore(state => state.preferredWorkspaceId);
    const isLoadingPreference = useWorkspaceStore(state => state.isLoading);
    const setCurrentWorkspace = useWorkspaceStore(state => state.setCurrentWorkspace);
    const initializeWorkspace = useWorkspaceStore(state => state.initializeWorkspace);

    const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
    const [wsReloadKey, setWsReloadKey] = useState(0);
    const [simulateEV, setSimulateEV] = useState(false);
    const [currentPointCount, setCurrentPointCount] = useState(0);
    const [regionName, setRegionName] = useState<string | undefined>(undefined);

    // Add Transformer Mode state
    const [isAddTransformerMode, setIsAddTransformerMode] = useState(false);
    const [newTransformerCoords, setNewTransformerCoords] = useState<[number, number] | null>(null);
    const [addTransformerDialogOpen, setAddTransformerDialogOpen] = useState(false);
    const [transformerCursorPos, setTransformerCursorPos] = useState<{ x: number; y: number } | null>(null);

    // Move Transformer Mode state
    const [isMoveTransformerMode, setIsMoveTransformerMode] = useState(false);
    const [transformerToMove, setTransformerToMove] = useState<number | null>(null);

    // Multi-Building Assignment Mode state
    const [isBuildingAssignMode, setIsBuildingAssignMode] = useState(false);
    const [selectedBuildingsForAssign, setSelectedBuildingsForAssign] = useState<string[]>([]);
    const [assignStep, setAssignStep] = useState<'select-buildings' | 'select-transformer'>('select-buildings');
    const selectedBuildingFeaturesRef = useRef<Map<string, any>>(new Map());
    const techAddedFromBuildingDialogRef = useRef(false);

    // Multi-edit mode for bulk technology assignment
    const [isMultiEdit, setIsMultiEdit] = useState(false);
    const [multiEditSelectedIds, setMultiEditSelectedIds] = useState<Set<string>>(new Set());
    const multiEditFeaturesRef = useRef<Map<string, any>>(new Map());

    // Draft ID for scoping user-placed transformers to this model session
    const [draftId, setDraftId] = useState<string | undefined>(() => {
        return editMode === false ? generateUUID() : undefined;
    });

    // Helper to clear building assignment mode and styles
    const clearBuildingAssignMode = useCallback(() => {
        // Clear highlight styles from all selected buildings
        selectedBuildingFeaturesRef.current.forEach((feature) => {
            feature.setStyle(undefined);
        });
        selectedBuildingFeaturesRef.current.clear();
        setIsBuildingAssignMode(false);
        setSelectedBuildingsForAssign([]);
        setAssignStep('select-buildings');
    }, []);

    // Store ref for cleanup
    const clearDrawingLayersRef = useRef(clearDrawingLayers);
    clearDrawingLayersRef.current = clearDrawingLayers;

    // Polygon limits - fetch on mount
    const fetchLimits = usePolygonLimitsStore(state => state.fetchLimits);
    const limits = usePolygonLimitsStore(state => state.limits);
    const user = useAuthStore(state => state.user);

    const buildingLimit = useMemo(() => {
        const accessLevel = (user?.access_level ?? 'very_low') as AccessLevel;
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

    const handleWorkspaceChange = useCallback((workspace: Workspace | null) => {
        setCurrentWorkspace(workspace);
    }, [setCurrentWorkspace]);

    const {
        state,
        actions,
        pylovoLayers,
        techOperations,
        mapInteractions,
        notification,
        setCursorPos,
        map,
        mapRef
    } = useAreaSelect({
        onAreaSelected,
        onCancel,
        editMode,
        existingModelId,
        buildingLimit,
        suppressDialogOnClick: isBuildingAssignMode || isAddTransformerMode || isMoveTransformerMode,
        draftId,
    });

    // Fly to default region immediately when map is ready (before saved map location kicks in)
    const hasAppliedDefaultRegion = useRef(false);
    const defaultRegion = useDefaultRegionStore(s => s.defaultRegion);
    useEffect(() => {
        if (!map || hasAppliedDefaultRegion.current || editMode) return;
        if (!defaultRegion?.bbox) return;
        hasAppliedDefaultRegion.current = true;
        const view = map.getView();
        // Cancel any in-flight animation (e.g. mapLocation restore)
        view.cancelAnimations();
        const { west, south, east, north } = defaultRegion.bbox;
        const extent = transformExtent([west, south, east, north], 'EPSG:4326', 'EPSG:3857');
        view.fit(extent, {
            padding: [60, 60, 60, 60],
            duration: 0,
            maxZoom: 14,
        });
    }, [map, defaultRegion, editMode]);

    // Unsaved changes guard — skip when navigating due to session expiry
    const isDirty = state.allPolygons.length > 0;
    const isSessionExpired = useAuthStore(state => state.isSessionExpired);

    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            if (useAuthStore.getState().isSessionExpired) return;
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty, isSessionExpired]);

    const toggleBuildingSelection = useCallback((rawOsmId: unknown, feature?: any) => {
        if (rawOsmId === undefined || rawOsmId === null) return;
        const osmId = String(rawOsmId).trim();
        if (!osmId) return;

        setSelectedBuildingsForAssign(prev => {
            if (prev.includes(osmId)) {
                if (feature) {
                    feature.setStyle(undefined);
                }
                selectedBuildingFeaturesRef.current.delete(osmId);
                return prev.filter(id => id !== osmId);
            }

            if (feature) {
                feature.setStyle(new Style({
                    fill: new Fill({ color: 'rgba(59, 130, 246, 0.5)' }),
                    stroke: new Stroke({ color: '#2563eb', width: 3 })
                }));
                selectedBuildingFeaturesRef.current.set(osmId, feature);
            }
            return [...prev, osmId];
        });
    }, []);

    const assignSelectedBuildingsToTransformer = useCallback(async (rawGridId: unknown) => {
        if (selectedBuildingsForAssign.length === 0) {
            notification.showError(t("simulation.building.selectBuildings"));
            return;
        }

        const parsedGridId = typeof rawGridId === 'number'
            ? rawGridId
            : Number.parseInt(String(rawGridId), 10);
        if (!Number.isFinite(parsedGridId)) {
            notification.showError(t("simulation.building.selectTransformer"));
            return;
        }
        const targetGridId = parsedGridId;

        try {
            const userId = user?.id ? String(user.id) : undefined;
            let successCount = 0;
            for (const osmId of selectedBuildingsForAssign) {
                try {
                    await pylovoService.assignBuilding(osmId, targetGridId, userId, existingModelId, draftId);
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
                        total: selectedBuildingsForAssign.length
                    })
                );
            } else {
                notification.showError(t("simulation.building.assignFailed"));
            }

            if (state.allPolygons.length > 0) {
                await actions.handlePolygonModified(state.allPolygons);
            }
        } catch (error) {
            console.error("Failed to assign buildings:", error);
            notification.showError(t("simulation.building.assignFailed"));
        }

        clearBuildingAssignMode();
    }, [
        selectedBuildingsForAssign,
        notification,
        t,
        user?.id,
        existingModelId,
        draftId,
        state.allPolygons,
        actions,
        clearBuildingAssignMode
    ]);

    // Cleanup polygon on unmount - prevents stale polygon when navigating away and back
    useEffect(() => {
        return () => {
            // Clear all drawing layers from the map when component unmounts
            clearDrawingLayersRef.current();
        };
    }, []);

    const { pylovoGridData } = pylovoLayers;
    const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');
    const getClusterKeyFromProps = useCallback((props: Record<string, any> | null | undefined): string | null => {
        if (!props) return null;
        const rawId =
            props.grid_result_id ??
            props.transformer_id ??
            props.trafo_id ??
            props.cluster_id ??
            props.id;
        if (rawId === undefined || rawId === null) return null;
        if (typeof rawId === 'number' && Number.isFinite(rawId)) {
            return `n:${rawId}`;
        }
        const rawText = String(rawId).trim();
        if (!rawText) return null;
        const num = Number(rawText);
        if (Number.isFinite(num)) {
            return `n:${num}`;
        }
        return `s:${rawText}`;
    }, []);

    const getMapProjectedCenterFromAnyCoordinates = useCallback((coordinates: unknown): [number, number] | null => {
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        const visit = (value: unknown) => {
            if (!Array.isArray(value)) return;
            if (
                value.length >= 2 &&
                typeof value[0] === 'number' &&
                typeof value[1] === 'number' &&
                Number.isFinite(value[0]) &&
                Number.isFinite(value[1])
            ) {
                const x = value[0];
                const y = value[1];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                return;
            }
            value.forEach(visit);
        };

        visit(coordinates);
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }

        const centerLonOrX = (minX + maxX) / 2;
        const centerLatOrY = (minY + maxY) / 2;

        // If coordinate looks like lon/lat, project to map projection.
        if (Math.abs(centerLonOrX) <= 180 && Math.abs(centerLatOrY) <= 90) {
            const projected = fromLonLat([centerLonOrX, centerLatOrY]);
            return [projected[0], projected[1]];
        }
        return [centerLonOrX, centerLatOrY];
    }, []);

    const reassignmentLineAnchor = useMemo<[number, number] | null>(() => {
        if (!isBuildingAssignMode || assignStep !== 'select-transformer' || selectedBuildingsForAssign.length === 0) {
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
        getMapProjectedCenterFromAnyCoordinates
    ]);

    // Fly to a region when selected from the region dropdown
    // Visual dashed line from building to cursor during reassignment
    useReassignmentLine({
        map,
        active: isBuildingAssignMode && assignStep === 'select-transformer',
        buildingCoords: reassignmentLineAnchor,
    });

    // Extract grid result IDs for statistics
    const gridResultIds = useMemo(() => {
        const ids = new Set<number>();
        const addGridId = (raw: unknown) => {
            const parsed = toFiniteNumber(raw);
            if (parsed === undefined) return;
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

    // Create lookup for transformer capacity by grid_result_id
    const gridIdToTrafoCapacity = useMemo(() => {
        const lookup: Record<number, number> = {};
        if (pylovoGridData?.transformers?.features) {
            pylovoGridData.transformers.features.forEach((feature: any) => {
                const props = feature.properties;
                if (props?.grid_result_id && props?.rated_power_kva) {
                    lookup[props.grid_result_id] = (lookup[props.grid_result_id] || 0) + props.rated_power_kva;
                }
            });
        }
        return lookup;
    }, [pylovoGridData]);

    // Create lookup for peak load by grid_result_id
    // Handles both database buildings (peak_load_in_kw) and AI-estimated buildings (peak_load_kw)
    const gridIdToPeakLoad = useMemo(() => {
        const lookup: Record<number, number> = {};
        if (pylovoGridData?.buildings?.features) {
            pylovoGridData.buildings.features.forEach((feature: any) => {
                const props = feature.properties;
                const gridId = props?.grid_result_id;
                // Check both property names: database uses peak_load_in_kw, AI estimates use peak_load_kw
                const peakKw = props?.peak_load_in_kw ?? props?.peak_load_kw;
                if (gridId !== undefined && peakKw !== undefined && peakKw !== null) {
                    lookup[gridId] = (lookup[gridId] || 0) + Number(peakKw);
                }
            });
        }

        return lookup;
    }, [pylovoGridData]);

    // Polygon-filtered building stats
    const buildingsInPolygonCount = useMemo(() => {
        const features = (pylovoGridData as any)?.buildings?.features;
        return Array.isArray(features) ? features.length : 0;
    }, [pylovoGridData]);

    const peakLoadInPolygonKw = useMemo(() => {
        const features = (pylovoGridData as any)?.buildings?.features;
        if (!Array.isArray(features)) return 0;
        return features.reduce((sum: number, f: any) => {
            const props = f?.properties;
            const peakKw = props?.peak_load_in_kw ?? props?.peak_load_kw ?? 0;
            return sum + Number(peakKw);
        }, 0);
    }, [pylovoGridData]);

    // Connected building stats per transformer (used for 3D hover tooltips)
    const gridIdToConnectedBuildings = useMemo(() => {
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
    }, [pylovoGridData, getClusterKeyFromProps]);

    // Compute custom (user-placed) transformers with building counts
    const customTransformers = useMemo(() => {
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
                const osmId = feature.properties?.osm_id || '';
                return osmId.startsWith('user/');
            })
            .map((feature: any) => {
                const props = feature.properties;
                const gridResultId = props?.grid_result_id;
                return {
                    gridResultId,
                    osmId: props?.osm_id || '',
                    buildingCount: buildingCounts[gridResultId] || 0,
                };
            });
    }, [pylovoGridData]);

    // Available transformer sizes from API
    const [transformerSizes, setTransformerSizes] = useState<{ kva: number; cost_eur: number }[]>([]);

    useEffect(() => {
        pylovoService.getTransformerSizes().then(setTransformerSizes);
    }, []);

    // Reverse geocode polygon centroid to get region name
    useEffect(() => {
        if (state.allPolygons.length === 0) {
            setRegionName(undefined);
            return;
        }

        // Calculate centroid of all polygons
        const allCoords = state.allPolygons.flatMap(poly => poly);
        if (allCoords.length === 0) return;

        const sumLon = allCoords.reduce((sum, coord) => sum + coord[0], 0);
        const sumLat = allCoords.reduce((sum, coord) => sum + coord[1], 0);
        const centroidLon = sumLon / allCoords.length;
        const centroidLat = sumLat / allCoords.length;

        // Use Nominatim for reverse geocoding
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${centroidLat}&lon=${centroidLon}&zoom=10`)
            .then(res => res.json())
            .then(data => {
                const address = data.address;
                const city = address?.city || address?.town || address?.village || address?.municipality || address?.county;
                const country = address?.country;
                if (city && country) {
                    setRegionName(`${city}, ${country}`);
                } else if (country) {
                    setRegionName(country);
                }
            })
            .catch(() => {
                // Silently fail - region will just not be shown
            });
    }, [state.allPolygons]);

    // Mouse tracking for overlays
    useEffect(() => {
        const el = mapRef?.current as HTMLElement | null;
        if (!el) return;
        const onMove = (e: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            setCursorPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
        };
        const onLeave = () => setCursorPos(null);
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        return () => {
            el.removeEventListener('mousemove', onMove);
            el.removeEventListener('mouseleave', onLeave);
        };
    }, [mapRef, setCursorPos]);

    useEffect(() => {
        if (map && mapRef.current) {
            requestAnimationFrame(() => {
                if (map && mapRef.current) {
                    map.updateSize();
                }
            });

            const timers = [
                setTimeout(() => {
                    if (map && mapRef.current) {
                        map.updateSize();
                    }
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
                }, 500)
            ];

            return () => {
                for (const timer of timers) {
                    clearTimeout(timer);
                }
            };
        }
    }, [map, mapRef]);

    // Handle transformer kVA change via dialog
    const handleTransformerKvaChange = useCallback((newKva: number) => {
        if (mapInteractions.selectedTransformer) {
            pylovoLayers.updateTransformerKva(mapInteractions.selectedTransformer.gridResultId, newKva);
            mapInteractions.setSelectedTransformer((prev: typeof mapInteractions.selectedTransformer) => prev ? { ...prev, ratedPowerKva: newKva } : null);
            notification.showSuccess(`Transformer updated to ${newKva} kVA`);
        }
    }, [mapInteractions.selectedTransformer, notification, pylovoLayers, mapInteractions.setSelectedTransformer]);

    // Handle per-f_class demand change via dialog
    const handleFClassDemandChange = useCallback((fClass: string, newDemand: number) => {
        if (mapInteractions.selectedBuilding) {
            pylovoLayers.updateBuildingFClassDemand(mapInteractions.selectedBuilding.osmId, fClass, newDemand);
            mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) => {
                if (!prev) return null;
                const existingDetails = (prev.fClassDetails && prev.fClassDetails.length > 0)
                    ? prev.fClassDetails
                    : [{ fClass, yearlyDemandKwh: prev.yearlyDemandKwh ?? 0, peakLoadKw: prev.peakLoadKw ?? 0 }];
                let updated = false;
                const updatedDetails = existingDetails.map((d: any) => {
                    if (d.fClass !== fClass) return d;
                    updated = true;
                    return { ...d, yearlyDemandKwh: newDemand };
                });
                if (!updated) {
                    updatedDetails.push({ fClass, yearlyDemandKwh: newDemand, peakLoadKw: 0 });
                }
                const newTotal = updatedDetails.reduce((sum: number, d: any) => sum + d.yearlyDemandKwh, 0);
                return { ...prev, fClassDetails: updatedDetails, yearlyDemandKwh: newTotal };
            });
        }
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding]);

    // Handle floors change from BuildingDialog
    const handleFloorsChange = useCallback((floors: number) => {
        if (!mapInteractions.selectedBuilding) return;
        pylovoLayers.updateBuildingProperty(mapInteractions.selectedBuilding.osmId, 'floors', floors);
        pylovoLayers.updateBuildingProperty(mapInteractions.selectedBuilding.osmId, 'floors_3dbag', floors);
        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
            prev ? { ...prev, floors, floors3dBag: floors } : null
        );
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding]);

    // Handle area change from BuildingDialog
    const handleAreaChange = useCallback((area: number) => {
        if (!mapInteractions.selectedBuilding) return;
        pylovoLayers.updateBuildingProperty(mapInteractions.selectedBuilding.osmId, 'area', area);
        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
            prev ? { ...prev, area } : null
        );
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding]);

    const handleHouseholdSizeChange = useCallback((householdSize: number) => {
        if (!mapInteractions.selectedBuilding) return;
        const activeClass =
            normalizeFClass(String(mapInteractions.selectedBuilding.selectedFClass ?? "")) ||
            normalizeFClass(String(mapInteractions.selectedBuilding.fClass ?? "")) ||
            normalizeFClass(String(mapInteractions.selectedBuilding.type ?? ""));
        if (!isResidentialFClass(activeClass)) return;
        pylovoLayers.updateBuildingProperty(mapInteractions.selectedBuilding.osmId, 'household_size', householdSize);
        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
            prev ? { ...prev, householdSize } : null
        );
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding]);

    // Handle recalculate demand via energy service
    const handleRecalculateDemand = useCallback(async (floors: number, area: number, householdSize?: number, _selectedFloor?: "all" | number, energyLabel?: string, hotWaterElectric?: boolean) => {
        if (!mapInteractions.selectedBuilding) return;

        const requestedFloors = Math.max(1, Math.round(toFiniteNumber(floors) ?? 1));
        const requestedArea = Math.max(1, toFiniteNumber(area) ?? 1);

        // Always estimate for the full building to ensure consistent results.
        // Per-floor display is handled by dividing the total by number of floors.
        const estimateFloors = requestedFloors;
        const estimateArea = requestedArea * requestedFloors;

        const buildingType =
            normalizeFClass(String(mapInteractions.selectedBuilding.selectedFClass ?? "")) ||
            normalizeFClass(String(mapInteractions.selectedBuilding.fClass ?? "")) ||
            mapInteractions.selectedBuilding.type;
        const selectedFClass =
            normalizeFClass(String(mapInteractions.selectedBuilding.selectedFClass ?? "")) ||
            normalizeFClass(String(mapInteractions.selectedBuilding.fClass ?? "")) ||
            normalizeFClass(String(buildingType ?? "")) ||
            "unknown";

        const shouldUseHouseholdSize = isResidentialFClass(String(buildingType ?? ""));
        const requestedHousehold = shouldUseHouseholdSize
            ? Math.max(1, Math.round(toFiniteNumber(householdSize) ?? 1))
            : undefined;

        const householdForEstimate = requestedHousehold;
        const yearOfConstruction = toFiniteNumber(mapInteractions.selectedBuilding.constructionYear);
        try {
            const estimate = await energyService.estimateBuildingEnergyDemand(
                buildingType,
                estimateArea,
                householdForEstimate,
                yearOfConstruction,
                estimateFloors,
                energyLabel,
                hotWaterElectric
            );
            const osmId = mapInteractions.selectedBuilding.osmId;

            const isSyntheticFClassDetails = Boolean(mapInteractions.selectedBuilding.fClassDetailsSynthetic);
            const baseDetails = mapInteractions.selectedBuilding.fClassDetails ?? [];
            let updatedDetails: Array<{ fClass: string; yearlyDemandKwh: number; peakLoadKw: number }> = [];

            if (isSyntheticFClassDetails) {
                updatedDetails = [{
                    fClass: selectedFClass,
                    yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                    peakLoadKw: estimate.peakLoadKw,
                }];
            } else {
                updatedDetails = baseDetails.map(
                    (detail: { fClass: string; yearlyDemandKwh: number; peakLoadKw: number }) => ({
                        ...detail,
                        fClass: normalizeFClass(String(detail.fClass ?? "")) || detail.fClass,
                    })
                );
                if (updatedDetails.length === 0) {
                    updatedDetails = [{
                        fClass: selectedFClass,
                        yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                        peakLoadKw: estimate.peakLoadKw,
                    }];
                } else {
                    let matchedSelectedClass = false;
                    updatedDetails = updatedDetails.map((detail) => {
                        const detailClass = normalizeFClass(String(detail.fClass ?? "")) || detail.fClass;
                        if (detailClass !== selectedFClass) return detail;
                        matchedSelectedClass = true;
                        return {
                            ...detail,
                            fClass: detailClass,
                            yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                            peakLoadKw: estimate.peakLoadKw,
                        };
                    });
                    if (!matchedSelectedClass) {
                        updatedDetails.push({
                            fClass: selectedFClass,
                            yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                            peakLoadKw: estimate.peakLoadKw,
                        });
                    }
                }
            }

            const totalYearlyDemand = updatedDetails.reduce((sum: number, detail: { yearlyDemandKwh: number }) => sum + (detail.yearlyDemandKwh || 0), 0);
            const totalPeakLoad = updatedDetails.reduce((sum: number, detail: { peakLoadKw: number }) => sum + (detail.peakLoadKw || 0), 0);

            // Update OL feature properties
            pylovoLayers.updateBuildingProperty(osmId, 'yearly_demand_kwh', totalYearlyDemand);
            pylovoLayers.updateBuildingProperty(osmId, 'demand_energy', totalYearlyDemand);
            pylovoLayers.updateBuildingProperty(osmId, 'peak_load_kw', totalPeakLoad);
            pylovoLayers.updateBuildingProperty(osmId, 'area', requestedArea);
            pylovoLayers.updateBuildingProperty(osmId, 'floors', requestedFloors);
            pylovoLayers.updateBuildingProperty(osmId, 'floors_3dbag', requestedFloors);
            if (shouldUseHouseholdSize) {
                pylovoLayers.updateBuildingProperty(osmId, 'household_size', estimate.householdSize ?? requestedHousehold);
            } else {
                pylovoLayers.updateBuildingProperty(osmId, 'household_size', null);
            }
            pylovoLayers.updateBuildingProperty(
                osmId,
                'estimated_households',
                estimate.estimatedHouseholds ?? null
            );
            pylovoLayers.updateBuildingProperty(osmId, 'selected_f_class', selectedFClass);

            // Update fclass_details on OL feature
            pylovoLayers.updateBuildingProperty(osmId, 'fclass_details', updatedDetails);
            pylovoLayers.updateBuildingProperty(
                osmId,
                'f_class_demands',
                updatedDetails.map((detail: { fClass: string; yearlyDemandKwh: number; peakLoadKw: number }) => ({
                    f_class: detail.fClass,
                    demand_energy: detail.yearlyDemandKwh,
                    peak_load_kw: detail.peakLoadKw,
                }))
            );

            // Update local dialog state
            mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
                prev ? {
                    ...prev,
                    yearlyDemandKwh: totalYearlyDemand,
                    peakLoadKw: totalPeakLoad,
                    area: requestedArea,
                    floors: requestedFloors,
                    floors3dBag: requestedFloors,
                    householdSize: shouldUseHouseholdSize ? (estimate.householdSize ?? requestedHousehold) : undefined,
                    estimatedHouseholds: estimate.estimatedHouseholds,
                    selectedFClass,
                    fClassDetails: updatedDetails,
                    fClassDetailsSynthetic: isSyntheticFClassDetails,
                } : null
            );
            notification.showSuccess(
                `Recalculated: ${estimate.yearlyConsumptionKwh.toLocaleString()} kWh/yr (${selectedFClass}), ${estimate.peakLoadKw.toFixed(2)} kW peak`
            );
        } catch (error) {
            console.error('Recalculate demand failed:', error);
            notification.showError('Failed to recalculate energy demand');
        }
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding, notification]);

    const handleSelectedFClassChange = useCallback((fClass: string) => {
        if (!mapInteractions.selectedBuilding) return;
        const normalized = normalizeFClass(String(fClass ?? "")) || fClass.trim().toLowerCase();
        if (!normalized) return;
        const osmId = mapInteractions.selectedBuilding.osmId;
        pylovoLayers.updateBuildingProperty(osmId, 'selected_f_class', normalized);
        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
            prev ? { ...prev, selectedFClass: normalized } : null
        );
    }, [mapInteractions.selectedBuilding, pylovoLayers, mapInteractions.setSelectedBuilding]);

    // Handle adding tech from BuildingDialog
    const handleAddTechFromDialog = useCallback((tech: import("@/features/technologies/services/technologyService").Technology) => {
        if (!mapInteractions.selectedBuildingFeature) return;
        // Close building dialog temporarily, open tech parameter dialog
        // When tech dialog closes, building dialog will reopen (see onClose below)
        techAddedFromBuildingDialogRef.current = true;
        mapInteractions.setBuildingDialogOpen(false);
        techOperations.setSelectedTechForDialog(tech);
        techOperations.setSelectedBuildingForTech(mapInteractions.selectedBuildingFeature);
        techOperations.setTechDialogOpen(true);
    }, [mapInteractions, techOperations]);

    // Handle applying tech to all multi-edit selected buildings
    const handleApplyTechToSelected = useCallback((tech: import("@/features/technologies/services/technologyService").Technology) => {
        if (multiEditSelectedIds.size === 0) return;
        // For each selected building feature, open the tech parameter dialog
        // For simplicity, we add the tech to the first selected building via the normal flow
        // A more complete implementation would iterate all features
        if (mapInteractions.selectedBuildingFeature) {
            techAddedFromBuildingDialogRef.current = true;
            mapInteractions.setBuildingDialogOpen(false);
            techOperations.setSelectedTechForDialog(tech);
            techOperations.setSelectedBuildingForTech(mapInteractions.selectedBuildingFeature);
            techOperations.setTechDialogOpen(true);
        }
    }, [multiEditSelectedIds, mapInteractions, techOperations]);
    const handleRunPowerFlow = useCallback(async () => {
        try {
            const success = await pylovoLayers.runPowerFlowAnalysis();
            if (success) {
                notification.showSuccess(t('simulation.powerFlow.success') || 'Power flow analysis completed. Line colors now show load utilization.');
            } else {
                notification.showError(t('simulation.powerFlow.noData') || 'No grid data available for power flow analysis.');
            }
            return success;
        } catch (error) {
            console.error('Power flow analysis error:', error);
            notification.showError(t('simulation.powerFlow.error') || 'Power flow analysis failed. Check console for details.');
            return false;
        }
    }, [pylovoLayers, notification, t]);

    // Handle add transformer mode - click on map to place transformer
    const handleAddTransformer = useCallback(async (kva: number) => {
        console.log('handleAddTransformer called', { kva, newTransformerCoords, existingModelId, draftId, gridResultIds });
        if (!newTransformerCoords) {
            console.error('newTransformerCoords is null!');
            notification.showError('Invalid transformer location — please click on the map first');
            return;
        }

        try {
            const userId = user?.id ? String(user.id) : undefined;
            const result = await pylovoService.addTransformer({
                coordinates: newTransformerCoords,
                kva,
                grid_result_ids: gridResultIds,  // Can be empty - no auto-assign anyway
                reassign_radius_m: 0,  // No auto-assign - buildings assigned manually
                user_id: userId,  // Current user's ID (same format as generateGrid)
                model_id: existingModelId,  // Current model ID (if in edit mode)
                draft_id: draftId  // Draft ID for new models (scopes transformer to this session)
            });

            notification.showSuccess(result.message || `Added transformer with ${kva} kVA`);

            // Refresh the grid data by re-running the grid generation
            if (state.allPolygons.length > 0) {
                await actions.handlePolygonModified(state.allPolygons);
            }

            setNewTransformerCoords(null);
            setAddTransformerDialogOpen(false);
            setIsAddTransformerMode(false);
        } catch (error: any) {
            console.error('Failed to add transformer:', error);
            notification.showError(error?.message || 'Failed to add transformer');
        }
    }, [newTransformerCoords, gridResultIds, notification, state.allPolygons, actions, user?.id, existingModelId, draftId]);

    // Handle delete transformer
    const handleDeleteTransformer = useCallback(async (gridResultId: number) => {
        try {
            const userId = user?.id ? String(user.id) : undefined;
            const result = await pylovoService.deleteTransformer(gridResultId, userId, existingModelId, draftId);
            notification.showSuccess(result.message || 'Transformer deleted');

            // Refresh the grid data
            if (state.allPolygons.length > 0) {
                await actions.handlePolygonModified(state.allPolygons);
            }
        } catch (error: any) {
            console.error('Failed to delete transformer:', error);
            notification.showError(error?.message || 'Failed to delete transformer');
        }
    }, [notification, state.allPolygons, actions, user?.id, existingModelId, draftId]);

    // Map click handler for add transformer mode
    useEffect(() => {
        if (!map || !isAddTransformerMode) {
            setTransformerCursorPos(null);
            return;
        }

        const handleMapClick = (evt: any) => {
            // Convert pixel to coordinates (lon, lat)
            const coords = map.getCoordinateFromPixel(evt.pixel);
            // Transform from map projection (EPSG:3857) to WGS84 (EPSG:4326)
            const lonLat = toLonLat(coords);
            setNewTransformerCoords([lonLat[0], lonLat[1]]);
            setAddTransformerDialogOpen(true);
        };

        const handleMouseMove = (evt: any) => {
            const mapElement = map.getTargetElement();
            if (mapElement) {
                const rect = mapElement.getBoundingClientRect();
                setTransformerCursorPos({
                    x: evt.pixel[0] + rect.left,
                    y: evt.pixel[1] + rect.top
                });
            }
        };

        const handleMouseLeave = () => {
            setTransformerCursorPos(null);
        };

        map.on('click', handleMapClick);
        map.on('pointermove', handleMouseMove);

        // Change cursor to none (we'll show custom cursor)
        const mapElement = map.getTargetElement();
        if (mapElement) {
            mapElement.style.cursor = 'none';
            mapElement.addEventListener('mouseleave', handleMouseLeave);
        }

        return () => {
            map.un('click', handleMapClick);
            map.un('pointermove', handleMouseMove);
            if (mapElement) {
                mapElement.style.cursor = '';
                mapElement.removeEventListener('mouseleave', handleMouseLeave);
            }
            setTransformerCursorPos(null);
        };
    }, [map, isAddTransformerMode]);

    // Map click handler for move transformer mode
    useEffect(() => {
        if (!map || !isMoveTransformerMode || !transformerToMove) {
            return;
        }

        const handleMapClick = async (evt: any) => {
            const coords = map.getCoordinateFromPixel(evt.pixel);
            const lonLat = toLonLat(coords);

            try {
                const userId = user?.id ? String(user.id) : undefined;
                await pylovoService.moveTransformer(transformerToMove, [lonLat[0], lonLat[1]], userId, existingModelId, draftId);
                notification.showSuccess(t("transformer.movingSuccess"));
                // Refresh grid data by re-running polygon drawn with existing polygons
                if (state.allPolygons.length > 0) {
                    const lastPolygon = state.allPolygons[state.allPolygons.length - 1];
                    await actions.handlePolygonDrawn(lastPolygon, state.allPolygons);
                }
            } catch (error) {
                console.error("Failed to move transformer:", error);
                notification.showError(t("transformer.movingFailed"));
            } finally {
                setIsMoveTransformerMode(false);
                setTransformerToMove(null);
            }
        };

        const handleMouseMove = (evt: any) => {
            const mapElement = map.getTargetElement();
            if (mapElement) {
                const rect = mapElement.getBoundingClientRect();
                setTransformerCursorPos({
                    x: evt.pixel[0] + rect.left,
                    y: evt.pixel[1] + rect.top
                });
            }
        };

        const handleMouseLeave = () => {
            setTransformerCursorPos(null);
        };

        map.on('click', handleMapClick);
        map.on('pointermove', handleMouseMove);

        const mapElement = map.getTargetElement();
        if (mapElement) {
            mapElement.style.cursor = 'none';
            mapElement.addEventListener('mouseleave', handleMouseLeave);
        }

        return () => {
            map.un('click', handleMapClick);
            map.un('pointermove', handleMouseMove);
            if (mapElement) {
                mapElement.style.cursor = '';
                mapElement.removeEventListener('mouseleave', handleMouseLeave);
            }
            setTransformerCursorPos(null);
        };
    }, [map, isMoveTransformerMode, transformerToMove, notification, t, state.allPolygons, actions, user?.id, existingModelId, draftId]);

    // Map click handler for multi-building assignment mode
    useEffect(() => {
        if (!map || !isBuildingAssignMode) {
            return;
        }

        const handleMapClick = async (evt: any) => {
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => {
                const type = f.get('feature_type');
                if (type === 'building' || type === 'transformer') return f;
                return null;
            });

            if (!feature) return;

            const featureType = feature.get('feature_type');

            if (assignStep === 'select-buildings') {
                // In building selection step - toggle building selection
                if (featureType === 'building') {
                    toggleBuildingSelection(feature.get('osm_id'), feature);
                }
            } else if (assignStep === 'select-transformer') {
                // In transformer selection step
                if (featureType === 'transformer') {
                    await assignSelectedBuildingsToTransformer(
                        feature.get('grid_result_id') ??
                        feature.get('transformer_id') ??
                        feature.get('trafo_id') ??
                        feature.get('id')
                    );
                } else {
                    notification.showError(t("simulation.building.selectTransformer"));
                }
            }
        };

        // Escape key to cancel
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                clearBuildingAssignMode();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        const mapElement = map.getTargetElement();
        if (mapElement) {
            mapElement.style.cursor = assignStep === 'select-buildings' ? 'pointer' : 'crosshair';
        }

        map.on('click', handleMapClick);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            map.un('click', handleMapClick);
            if (mapElement) {
                mapElement.style.cursor = '';
            }
        };
    }, [
        map,
        isBuildingAssignMode,
        assignStep,
        notification,
        t,
        clearBuildingAssignMode,
        toggleBuildingSelection,
        assignSelectedBuildingsToTransformer
    ]);

    const handleMl3dBuildingClick = useCallback((props: Record<string, any>) => {
        if (isAddTransformerMode || isMoveTransformerMode) return;
        if (isBuildingAssignMode) {
            if (assignStep === 'select-buildings') {
                toggleBuildingSelection(props.osm_id);
            } else {
                notification.showError(t("simulation.building.selectTransformer"));
            }
            return;
        }
        const fClasses = getFeatureFClasses(props);
        const primaryFClass = getPrimaryFClass(props) || 'unknown';
        const enrichment = extractBuildingEnrichmentFromProps(props);
        const totalDemand = extractYearlyDemandFromProps(props);
        const totalPeak = extractPeakLoadFromProps(props);
        const effectiveFClasses = fClasses.length > 0 ? fClasses : [primaryFClass];
        const selectedFClass = extractSelectedFClassFromProps(props, effectiveFClasses, primaryFClass);
        const { details: fClassDetails, synthetic: fClassDetailsSynthetic } = buildInitialFClassDetails(
            props,
            effectiveFClasses,
            selectedFClass,
            totalDemand,
            totalPeak
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
            fClassDetailsSynthetic,
            ...enrichment,
        });
        mapInteractions.setBuildingDialogOpen(true);
    }, [
        isBuildingAssignMode,
        isAddTransformerMode,
        isMoveTransformerMode,
        assignStep,
        toggleBuildingSelection,
        notification,
        t,
        mapInteractions
    ]);

    const handleMl3dTransformerClick = useCallback((props: Record<string, any>) => {
        if (isAddTransformerMode || isMoveTransformerMode) return;
        if (isBuildingAssignMode) {
            if (assignStep === 'select-transformer') {
                void assignSelectedBuildingsToTransformer(
                    props.grid_result_id ??
                    props.transformer_id ??
                    props.trafo_id ??
                    props.id
                );
            } else {
                notification.showError(t("simulation.building.selectBuildings"));
            }
            return;
        }
        mapInteractions.setSelectedTransformer({
            gridResultId: props.grid_result_id,
            osmId: props.osm_id || '',
            ratedPowerKva: props.rated_power_kva || 0,
        });
        mapInteractions.setTransformerDialogOpen(true);
    }, [
        isBuildingAssignMode,
        isAddTransformerMode,
        isMoveTransformerMode,
        assignStep,
        assignSelectedBuildingsToTransformer,
        notification,
        t,
        mapInteractions
    ]);

    const handleMl3dBuildingHover = useCallback((props: Record<string, any> | null, pixel: [number, number]) => {
        if (!props) { mapInteractions.setBuildingTooltip(null); return; }
        const fClasses = getFeatureFClasses(props);
        const primary = getPrimaryFClass(props) || 'unknown';
        const enrichment = extractBuildingEnrichmentFromProps(props);
        mapInteractions.setBuildingTooltip({
            x: pixel[0], y: pixel[1],
            type: primary, fClass: primary, fClasses,
            yearlyDemandKwh: extractYearlyDemandFromProps(props),
            techs: parseTechs(props.techs),
            gridResultId: props.grid_result_id ?? props.transformer_id,
            ...enrichment,
        });
    }, [mapInteractions]);

    const handleMl3dTransformerHover = useCallback((props: Record<string, any> | null, pixel: [number, number]) => {
        if (!props) { mapInteractions.setTransformerTooltip(null); return; }

        const clusterKey = getClusterKeyFromProps(props);
        const rawGridId =
            props.grid_result_id ??
            props.transformer_id ??
            props.trafo_id ??
            props.cluster_id ??
            props.id;
        const gridResultId = typeof rawGridId === 'number'
            ? rawGridId
            : Number.parseInt(String(rawGridId), 10);
        const connected = clusterKey ? gridIdToConnectedBuildings[clusterKey] : undefined;

        mapInteractions.setTransformerTooltip({
            x: pixel[0], y: pixel[1],
            ratedPowerKva: props.rated_power_kva || 0,
            gridResultId: Number.isFinite(gridResultId) ? gridResultId : rawGridId,
            connectedBuildingCount: connected?.count ?? 0,
            connectedBuildingTypes: connected?.types ?? [],
        });
    }, [mapInteractions, gridIdToConnectedBuildings, getClusterKeyFromProps]);

    const handleMl3dMvLineHover = useCallback((props: Record<string, any> | null, pixel: [number, number]) => {
        if (!props) { mapInteractions.setMvLineTooltip(null); return; }
        mapInteractions.setMvLineTooltip({
            x: pixel[0], y: pixel[1],
            voltage: props.voltage || (props.vn_kv ? `${props.vn_kv} kV` : '20 kV'),
            lengthM: props.length_m || props.length || 0,
            cableType: props.cable_type || props.std_type || '',
            normallyOpen: props.normally_open || false,
            fromBus: props.from_bus || props.from_node || '',
            toBus: props.to_bus || props.to_node || '',
        });
    }, [mapInteractions]);

    const handleMl3dMapClick = useCallback((lngLat: [number, number]) => {
        if (isAddTransformerMode) {
            setNewTransformerCoords(lngLat);
            setAddTransformerDialogOpen(true);
        }
    }, [isAddTransformerMode]);

    const showDrawHint = state.cursorPos && !state.isDrawing && (state.allowMultiplePolygons || state.allPolygons.length === 0);

    const handlePolygonDrawnWithLimit = async (coordinates: [number, number][], allPolygons: [number, number][][]) => {
        // Building limit check is now handled inside the hook
        await actions.handlePolygonDrawn(coordinates, allPolygons);
    };

    // Wrapper for clear all that also resets transformer and building assign modes
    const handleClearAllWithModes = useCallback(() => {
        actions.handleClearAllPolygons();
        setIsAddTransformerMode(false);
        setIsBuildingAssignMode(false);
        setSelectedBuildingsForAssign([]);
        setAssignStep('select-buildings');
        selectedBuildingFeaturesRef.current.clear();
        // Generate a new draft ID so old user-placed transformers are not reused
        if (!editMode) {
            setDraftId(generateUUID());
        }
    }, [actions, editMode]);

    const handleRegionSelect = useCallback((region: { name?: string; bbox?: { west: number; south: number; east: number; north: number } }) => {
        if (!map || !region.bbox) return;

        // Clear existing polygons and reset drawing state for the new region
        handleClearAllWithModes();

        const { west, south, east, north } = region.bbox;
        const extent = transformExtent([west, south, east, north], 'EPSG:4326', 'EPSG:3857');
        map.getView().fit(extent, {
            padding: [60, 60, 60, 60],
            duration: 1500,
            maxZoom: 14,
            easing: (t: number) => t * (2 - t),
        });
        const selectedName = region.name || null;
        highlightSelectedRegionBoundary(map, selectedName);
    }, [map, handleClearAllWithModes]);

    // Click a boundary polygon on the map → select that region
    const handleBoundaryRegionClick = useCallback((regionName: string) => {
        const region = pylovoLayers.availableRegions?.find(
            (r: { name: string }) => r.name.toLowerCase() === regionName.toLowerCase()
        );
        if (region) handleRegionSelect(region);
    }, [pylovoLayers.availableRegions, handleRegionSelect]);

    return (
        <Fragment>
            <Notification
                isOpen={notification.data.open}
                message={notification.data.message}
                severity={notification.data.severity}
                onClose={notification.hide}
            />
            {editMode && state.isLoadingModel && (
                <div className="fixed inset-0 bg-background/80 dark:bg-gray-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-background dark:bg-gray-800 rounded-lg shadow-xl p-8 max-w-md mx-4 border border-border">
                        <div className="flex flex-col items-center space-y-4">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            <div className="text-lg font-medium text-foreground">Loading Simulation Data</div>
                            <div className="text-sm text-muted-foreground text-center">
                                Please wait while we load your energy simulation...
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <MapContainer
                key={editMode ? `edit-${existingModelId}` : 'create'}
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
                    />
                }
                onDrop={techOperations.handleMapDrop}
                onDragOver={techOperations.handleMapDragOver}
                mapOverlays={
                    <>
                        {map && isMapLibre3D && (
                            <MapLibre3DOverlay
                                olMap={map}
                                buildingsGeoJSON={pylovoGridData?.buildings}
                                linesGeoJSON={pylovoGridData?.lines}
                                mvLinesGeoJSON={pylovoGridData?.mv_lines}
                                transformersGeoJSON={pylovoGridData?.transformers}
                                availableBoundaryGeoJSON={pylovoLayers.availableBoundaryGeoJSON}
                                selectedBoundaryFeature={pylovoLayers.regionBoundary?.boundary}
                                showBoundary={pylovoLayers.showBoundary}
                                polygonCoordinates={state.allPolygons}
                                selectedBuildingOsmIds={selectedBuildingsForAssign}
                                isBuildingAssignMode={isBuildingAssignMode}
                                visible={isMapLibre3D}
                                isDrawing={state.isDrawing}
                                onBuildingClick={handleMl3dBuildingClick}
                                onTransformerClick={handleMl3dTransformerClick}
                                onBuildingHover={handleMl3dBuildingHover}
                                onTransformerHover={handleMl3dTransformerHover}
                                onMvLineHover={handleMl3dMvLineHover}
                                onMapClick={handleMl3dMapClick}
                                onBoundaryRegionClick={handleBoundaryRegionClick}
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
                                hasGridData={(pylovoGridData?.buildings?.features?.length ?? 0) > 0}
                                isRunningPowerFlow={pylovoLayers.isRunningPowerFlow}
                                hasPowerFlowResults={pylovoLayers.powerFlowResults.size > 0}
                            />
                        )}
                        <GridActionBar
                            hasGridData={(pylovoGridData?.buildings?.features?.length ?? 0) > 0}
                            isAddTransformerMode={isAddTransformerMode}
                            onToggleAddTransformerMode={() => setIsAddTransformerMode(!isAddTransformerMode)}
                            isBuildingAssignMode={isBuildingAssignMode}
                            onStartBuildingAssignMode={() => {
                                setIsBuildingAssignMode(true);
                                setSelectedBuildingsForAssign([]);
                                setAssignStep('select-buildings');
                            }}
                            onRunPowerFlow={handleRunPowerFlow}
                            isRunningPowerFlow={pylovoLayers.isRunningPowerFlow}
                            hasPowerFlowResults={pylovoLayers.powerFlowResults.size > 0}
                        />
                        {/* Show hint when in add transformer mode */}
                        {isAddTransformerMode && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
                                {t('simulation.transformer.clickToPlace', 'Click inside the polygon to place a transformer')}
                            </div>
                        )}
                        {/* Show banner when in multi-building assignment mode */}
                        {isBuildingAssignMode && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
                                {assignStep === 'select-buildings' ? (
                                    <>
                                        <span>
                                            {selectedBuildingsForAssign.length === 0
                                                ? t('simulation.building.selectBuildings')
                                                : t('simulation.building.selectedCount', { count: selectedBuildingsForAssign.length })}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setAssignStep('select-transformer')}
                                            disabled={selectedBuildingsForAssign.length === 0}
                                            className="px-3 py-1 rounded bg-white text-blue-600 hover:bg-blue-50 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {t('simulation.building.nextStep')}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span>{t('simulation.building.selectTransformer')}</span>
                                        <button
                                            type="button"
                                            onClick={() => setAssignStep('select-buildings')}
                                            className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs transition-colors"
                                        >
                                            ← {t('simulation.building.nextStep').includes('Next') ? 'Back' : 'Zurück'}
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={clearBuildingAssignMode}
                                    className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs transition-colors"
                                >
                                    {t('simulation.building.cancelAssign')} (Esc)
                                </button>
                            </div>
                        )}
                        {/* Power flow calculating banner */}
                        {pylovoLayers.isRunningPowerFlow && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
                                <div className="flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full px-5 py-2.5 shadow-lg">
                                    <div className="relative w-5 h-5">
                                        <div className="absolute inset-0 rounded-full border-2 border-amber-500/20" />
                                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-500 animate-spin" />
                                    </div>
                                    <span className="text-sm font-medium text-foreground whitespace-nowrap">
                                        {t('simulation.powerFlow.calculating')}
                                    </span>
                                </div>
                            </div>
                        )}
                        {/* Power flow legend */}
                        <PowerFlowLegend 
                            visible={pylovoLayers.powerFlowResults.size > 0} 
                            customTransformers={customTransformers}
                        />
                        {/* Map legend */}
                        <MapLegend />
                    </>
                }
                mapHeader={
                    <MapHeader
                        allPolygonsCount={state.allPolygons.length}
                        allowMultiplePolygons={state.allowMultiplePolygons}
                        onToggleAllowMultiplePolygons={actions.setAllowMultiplePolygons}
                        onClearAllPolygons={handleClearAllWithModes}
                        isLoadingPreference={isLoadingPreference}
                        wsReloadKey={wsReloadKey}
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
                        onRegionSelect={editMode ? undefined : handleRegionSelect}
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
                onClearAll={handleClearAllWithModes}
                allowMultiple={state.allowMultiplePolygons}
                clearTrigger={state.clearTrigger}
                initialPolygons={editMode ? state.loadedCoordinates : undefined}
                disableAfterDraw={!state.allowMultiplePolygons}
                enableEditing={true}
                labels={{
                    clickToClose: t("drawing.clickToClose"),
                    start: t("drawing.start")
                }}
                />

            <TransformerDialog
                open={mapInteractions.transformerDialogOpen}
                selectedTransformer={mapInteractions.selectedTransformer}
                transformerSizes={transformerSizes}
                onClose={mapInteractions.handleCloseTransformerDialog}
                onChangeKva={handleTransformerKvaChange}
                onOpenChange={mapInteractions.setTransformerDialogOpen}
                onDeleteTransformer={handleDeleteTransformer}
                onMoveTransformer={(gridResultId) => {
                    setTransformerToMove(gridResultId);
                    setIsMoveTransformerMode(true);
                    mapInteractions.setTransformerDialogOpen(false);
                }}
                isUserPlaced={mapInteractions.selectedTransformer?.osmId?.startsWith('user/') || false}
            />

            {/* Add Transformer Dialog */}
            <TransformerDialog
                open={addTransformerDialogOpen}
                selectedTransformer={null}
                transformerSizes={transformerSizes}
                onClose={() => {
                    setAddTransformerDialogOpen(false);
                    setNewTransformerCoords(null);
                }}
                onChangeKva={() => {}}
                onOpenChange={setAddTransformerDialogOpen}
                mode="add"
                newTransformerCoords={newTransformerCoords}
                onAddTransformer={handleAddTransformer}
            />

            <BuildingDialog
                open={mapInteractions.buildingDialogOpen}
                selectedBuilding={mapInteractions.selectedBuilding}
                onClose={mapInteractions.handleCloseBuildingDialog}
                onFClassDemandChange={handleFClassDemandChange}
                onSelectedFClassChange={handleSelectedFClassChange}
                onOpenChange={mapInteractions.setBuildingDialogOpen}
                onEditTech={(techKey) => {
                   if(mapInteractions.selectedBuildingFeature) {
                       mapInteractions.setBuildingDialogOpen(false);
                       techOperations.handleEditTechFromDialog(techKey, mapInteractions.selectedBuildingFeature);
                   }
                }}
                onRemoveTech={(techKey) => {
                    if (mapInteractions.selectedBuildingFeature) {
                        const updatedTechs = techOperations.handleRemoveTechFromDialog(techKey, mapInteractions.selectedBuildingFeature);
                        // Update local state to reflect removal in dialog immediately
                        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) => prev ? { ...prev, techs: updatedTechs } : null);
                    }
                }}
                onFloorsChange={handleFloorsChange}
                onAreaChange={handleAreaChange}
                onHouseholdSizeChange={handleHouseholdSizeChange}
                onRecalculateDemand={handleRecalculateDemand}
                onAddTech={isMultiEdit ? handleApplyTechToSelected : handleAddTechFromDialog}
                isMultiEdit={isMultiEdit}
                onToggleMultiEdit={(v) => {
                    setIsMultiEdit(v);
                    if (!v) {
                        // Clear multi-edit selection
                        multiEditFeaturesRef.current.forEach(f => f.setStyle(undefined));
                        multiEditFeaturesRef.current.clear();
                        setMultiEditSelectedIds(new Set());
                    }
                }}
                multiEditCount={multiEditSelectedIds.size}
                onApplyTechToAll={handleApplyTechToSelected}
                isExcluded={(() => {
                    const osmId = mapInteractions.selectedBuilding?.osmId;
                    if (!osmId) return false;
                    const numId = typeof osmId === 'number' ? osmId : Number.parseInt(String(osmId), 10);
                    return numId < 0 && state.excludedBuildingIds.has(Math.abs(numId));
                })()}
                onToggleExclude={actions.toggleBuildingExclusion}
                onApplyTemplate={(templateTechs) => {
                    if (mapInteractions.selectedBuildingFeature) {
                        // Set all template techs on the building feature
                        const feature = mapInteractions.selectedBuildingFeature;
                        for (const [techKey, techData] of Object.entries(templateTechs)) {
                            feature.set(`tech_${techKey}`, JSON.stringify(techData));
                        }
                        // Update the dialog view
                        mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) => prev ? { ...prev, techs: { ...prev.techs, ...templateTechs } } : null);
                    }
                }}
            />

            <CreateWorkspaceModal
                isOpen={isCreateWsOpen}
                onClose={() => setIsCreateWsOpen(false)}
                onSuccess={(newWorkspace) => {
                    setIsCreateWsOpen(false);
                    handleWorkspaceChange(newWorkspace);
                    setWsReloadKey((k) => k + 1);
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
                    // Reopen building dialog if tech was added from it
                    if (techAddedFromBuildingDialogRef.current) {
                        techAddedFromBuildingDialogRef.current = false;
                        // Refresh selectedBuilding techs from the OL feature
                        const feat = mapInteractions.selectedBuildingFeature;
                        if (feat) {
                            const updatedTechs = feat.get('techs') || {};
                            mapInteractions.setSelectedBuilding((prev: typeof mapInteractions.selectedBuilding) =>
                                prev ? { ...prev, techs: { ...updatedTechs } } : null
                            );
                        }
                        mapInteractions.setBuildingDialogOpen(true);
                    }
                }}
                showApplyToAll={techOperations.isAddingTechToAll}
            />

            {/* Transformer cursor overlay */}
            {(isAddTransformerMode || isMoveTransformerMode) && transformerCursorPos && (
                <div
                    className="fixed pointer-events-none z-[9999] flex flex-col items-center"
                    style={{
                        left: transformerCursorPos.x,
                        top: transformerCursorPos.y,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    <img
                        src="/images/transformer-icon-black.svg"
                        alt=""
                        className="w-5 h-5 drop-shadow-md"
                    />
                    {isMoveTransformerMode && (
                        <span className="text-[10px] font-medium text-black whitespace-nowrap mt-0.5">
                            {t("transformer.clickToMove")}
                        </span>
                    )}
                </div>
            )}
        </Fragment>
    );
};
