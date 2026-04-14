import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { modelService } from '@/features/model-dashboard/services/modelService';
import { useCreateModelMutation, useUpdateModelMutation2 } from '@/features/model-dashboard/hooks/useModelsQuery';
import axios from '@/lib/axios';
import type {
	AreaData,
	UseAreaSelectProps,
	AreaSelectState,
	AreaSelectActions,
	PylovoGridData,
} from '@/features/configurator/types/area-select';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { useMapProvider } from '@/providers/map-context';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import { pylovoService } from '@/features/configurator/services/pylovoService';
import { geocodingService } from '@/features/interactive-map/services/geocoding';
import { getDefaultAdvancedParameters } from '@/features/configurator/constants/area-select-params';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation } from '@spatialhub/i18n';

// OpenLayers imports
import type { Map as OLMap, Feature } from 'ol';
import type { Geometry } from 'ol/geom';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Polygon } from 'ol/geom';
import { Feature as OLFeature } from 'ol';
import { Style, Fill, Stroke } from 'ol/style';
import { fromLonLat } from 'ol/proj';

// Local project imports
import {
    transformerStyleFunction,
    cableStyleFunction,
    mvLineStyleFunction,
    parsePoiClass,
    createBuildingStyleFunction,
    createBuildingHighlightStyleFunction,
} from '@/features/interactive-map/utils/mapStyleUtils';
import { getFeatureFClasses, getPrimaryFClass, normalizeFClass } from '@/features/configurator/utils/fClassUtils';
import { getDataProjection, loadBoundaryLayer, loadAvailableBoundaryLayers } from '@/features/configurator/utils/gridLayerUtils';
import {
    extractBuildingEnrichmentFromProps,
    extractPeakLoadFromProps,
    extractSelectedFClassFromProps,
    extractYearlyDemandFromProps,
    normalizeFClassToken,
} from '@/features/configurator/utils/buildingFeatureExtraction';
import { buildFClassDetails, type FClassDetail } from '@/features/configurator/hooks/useAreaSelect/helpers/fClassDemand';
import {
    collectTransformerIds,
    extractTransformerId,
    normalizeGridLineAssignments,
    setFeatureColorIndex,
} from '@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments';
import {
    collectBuildingsFromLayers,
    countConnectedBuildings,
    findBuildingLayer,
    highlightConnectedBuildings,
} from '@/features/configurator/hooks/useAreaSelect/helpers/layerConnections';
import { customLocationService, type CustomLocation } from "@/features/locations/services/customLocationService";
import type { Technology } from "@/features/technologies/services/technologyService";

export { type AreaData } from '@/features/configurator/types/area-select';

const DEFAULT_RESOLUTION = 60;
const SAVE_DELAY_MS = 1200;
const DASHBOARD_ROUTE = "/app/model-dashboard";

const parseFlexibleNumberString = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Remove common whitespace separators (normal + non-breaking spaces)
    const compact = trimmed.replace(/[\s\u00A0\u202F]/g, '');

    // 1,234.56
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    // 1.234,56
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }

    // Decimal comma fallback
    const normalized = compact.includes(',') && !compact.includes('.')
        ? compact.replace(',', '.')
        : compact;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        return parseFlexibleNumberString(value);
    }
    return null;
};

const extractBuildingEnrichment = extractBuildingEnrichmentFromProps;
const extractPeakLoadKw = extractPeakLoadFromProps;
const extractSelectedFClass = extractSelectedFClassFromProps;
const extractYearlyDemandKwh = (props: Record<string, unknown>): number =>
    extractYearlyDemandFromProps(props, { demandEnergyFallback: 'all' });

const checkBboxIntersection = (
    polygon: [number, number][],
    locCoords: [number, number][]
): boolean => {
    const drawnMinLon = Math.min(...polygon.map(c => c[0]));
    const drawnMaxLon = Math.max(...polygon.map(c => c[0]));
    const drawnMinLat = Math.min(...polygon.map(c => c[1]));
    const drawnMaxLat = Math.max(...polygon.map(c => c[1]));

    const locMinLon = Math.min(...locCoords.map(c => c[0]));
    const locMaxLon = Math.max(...locCoords.map(c => c[0]));
    const locMinLat = Math.min(...locCoords.map(c => c[1]));
    const locMaxLat = Math.max(...locCoords.map(c => c[1]));

    return drawnMaxLon >= locMinLon && drawnMinLon <= locMaxLon &&
           drawnMaxLat >= locMinLat && drawnMinLat <= locMaxLat;
};

// Helper to check if location intersects any polygon
const locationIntersectsPolygons = (
    location: CustomLocation,
    polygons: [number, number][][]
): boolean => {
    if (!location.geometry_area?.coordinates) return false;
    const locCoords = location.geometry_area.coordinates[0] as [number, number][];
    return polygons.some(polygon => checkBboxIntersection(polygon, locCoords));
};

const useCustomLocations = (map: OLMap | null, allPolygons: [number, number][][]) => {
    const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
    const customLocationLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
    const [customLocationsInPolygon, setCustomLocationsInPolygon] = useState<CustomLocation[]>([]);

    useEffect(() => {
        const loadCustomLocations = async () => {
            try {
                const [userResponse, publicResponse] = await Promise.all([
                    customLocationService.getUserLocations({ per_page: 100 }),
                    customLocationService.getPublicLocations({ per_page: 100 }),
                ]);
                const userLocationIds = new Set(userResponse.data.map(l => l.id));
                const uniquePublic = publicResponse.data.filter(loc => !userLocationIds.has(loc.id));
                setCustomLocations([...userResponse.data, ...uniquePublic]);
            } catch (error) {
                console.error('Failed to load custom locations:', error);
            }
        };
        loadCustomLocations();
    }, []);

    useEffect(() => {
        if (allPolygons.length === 0 || customLocations.length === 0) {
            setCustomLocationsInPolygon([]);
            return;
        }

        const intersectingLocations = customLocations.filter(
            loc => locationIntersectsPolygons(loc, allPolygons)
        );
        setCustomLocationsInPolygon(intersectingLocations);
    }, [allPolygons, customLocations]);

    useEffect(() => {
        if (!map || customLocations.length === 0) return;

        if (customLocationLayerRef.current) {
            map.removeLayer(customLocationLayerRef.current);
            customLocationLayerRef.current = null;
        }

        const source = new VectorSource();

        customLocations.forEach(location => {
            if (location.geometry_area?.coordinates) {
                const coords = location.geometry_area.coordinates[0] as [number, number][];
                const mapCoords = coords.map(([lon, lat]) => fromLonLat([lon, lat]));
                if (mapCoords.length > 0) {
                    mapCoords.push(mapCoords[0]);
                }
                const polygon = new Polygon([mapCoords]);
                const feature = new OLFeature({ geometry: polygon });
                feature.set('custom_location_id', location.id);
                feature.set('custom_location', location);
                feature.setStyle(new Style({
                    fill: new Fill({ color: 'rgba(147, 51, 234, 0.15)' }),
                    stroke: new Stroke({ color: '#9333ea', width: 2, lineDash: [6, 4] }),
                }));
                source.addFeature(feature);
            }
        });

        const layer = new VectorLayer({
            source,
            zIndex: 50,
        });

        map.addLayer(layer);
        customLocationLayerRef.current = layer;

        return () => {
            if (customLocationLayerRef.current) {
                map.removeLayer(customLocationLayerRef.current);
                customLocationLayerRef.current = null;
            }
        };
    }, [map, customLocations]);

    return {
        customLocations,
        customLocationsInPolygon,
        setCustomLocationsInPolygon
    };
};

const usePylovoLayers = ({ map, editMode, loadedConfig }: { map: OLMap | null, editMode: boolean, loadedConfig: any }) => {
    const [pylovoGridData, setPylovoGridData] = useState<PylovoGridData | undefined>(undefined);
    const pylovoLayersRef = useRef<VectorLayer<VectorSource>[]>([]);
    const [isRunningPowerFlow, setIsRunningPowerFlow] = useState(false);
    const [powerFlowResults, setPowerFlowResults] = useState<Map<number, any>>(new Map());
    const [regionBoundary, setRegionBoundary] = useState<{ name: string; boundary: GeoJSON.Feature } | null>(null);
    const [showBoundary, setShowBoundary] = useState(true);
    const boundaryLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
    const availableBoundaryLayersRef = useRef<VectorLayer<VectorSource>[]>([]);
    const [availableRegions, setAvailableRegions] = useState<Array<{ name: string; gridCount: number; country?: string; countryCode?: string; stateCode?: string; has3d?: boolean; bbox?: { west: number; south: number; east: number; north: number } }>>([]);
    const [availableBoundaryGeoJSON, setAvailableBoundaryGeoJSON] = useState<GeoJSON.FeatureCollection | undefined>(undefined);
    const unmountedRef = useRef(false);

    // Fetch available regions (regions with generated grids) and display boundaries on map
    useEffect(() => {
        if (!map || !showBoundary) {
            setAvailableBoundaryGeoJSON(undefined);
            return;
        }

        const loadAvailableRegions = async () => {
            try {
                const response = await pylovoService.getAvailableRegions();

                if (response.status !== 'success' || !response.regions?.length) {
                    setAvailableRegions([]);
                    setAvailableBoundaryGeoJSON(undefined);
                    availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer));
                    availableBoundaryLayersRef.current = [];
                    return;
                }

                // Store regions for legend
                const regionsForLegend = response.regions
                    .filter(r => r.region?.name)
                    .map(r => ({
                        name: r.region!.name,
                        gridCount: r.grid_count,
                        country: r.region?.country,
                        countryCode: r.region?.country_code || r.country_code,
                        stateCode: r.region?.state_code || r.state_code,
                        has3d: r.has_3d || false,
                        bbox: r.bbox
                    }));
                setAvailableRegions(regionsForLegend);

                // Clear any existing available boundary layers
                availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer));
                availableBoundaryLayersRef.current = [];

                // Collect all regions with valid boundaries
                const boundaryRegions = response.regions
                    .filter(r => r.boundary && r.region?.name)
                    .map(r => ({
                        boundary: r.boundary!,
                        name: r.region!.name,
                        gridCount: r.grid_count,
                        countryCode: r.region?.country_code || r.country_code,
                        stateCode: r.region?.state_code || r.state_code,
                    }));

                const boundaryFeatures = boundaryRegions.map((region) => ({
                    ...region.boundary,
                    properties: {
                        ...(region.boundary.properties ?? {}),
                        name: region.name,
                        grid_count: region.gridCount,
                        _boundary_role: 'available',
                    },
                }));
                setAvailableBoundaryGeoJSON(
                    boundaryFeatures.length > 0
                        ? { type: 'FeatureCollection', features: boundaryFeatures }
                        : undefined
                );

                // Add all boundary layers at once
                if (boundaryRegions.length > 0) {
                    availableBoundaryLayersRef.current = loadAvailableBoundaryLayers(map, boundaryRegions);
                }
            } catch (err) {
                // Boundary loading is non-critical
                setAvailableBoundaryGeoJSON(undefined);
                availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer));
                availableBoundaryLayersRef.current = [];
            }
        };

        loadAvailableRegions();

        // Cleanup on unmount
        return () => {
            availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer));
            availableBoundaryLayersRef.current = [];
        };
    }, [map, showBoundary]);

    // Fetch boundary based on grid buildings centroid (called once after grid generation)
    const fetchBoundaryForGrid = useCallback(async (buildings: GeoJSON.FeatureCollection) => {
        if (!map || !showBoundary) return;

        // Calculate centroid of all buildings
        const coords: [number, number][] = [];
        buildings.features.forEach(feature => {
            if (feature.geometry.type === 'Point') {
                coords.push(feature.geometry.coordinates as [number, number]);
            } else if (feature.geometry.type === 'Polygon') {
                // Use first coordinate of polygon
                const polyCoords = feature.geometry.coordinates[0];
                if (polyCoords && polyCoords.length > 0) {
                    coords.push(polyCoords[0] as [number, number]);
                }
            }
        });

        if (coords.length === 0) return;

        // Calculate average (centroid)
        const sumLon = coords.reduce((acc, c) => acc + c[0], 0);
        const sumLat = coords.reduce((acc, c) => acc + c[1], 0);
        const lon = sumLon / coords.length;
        const lat = sumLat / coords.length;

        try {
            const boundaryResponse = await pylovoService.getBoundary(lat, lon, 4);

            if (boundaryResponse.status === 'success' && boundaryResponse.boundary && boundaryResponse.region) {
                setRegionBoundary({
                    name: boundaryResponse.region.name,
                    boundary: boundaryResponse.boundary
                });

                // Add boundary layer to map
                if (map) {
                    boundaryLayerRef.current = loadBoundaryLayer(
                        map,
                        boundaryResponse.boundary,
                        boundaryResponse.region.name
                    );
                }
            }
        } catch (err) {
            // Boundary fetching is non-critical
        }
    }, [map, showBoundary]);

    // Helper to create a vector layer from GeoJSON data
    const createPylovoLayer = (
        geojson: any,
        featureType: string,
        zIndex: number,
        styleFunc: (f: Feature<Geometry>) => void,
        transformerColorMap?: Map<number, number>
    ): VectorLayer<VectorSource> | null => {
        if (!map || !geojson?.features?.length) return null;
        const source = new VectorSource();
        const format = new GeoJSON();
        const dataProjection = getDataProjection(geojson);
        const features = format.readFeatures(geojson, {
            dataProjection,
            featureProjection: map.getView().getProjection()
        });
        features.forEach((f: Feature<Geometry>) => {
            f.set('feature_type', featureType);
            if (transformerColorMap) setFeatureColorIndex(f, transformerColorMap);
            styleFunc(f);
        });
        source.addFeatures(features);
        const layer = new VectorLayer({ source, zIndex });
        map.addLayer(layer);
        return layer;
    };



    // Run power flow analysis and apply loading percentages to lines and transformers
    const runPowerFlowAnalysis = useCallback(async (loadScaling: number = 1): Promise<boolean> => {
        // Extract grid_result_ids and building osm_ids from buildings in the polygon
        const gridResultIds = new Set<number>();
        const buildingsByGrid = new Map<number, string[]>(); // grid_result_id -> [osm_id, ...]

        // Try grids array first
        if (pylovoGridData?.grids && Array.isArray(pylovoGridData.grids)) {
            (pylovoGridData.grids as Array<{ grid_result_id?: number }>).forEach(g => {
                const gid = toFiniteNumber(g.grid_result_id);
                if (gid !== null) {
                    gridResultIds.add(gid);
                }
            });
        }

        // Also extract from transformers
        if (pylovoGridData?.transformers?.features) {
            pylovoGridData.transformers.features.forEach((f: any) => {
                const gid = toFiniteNumber(
                    f.properties?.grid_result_id ??
                    f.properties?.transformer_id ??
                    f.properties?.trafo_id
                );
                if (gid !== null) {
                    gridResultIds.add(gid);
                }
            });
        }

        // Extract from buildings - collect osm_ids grouped by grid_result_id
        if (pylovoGridData?.buildings?.features) {
            pylovoGridData.buildings.features.forEach((f: any) => {
                const gid = toFiniteNumber(
                    f.properties?.grid_result_id ??
                    f.properties?.transformer_id ??
                    f.properties?.trafo_id
                );
                const osmId = f.properties?.osm_id;
                if (gid !== null) {
                    gridResultIds.add(gid);
                    if (osmId) {
                        const existing = buildingsByGrid.get(gid) || [];
                        existing.push(String(osmId));
                        buildingsByGrid.set(gid, existing);
                    }
                }
            });
        }

        if (gridResultIds.size === 0) {
            return false;
        }
        setIsRunningPowerFlow(true);
        const results = new Map<number, any>();

        try {
            const uniqueGridIds = Array.from(gridResultIds);

            // Run power flow for each grid
	            const nonConvergedGrids: { id: number; ratio: number }[] = [];
            for (const gridResultId of uniqueGridIds) {
                try {
                    // Pass only the building OSM IDs that are in the current polygon
                    const buildingOsmIds = buildingsByGrid.get(gridResultId);
                    const pfResult = await pylovoService.runPowerFlow(gridResultId, loadScaling, buildingOsmIds);
                    if (pfResult.converged) {
                        results.set(gridResultId, pfResult);
                    } else {
                        const ratio = pfResult.network_info?.load_to_capacity_ratio;
                        nonConvergedGrids.push({ id: gridResultId, ratio: ratio || 0 });
                        // Still add non-converged results if they have estimated line data
                        if ((pfResult.results?.lines?.length ?? 0) > 0) {
                            results.set(gridResultId, pfResult);
                        }
                    }
                } catch (error) {
                    console.error(`Power flow failed for grid ${gridResultId}:`, error);
                }
            }

            // Show warning if any grids didn't converge
            setPowerFlowResults(results);

            // Apply loading percentages to line features
            let matchedLines = 0;
            let totalLines = 0;
            let debugLogged = false;
            pylovoLayersRef.current.forEach(layer => {
                const source = layer.getSource();
                if (!source) return;

                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    const featureType = f.get('feature_type');
                    const gridResultId = toFiniteNumber(
                        f.get('grid_result_id') ??
                        f.get('transformer_id') ??
                        f.get('trafo_id')
                    );
                    if (gridResultId === null) return;
                    const pfResult = results.get(gridResultId);

                    if (!pfResult) return;

                    if (featureType === 'cable' || featureType === 'line') {
                        totalLines++;
                        // Find matching line result by multiple possible identifiers
                        const lineId = f.get('line_id') ?? f.get('lines_result_id') ?? f.get('id');
                        const lineName = f.get('line_name') ?? f.get('name');

                        const lineResult = pfResult.results?.lines?.find(
                            (l: any) => l.line_id === lineId ||
                                        l.lines_result_id === lineId ||
                                        l.name === lineName ||
                                        l.line_name === lineName
                        );
                        if (lineResult) {
                            matchedLines++;
                            f.set('loading_percent', lineResult.loading_percent);
                            f.set('i_ka', lineResult.i_ka);
                            f.set('p_from_mw', lineResult.p_from_mw);
                            f.set('p_to_mw', lineResult.p_to_mw);
                        } else if (!debugLogged) {
                            debugLogged = true;
                        }
                    } else if (featureType === 'transformer') {
                        // Find matching transformer result
                        const trafoId = toFiniteNumber(f.get('trafo_id') ?? f.get('id'));
                        const featureName = f.get('name');
                        const trafoResult = pfResult.results?.transformers?.find(
                            (t: any) => {
                                const resultTrafoId = toFiniteNumber(t.trafo_id ?? t.id);
                                return (
                                    (trafoId !== null && resultTrafoId !== null && resultTrafoId === trafoId) ||
                                    (featureName && t.name === featureName)
                                );
                            }
                        );
                        if (trafoResult) {
                            f.set('loading_percent', trafoResult.loading_percent);
                            f.set('current_load_kw', trafoResult.p_lv_mw * 1000);
                            f.set('i_lv_ka', trafoResult.i_lv_ka);
                        }
                    }
                });

                // Trigger layer refresh to update styles
                source.changed();
            });

            // Sync power-flow attributes back into GeoJSON used by MapLibre 3D layers.
            // OL layers are updated above, but 3D uses pylovoGridData sources directly.
            setPylovoGridData((prev) => {
                if (!prev) return prev;

                let hasChanges = false;

                const updatedLineFeatures = prev.lines?.features?.map((feature: any) => {
                    const props = (feature?.properties ?? {}) as Record<string, unknown>;
                    const gridResultId = toFiniteNumber(
                        props.grid_result_id ?? props.transformer_id ?? props.trafo_id
                    );
                    if (gridResultId === null) return feature;

                    const pfResult = results.get(gridResultId);
                    if (!pfResult) return feature;

                    const lineId = props.line_id ?? props.lines_result_id ?? props.id;
                    const lineIdNum = toFiniteNumber(lineId);
                    const lineName = props.line_name ?? props.name;

                    const lineResult = pfResult.results?.lines?.find((l: any) => {
                        const resultLineIdNum = toFiniteNumber(l.line_id ?? l.lines_result_id ?? l.id);
                        return (
                            (lineIdNum !== null && resultLineIdNum !== null && resultLineIdNum === lineIdNum) ||
                            (lineName !== undefined && lineName !== null && String(l.name ?? l.line_name ?? '') === String(lineName))
                        );
                    });

                    if (!lineResult) return feature;

                    const currentLoading = toFiniteNumber(props.loading_percent);
                    const nextLoading = toFiniteNumber(lineResult.loading_percent);
                    if (
                        currentLoading === nextLoading &&
                        props.i_ka === lineResult.i_ka &&
                        props.p_from_mw === lineResult.p_from_mw &&
                        props.p_to_mw === lineResult.p_to_mw
                    ) {
                        return feature;
                    }

                    hasChanges = true;
                    return {
                        ...feature,
                        properties: {
                            ...props,
                            loading_percent: lineResult.loading_percent,
                            i_ka: lineResult.i_ka,
                            p_from_mw: lineResult.p_from_mw,
                            p_to_mw: lineResult.p_to_mw,
                        },
                    };
                });

                const updatedTransformerFeatures = prev.transformers?.features?.map((feature: any) => {
                    const props = (feature?.properties ?? {}) as Record<string, unknown>;
                    const gridResultId = toFiniteNumber(
                        props.grid_result_id ?? props.transformer_id ?? props.trafo_id
                    );
                    if (gridResultId === null) return feature;

                    const pfResult = results.get(gridResultId);
                    if (!pfResult) return feature;

                    const trafoId = toFiniteNumber(props.trafo_id ?? props.id);
                    const featureName = props.name;

                    const trafoResult = pfResult.results?.transformers?.find((t: any) => {
                        const resultTrafoId = toFiniteNumber(t.trafo_id ?? t.id);
                        return (
                            (trafoId !== null && resultTrafoId !== null && resultTrafoId === trafoId) ||
                            (featureName !== undefined && featureName !== null && String(t.name ?? '') === String(featureName))
                        );
                    });

                    if (!trafoResult) return feature;

                    const currentLoading = toFiniteNumber(props.loading_percent);
                    const nextLoading = toFiniteNumber(trafoResult.loading_percent);
                    const nextLoadKw = (toFiniteNumber(trafoResult.p_lv_mw) ?? 0) * 1000;
                    if (
                        currentLoading === nextLoading &&
                        toFiniteNumber(props.current_load_kw) === nextLoadKw &&
                        props.i_lv_ka === trafoResult.i_lv_ka
                    ) {
                        return feature;
                    }

                    hasChanges = true;
                    return {
                        ...feature,
                        properties: {
                            ...props,
                            loading_percent: trafoResult.loading_percent,
                            current_load_kw: nextLoadKw,
                            i_lv_ka: trafoResult.i_lv_ka,
                        },
                    };
                });

                if (!hasChanges) return prev;

                return {
                    ...prev,
                    ...(updatedLineFeatures ? { lines: { ...prev.lines!, features: updatedLineFeatures } } : {}),
                    ...(updatedTransformerFeatures ? { transformers: { ...prev.transformers!, features: updatedTransformerFeatures } } : {}),
                };
            });

            return true;
        } catch (error) {
            return false;
        } finally {
            setIsRunningPowerFlow(false);
        }
    }, [pylovoGridData]);

    const processPylovoData = useCallback(async (data: PylovoGridData) => {
        if (!map || unmountedRef.current) {
            return;
        }

        const normalizedData = normalizeGridLineAssignments(data);

        setPylovoGridData(normalizedData);
        // Clear stale power flow results when grid data changes
        setPowerFlowResults(new Map());
        // Reset the auto-run key so power flow re-triggers for new grid data
        lastGridDataRef.current = '';
        pendingGridDataRef.current = '';
        if (powerFlowTimerRef.current) {
            clearTimeout(powerFlowTimerRef.current);
            powerFlowTimerRef.current = null;
        }

        pylovoLayersRef.current.forEach(layer => map.removeLayer(layer));
        pylovoLayersRef.current = [];

        // Collect all transformer IDs from buildings and lines
        const buildingIds = normalizedData.buildings?.features ? collectTransformerIds(normalizedData.buildings.features) : new Set<number>();
        const lineIds = normalizedData.lines?.features ? collectTransformerIds(normalizedData.lines.features) : new Set<number>();
        const transformerIds = new Set([...buildingIds, ...lineIds]);

        const uniqueTransformerIds = Array.from(transformerIds).sort((a, b) => a - b);
        const transformerColorMap = new Map<number, number>();
        uniqueTransformerIds.forEach((id, index) => {
            transformerColorMap.set(id, index);
        });

        // Create building layer (special handling for AI estimates and parsed_class)
        const buildingLayer = createPylovoLayer(
            normalizedData.buildings,
            'building',
            100,
            (f) => {
                const parsedClass = parsePoiClass(f);
                f.set('parsed_class', parsedClass);
                f.setStyle(createBuildingStyleFunction(true, false));
            },
            transformerColorMap
        );
        if (buildingLayer) {
            pylovoLayersRef.current.push(buildingLayer);
        }

        // Create cable layer with layer-level style function for dynamic styling
        if (normalizedData.lines?.features?.length && map) {
            const lineSource = new VectorSource();
            const format = new GeoJSON();
            const dataProjection = getDataProjection(normalizedData.lines);
            const features = format.readFeatures(normalizedData.lines, {
                dataProjection,
                featureProjection: map.getView().getProjection()
            });
            features.forEach((f: Feature<Geometry>) => {
                f.set('feature_type', 'cable');
                setFeatureColorIndex(f, transformerColorMap);
            });
            lineSource.addFeatures(features);
            const lineLayer = new VectorLayer({
                source: lineSource,
                style: (feature) => cableStyleFunction(feature as Feature<Geometry>),
                zIndex: 99
            });
            map.addLayer(lineLayer);
            pylovoLayersRef.current.push(lineLayer);
        }

        // Create MV line layer with layer-level style function
        if (normalizedData.mv_lines?.features?.length && map) {
            const mvLineSource = new VectorSource();
            const format = new GeoJSON();
            const dataProjection = getDataProjection(normalizedData.mv_lines);
            const features = format.readFeatures(normalizedData.mv_lines, {
                dataProjection,
                featureProjection: map.getView().getProjection()
            });
            features.forEach((f: Feature<Geometry>) => {
                f.set('feature_type', 'mv_line');
            });
            mvLineSource.addFeatures(features);
            const mvLineLayer = new VectorLayer({
                source: mvLineSource,
                style: (feature) => mvLineStyleFunction(feature as Feature<Geometry>),
                zIndex: 98
            });
            map.addLayer(mvLineLayer);
            pylovoLayersRef.current.push(mvLineLayer);
        }

        // Create transformer layer with layer-level style function for resolution-based labels
        if (normalizedData.transformers?.features?.length && map) {
            const transformerSource = new VectorSource();
            const format = new GeoJSON();
            const dataProjection = getDataProjection(normalizedData.transformers);
            const features = format.readFeatures(normalizedData.transformers, {
                dataProjection,
                featureProjection: map.getView().getProjection()
            });
            features.forEach((f: Feature<Geometry>) => {
                f.set('feature_type', 'transformer');
                setFeatureColorIndex(f, transformerColorMap);
            });
            transformerSource.addFeatures(features);
            const trafoLayer = new VectorLayer({
                source: transformerSource,
                style: (feature, resolution) => transformerStyleFunction(feature as Feature<Geometry>, resolution),
                zIndex: 102
            });
            map.addLayer(trafoLayer);
            pylovoLayersRef.current.push(trafoLayer);
        }

        // Note: Boundary is now handled by fetchBoundaryForGrid after grid generation
        // It stays fixed to the region where the grid was generated

        // Fetch boundary for the generated grid (based on building centroid)
        if (showBoundary && normalizedData.buildings?.features?.length) {
            fetchBoundaryForGrid(normalizedData.buildings as GeoJSON.FeatureCollection);
        }

    }, [map, showBoundary, fetchBoundaryForGrid]);

    // Auto-run power flow when grid data changes and has buildings
    const lastGridDataRef = useRef<string>('');
    const pendingGridDataRef = useRef<string>('');
    const powerFlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const hasBuildings = (pylovoGridData?.buildings?.features?.length ?? 0) > 0;
        const buildingIds = pylovoGridData?.buildings?.features
            ?.map((f: any) => f.properties?.osm_id)
            .filter(Boolean)
            .sort() || [];
        const transformerIds = pylovoGridData?.transformers?.features
            ?.map((f: any) => {
                const props = f?.properties ?? {};
                const gid = toFiniteNumber(props.grid_result_id ?? props.transformer_id ?? props.trafo_id);
                const kva = toFiniteNumber(props.rated_power_kva);
                return gid !== null ? `${gid}:${kva ?? ''}` : null;
            })
            .filter(Boolean)
            .sort() || [];
        const dataKey = JSON.stringify({
            grids: pylovoGridData?.grids || [],
            buildings: buildingIds,
            transformers: transformerIds,
        });

        if (!hasBuildings) {
            if (powerFlowTimerRef.current) {
                clearTimeout(powerFlowTimerRef.current);
                powerFlowTimerRef.current = null;
            }
            pendingGridDataRef.current = '';
            return;
        }

        // Skip if already processed or already queued.
        if (dataKey === lastGridDataRef.current || dataKey === pendingGridDataRef.current) {
            return;
        }

        // Debounce to avoid multiple rapid calls during polygon edits/data sync updates.
        if (powerFlowTimerRef.current) {
            clearTimeout(powerFlowTimerRef.current);
            powerFlowTimerRef.current = null;
        }

        pendingGridDataRef.current = dataKey;
        powerFlowTimerRef.current = setTimeout(() => {
            const queuedKey = dataKey;
            void (async () => {
                try {
                    const success = await runPowerFlowAnalysis(1);
                    if (success) {
                        lastGridDataRef.current = queuedKey;
                    } else {
                        lastGridDataRef.current = '';
                    }
                } finally {
                    if (pendingGridDataRef.current === queuedKey) {
                        pendingGridDataRef.current = '';
                    }
                    powerFlowTimerRef.current = null;
                }
            })();
        }, 500);
    }, [pylovoGridData, runPowerFlowAnalysis]);

    useEffect(() => {
        return () => {
            if (powerFlowTimerRef.current) {
                clearTimeout(powerFlowTimerRef.current);
                powerFlowTimerRef.current = null;
            }
            pendingGridDataRef.current = '';
        };
    }, []);

    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            if (map) {
                pylovoLayersRef.current.forEach(layer => {
                    try { map.removeLayer(layer); } catch { /* ignore */ }
                });
                pylovoLayersRef.current = [];
                // Clean up boundary layer
                if (boundaryLayerRef.current) {
                    try { map.removeLayer(boundaryLayerRef.current); } catch { /* ignore */ }
                    boundaryLayerRef.current = null;
                }
            }
        };
    }, [map]);

    useEffect(() => {
        if (editMode && loadedConfig) {
            processPylovoData(loadedConfig as PylovoGridData).then(() => {
                // Run power flow once after loading saved model to show cached results
                runPowerFlowAnalysis(1);
            });
        }
    }, [editMode, loadedConfig, processPylovoData]);

    const updateTransformerKva = useCallback((gridResultId: number, newKva: number) => {
        pylovoLayersRef.current.forEach(layer => {
            const source = layer.getSource();
            if (source) {
                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    if (f.get('feature_type') === 'transformer' &&
                        f.get('grid_result_id') === gridResultId) {
                        f.set('rated_power_kva', newKva);
                    }
                });
            }
        });
    }, []);

    const updateBuildingType = useCallback((osmId: string, newType: string) => {
        const normalizedType = normalizeFClass(newType) || newType.trim().toLowerCase() || 'residential';
        pylovoLayersRef.current.forEach(layer => {
            const source = layer.getSource();
            if (source) {
                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    if (f.get('feature_type') === 'building' &&
                        f.get('osm_id') === osmId) {
                        f.set('type', normalizedType);
                        f.set('f_class', normalizedType);
                        f.set('f_classes', [normalizedType]);
                        f.set('parsed_class', normalizedType);
                    }
                });
            }
        });
    }, []);

    const updateBuildingProperty = useCallback((osmId: string, key: string, value: unknown) => {
        pylovoLayersRef.current.forEach(layer => {
            const source = layer.getSource();
            if (source) {
                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    if (f.get('feature_type') === 'building' &&
                        f.get('osm_id') === osmId) {
                        f.set(key, value);
                    }
                });
            }
        });
    }, []);

    const updateBuildingFClassDemand = useCallback((osmId: string, fClass: string, newDemand: number) => {
        pylovoLayersRef.current.forEach(layer => {
            const source = layer.getSource();
            if (source) {
                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    if (f.get('feature_type') === 'building' &&
                        f.get('osm_id') === osmId) {
                        const normalizedFClass = normalizeFClassToken(fClass) || fClass;
                        const props = f.getProperties() as Record<string, unknown>;
                        const classes = getFeatureFClasses(props);
                        if (!classes.includes(normalizedFClass)) {
                            f.set('f_classes', [...classes, normalizedFClass]);
                        }
                        // Get or create fclass details
                        let details: FClassDetail[] = [];
                        const stored = f.get('f_class_demands') ?? f.get('fclass_details');
                        if (stored) {
                            details = buildFClassDetails(
                                getFeatureFClasses(props),
                                extractYearlyDemandKwh(props),
                                extractPeakLoadKw(props),
                                stored,
                            );
                        }
                        if (details.length === 0) {
                            const fClasses = getFeatureFClasses(props);
                            const totalDemand = extractYearlyDemandKwh(props);
                            const totalPeak = extractPeakLoadKw(props);
                            details = buildFClassDetails(
                                fClasses.length > 0 ? fClasses : [getPrimaryFClass(props) || 'unknown'],
                                totalDemand,
                                totalPeak,
                            );
                        }

                        let updated = false;
                        details = details.map((detail) => {
                            const detailClass = normalizeFClassToken(detail.fClass) || detail.fClass;
                            if (detailClass !== normalizedFClass) return detail;
                            updated = true;
                            return { ...detail, fClass: detailClass, yearlyDemandKwh: newDemand };
                        });
                        if (!updated) {
                            details = [
                                ...details,
                                { fClass: normalizedFClass, yearlyDemandKwh: newDemand, peakLoadKw: 0 },
                            ];
                        }

                        const fClassDemands = details.map((detail) => ({
                            f_class: detail.fClass,
                            demand_energy: detail.yearlyDemandKwh,
                            peak_load_kw: detail.peakLoadKw,
                        }));

                        f.set('fclass_details', details);
                        f.set('f_class_demands', fClassDemands);
                        // Update total
                        const newTotal = details.reduce((sum, d) => sum + d.yearlyDemandKwh, 0);
                        f.set('yearly_demand_kwh', newTotal);
                        f.set('demand_energy', newTotal);
                    }
                });
            }
        });
    }, []);

    // Toggle boundary visibility
    const toggleBoundary = useCallback(() => {
        setShowBoundary(prev => {
            const newValue = !prev;
            if (map && boundaryLayerRef.current) {
                boundaryLayerRef.current.setVisible(newValue);
            }
            return newValue;
        });
    }, [map]);

    return {
        pylovoGridData,
        setPylovoGridData,
        pylovoLayersRef,
        processPylovoData,
        updateTransformerKva,
        updateBuildingType,
        updateBuildingProperty,
        updateBuildingFClassDemand,
        // Power flow analysis
        runPowerFlowAnalysis,
        isRunningPowerFlow,
        powerFlowResults,
        // Boundary
        regionBoundary,
        availableBoundaryGeoJSON,
        showBoundary,
        toggleBoundary,
        availableRegions
    };
};

const useTechOperations = ({ map, mapRef, pylovoLayersRef, showSuccess, showError, t }: any) => {
    const [showTechDrawer, setShowTechDrawer] = useState(false);
    const [draggingTech, setDraggingTech] = useState<Technology | null>(null);
    const [highlightedBuilding, setHighlightedBuilding] = useState<Feature<Geometry> | null>(null);
    const [techDialogOpen, setTechDialogOpen] = useState(false);
    const [selectedTechForDialog, setSelectedTechForDialog] = useState<Technology | null>(null);
    const [selectedBuildingForTech, setSelectedBuildingForTech] = useState<Feature<Geometry> | null>(null);
    const [isAddingTechToAll, setIsAddingTechToAll] = useState(false);
    const [appliedTechKeys, setAppliedTechKeys] = useState<string[]>([]);

    const handleTechDragStart = useCallback((tech: Technology) => {
        setDraggingTech(tech);
    }, []);

    const handleTechDragEnd = useCallback(() => {
        setDraggingTech(null);
        setHighlightedBuilding(null);
    }, []);

    const handleMapDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!map || !draggingTech) return;
        try {
            const techData = e.dataTransfer.getData("application/json");
            if (!techData) return;
            const mapElement = mapRef.current;
            if (!mapElement) return;
            const rect = mapElement.getBoundingClientRect();
            const pixel = [e.clientX - rect.left, e.clientY - rect.top];
            const feature = map.forEachFeatureAtPixel(pixel, (f: any) => {
                if (f.get('feature_type') === 'building') return f;
                return null;
            });
            if (feature) {
                setSelectedTechForDialog(draggingTech);
                setSelectedBuildingForTech(feature as Feature<Geometry>);
                setTechDialogOpen(true);
            } else {
                showError(t("gridNotifications.dropOnBuilding"));
            }
        } catch (error) {
            console.error("Error handling tech drop:", error);
        } finally {
            setDraggingTech(null);
            setHighlightedBuilding(null);
        }
    }, [map, draggingTech, mapRef, showError]);

    const handleMapDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!map || !draggingTech) return;
        const mapElement = mapRef.current;
        if (!mapElement) return;
        const rect = mapElement.getBoundingClientRect();
        const pixel = [e.clientX - rect.left, e.clientY - rect.top];
        const feature = map.forEachFeatureAtPixel(pixel, (f: any) => {
            if (f.get('feature_type') === 'building') return f;
            return null;
        });
        if (feature && feature !== highlightedBuilding) {
            if (highlightedBuilding) highlightedBuilding.setStyle(createBuildingStyleFunction(true, false));
            setHighlightedBuilding(feature as Feature<Geometry>);
            (feature as Feature<Geometry>).setStyle(createBuildingHighlightStyleFunction());
        } else if (!feature && highlightedBuilding) {
            highlightedBuilding.setStyle(createBuildingStyleFunction(true, false));
            setHighlightedBuilding(null);
        }
    }, [map, draggingTech, mapRef, highlightedBuilding]);

    const handleSaveTechToBuildingBulk = useCallback((techKey: string, constraints: { key: string; value: number | string }[], applyToAll: boolean = false) => {
        if (!selectedBuildingForTech || !selectedTechForDialog) return;
        if (applyToAll) {
            let count = 0;
            pylovoLayersRef.current.forEach((layer: any) => {
                const source = layer.getSource();
                if (source) {
                    source.getFeatures().forEach((f: Feature<Geometry>) => {
                        if (f.get('feature_type') === 'building') {
                            const existingTechs = f.get("techs") || {};
                            existingTechs[techKey] = {
                                alias: selectedTechForDialog.alias,
                                icon: selectedTechForDialog.icon,
                                constraints,
                            };
                            f.set("techs", existingTechs);
                            f.setStyle(createBuildingStyleFunction(true, false));
                            count++;
                        }
                    });
                }
            });
            setAppliedTechKeys(prev => prev.includes(techKey) ? prev : [...prev, techKey]);
            showSuccess(t("gridNotifications.techAddedToAll", { tech: selectedTechForDialog.alias, count }));
        } else {
            const existingTechs = selectedBuildingForTech.get("techs") || {};
            existingTechs[techKey] = {
                alias: selectedTechForDialog.alias,
                icon: selectedTechForDialog.icon,
                constraints,
            };
            selectedBuildingForTech.set("techs", existingTechs);
            selectedBuildingForTech.setStyle(createBuildingStyleFunction(true, false));
            showSuccess(t("gridNotifications.techAddedToBuilding", { tech: selectedTechForDialog.alias }));
        }
        setTechDialogOpen(false);
        setSelectedTechForDialog(null);
        setSelectedBuildingForTech(null);
    }, [selectedBuildingForTech, selectedTechForDialog, showSuccess, pylovoLayersRef, t]);

    const handleAddTechToAll = useCallback((tech: Technology) => {
        setSelectedTechForDialog(tech);
        setIsAddingTechToAll(true);

        // Find first building in layers
        const findFirstBuilding = (): Feature<Geometry> | null => {
            for (const layer of pylovoLayersRef.current) {
                const source = layer.getSource();
                if (!source) continue;
                const building = source.getFeatures().find((f: Feature<Geometry>) => f.get('feature_type') === 'building');
                if (building) return building as Feature<Geometry>;
            }
            return null;
        };

        const firstBuilding = findFirstBuilding();
        if (firstBuilding) {
            setSelectedBuildingForTech(firstBuilding);
            setTechDialogOpen(true);
        } else {
            showError(t("gridNotifications.noBuildingsFound"));
            setIsAddingTechToAll(false);
        }
    }, [showError, pylovoLayersRef, t]);

    const handleRemoveTechFromAll = useCallback((tech: Technology) => {
        let count = 0;
        pylovoLayersRef.current.forEach((layer: any) => {
            const source = layer.getSource();
            if (source) {
                source.getFeatures().forEach((f: Feature<Geometry>) => {
                    if (f.get('feature_type') === 'building') {
                        const existingTechs = f.get("techs") || {};
                        if (existingTechs[tech.key]) {
                            delete existingTechs[tech.key];
                            f.set("techs", existingTechs);
                            f.setStyle(createBuildingStyleFunction(true, false));
                            count++;
                        }
                    }
                });
            }
        });
        setAppliedTechKeys(prev => prev.filter(key => key !== tech.key));
        showSuccess(t("gridNotifications.techRemovedFromAll", { tech: tech.alias, count }));
    }, [showSuccess, pylovoLayersRef, t]);

    const getAppliedTechKeys = useCallback((): string[] => {
        const techCounts: Record<string, number> = {};
        let buildingCount = 0;

        const allBuildings = collectBuildingsFromLayers(pylovoLayersRef.current);
        for (const f of allBuildings) {
            buildingCount++;
            const techs = f.get("techs") || {};
            for (const key of Object.keys(techs)) {
                techCounts[key] = (techCounts[key] || 0) + 1;
            }
        }

        return Object.entries(techCounts)
            .filter(([, count]) => count === buildingCount && buildingCount > 0)
            .map(([key]) => key);
    }, [pylovoLayersRef]);

    useEffect(() => {
        if (showTechDrawer) setAppliedTechKeys(getAppliedTechKeys());
    }, [showTechDrawer, getAppliedTechKeys]);

    const handleEditTechFromDialog = useCallback(async (techKey: string, buildingFeature: Feature<Geometry>) => {
        try {
            const techs = await import("@/features/technologies/services/technologyService").then(m => m.default.getAll());
            const tech = techs.find((t: Technology) => t.key === techKey);
            if (tech) {
                setSelectedTechForDialog(tech);
                setSelectedBuildingForTech(buildingFeature);
                setTechDialogOpen(true);
            } else {
                showError(t("gridNotifications.techNotFound", { tech: techKey }));
            }
        } catch {
            showError(t("gridNotifications.techLoadFailed"));
        }
    }, [showError, t]);

    const handleRemoveTechFromDialog = useCallback((techKey: string, buildingFeature: Feature<Geometry>) => {
        const currentTechs = buildingFeature.get("techs") || {};
        const existingTechs = { ...currentTechs };
        const techAlias = existingTechs[techKey]?.alias || techKey;
        delete existingTechs[techKey];
        buildingFeature.set("techs", existingTechs);
        buildingFeature.setStyle(createBuildingStyleFunction(true, false));
        showSuccess(t("gridNotifications.techRemovedFromBuilding", { tech: techAlias }));
        return existingTechs;
    }, [showSuccess, t]);

    return {
        showTechDrawer, setShowTechDrawer, draggingTech, handleTechDragStart, handleTechDragEnd,
        handleMapDrop, handleMapDragOver, techDialogOpen, setTechDialogOpen,
        selectedTechForDialog, selectedBuildingForTech, setSelectedBuildingForTech,
        handleSaveTechToBuildingBulk, isAddingTechToAll, setIsAddingTechToAll,
        handleAddTechToAll, handleRemoveTechFromAll, appliedTechKeys,
        handleEditTechFromDialog, handleRemoveTechFromDialog, setSelectedTechForDialog
    };
};

// Helper to create transformer tooltip data
const createTransformerTooltip = (
    feature: any,
    pixel: number[],
    layers: VectorLayer<VectorSource>[]
): any => {
    const numId = extractTransformerId(feature.getProperties());
    const { count, types } = countConnectedBuildings(numId, layers);

    return {
        x: pixel[0],
        y: pixel[1],
        ratedPowerKva: feature.get('rated_power_kva') || 0,
        gridResultId: feature.get('grid_result_id'),
        connectedBuildingCount: count,
        connectedBuildingTypes: types,
    };
};

// Helper to create building tooltip data
const createBuildingTooltip = (feature: any, pixel: number[]): any => ({
    ...((): { type: string; fClass?: string; fClasses: string[] } => {
        const props = feature.getProperties() as Record<string, unknown>;
        const fClasses = getFeatureFClasses(props);
        const primary = getPrimaryFClass(props) || 'unknown';
        return {
            type: primary,
            fClass: primary,
            fClasses,
        };
    })(),
    x: pixel[0],
    y: pixel[1],
    yearlyDemandKwh: extractYearlyDemandKwh(feature.getProperties() as Record<string, unknown>),
    techs: feature.get('techs') || {},
    gridResultId: feature.get('grid_result_id') ?? feature.get('transformer_id'),
    selectedFClass: extractSelectedFClass(
        feature.getProperties() as Record<string, unknown>,
        getFeatureFClasses(feature.getProperties() as Record<string, unknown>),
        getPrimaryFClass(feature.getProperties() as Record<string, unknown>) || 'unknown',
    ),
    ...extractBuildingEnrichment(feature.getProperties() as Record<string, unknown>),
});

// Helper to create MV line tooltip data
const createMvLineTooltip = (feature: any, pixel: number[]): any => ({
    x: pixel[0],
    y: pixel[1],
    voltage: feature.get('voltage') || (feature.get('vn_kv') ? `${feature.get('vn_kv')} kV` : '20 kV'),
    lengthM: feature.get('length_m') || feature.get('length') || 0,
    cableType: feature.get('cable_type') || feature.get('std_type') || '',
    normallyOpen: feature.get('normally_open') || false,
    fromBus: feature.get('from_bus') || feature.get('from_node') || '',
    toBus: feature.get('to_bus') || feature.get('to_node') || '',
});

const useMapInteractions = ({
    map,
    isDrawing,
    pylovoLayersRef,
    suppressDialogOnClick = false,
    suppressMapInteractions = false
}: {
    map: OLMap | null;
    isDrawing: boolean;
    pylovoLayersRef: React.RefObject<VectorLayer<VectorSource>[]>;
    suppressDialogOnClick?: boolean;
    suppressMapInteractions?: boolean;
}) => {
    const [transformerDialogOpen, setTransformerDialogOpen] = useState(false);
    const [selectedTransformer, setSelectedTransformer] = useState<any>(null);
    const [transformerTooltip, setTransformerTooltip] = useState<any>(null);
    const [buildingDialogOpen, setBuildingDialogOpen] = useState(false);
    const [selectedBuilding, setSelectedBuilding] = useState<any>(null);
    const [selectedBuildingFeature, setSelectedBuildingFeature] = useState<Feature<Geometry> | null>(null);
    const [buildingTooltip, setBuildingTooltip] = useState<any>(null);
    const [mvLineTooltip, setMvLineTooltip] = useState<any>(null);
    const [hoveredTransformerId, setHoveredTransformerId] = useState<number | null>(null);

    const highlightedBuildingsRef = useRef<Feature<Geometry>[]>([]);

    // Highlight buildings connected to hovered transformer
    useEffect(() => {
        if (!map || !pylovoLayersRef.current.length) return;

        // Reset previously highlighted buildings
        highlightedBuildingsRef.current.forEach(f => f.setStyle(createBuildingStyleFunction(true, false)));
        highlightedBuildingsRef.current = [];

        if (hoveredTransformerId === null) return;

        const buildingLayer = findBuildingLayer(pylovoLayersRef.current);
        const buildingSource = buildingLayer?.getSource();
        if (!buildingSource) return;

        highlightConnectedBuildings(
            buildingSource,
            hoveredTransformerId,
            highlightedBuildingsRef,
            (feature) => feature.setStyle(createBuildingHighlightStyleFunction()),
        );
    }, [map, hoveredTransformerId, pylovoLayersRef]);

    useEffect(() => {
        if (!map) return;
        if (suppressMapInteractions) {
            setHoveredTransformerId(null);
            setTransformerTooltip(null);
            setBuildingTooltip(null);
            setMvLineTooltip(null);
            return;
        }
        const handleClick = (evt: any) => {
            if (isDrawing || suppressDialogOnClick) return;
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => {
                const type = f.get('feature_type');
                if (type === 'transformer' || type === 'building') return f;
                return null;
            });
            if (feature) {
                const type = feature.get('feature_type');
                if (type === 'transformer') {
                    setSelectedTransformer({
                        gridResultId: feature.get('grid_result_id'),
                        osmId: feature.get('osm_id') || '',
                        ratedPowerKva: feature.get('rated_power_kva') || 0,
                    });
                    setTransformerDialogOpen(true);
                } else if (type === 'building') {
                    const props = feature.getProperties() as Record<string, unknown>;
                    const fClasses = getFeatureFClasses(props);
                    const primaryFClass = getPrimaryFClass(props) || 'unknown';
                    const enrichment = extractBuildingEnrichment(props);
                    const totalDemand = extractYearlyDemandKwh(props);
                    const totalPeak = extractPeakLoadKw(props);
                    const effectiveFClasses = fClasses.length > 0 ? fClasses : [primaryFClass];
                    const fClassDetails = buildFClassDetails(
                        effectiveFClasses,
                        totalDemand,
                        totalPeak,
                        props.f_class_demands ?? props.fclass_details,
                    );
                    setSelectedBuilding({
                        osmId: feature.get('osm_id'),
                        type: primaryFClass,
                        fClass: primaryFClass,
                        fClasses,
                        selectedFClass: extractSelectedFClass(props, effectiveFClasses, primaryFClass),
                        yearlyDemandKwh: totalDemand,
                        peakLoadKw: totalPeak,
                        area: feature.get('area') || 0,
                        gridResultId: feature.get('grid_result_id'),
                        techs: feature.get('techs') || {},
                        fClassDetails,
                        ...enrichment,
                    });
                    setSelectedBuildingFeature(feature as Feature<Geometry>);
                    setBuildingDialogOpen(true);
                }
            }
        };
        map.on('click', handleClick);
        const clearAllTooltips = () => {
            setHoveredTransformerId(null);
            setTransformerTooltip(null);
            setBuildingTooltip(null);
            setMvLineTooltip(null);
        };

        const handlePointerMove = (evt: any) => {
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => {
                const type = f.get('feature_type');
                if (type === 'transformer' || type === 'building' || type === 'mv_line') return f;
                return null;
            }, { hitTolerance: 5 });

            if (!feature) {
                map.getTargetElement().style.cursor = '';
                clearAllTooltips();
                return;
            }

            map.getTargetElement().style.cursor = 'pointer';
            const type = feature.get('feature_type');

            if (type === 'transformer') {
                const gridResultId = feature.get('grid_result_id');
                const numId = extractTransformerId({ grid_result_id: gridResultId });
                setHoveredTransformerId(numId);
                setTransformerTooltip(createTransformerTooltip(feature, evt.pixel, pylovoLayersRef.current));
                setBuildingTooltip(null);
                setMvLineTooltip(null);
            } else if (type === 'building') {
                setHoveredTransformerId(null);
                setBuildingTooltip(createBuildingTooltip(feature, evt.pixel));
                setTransformerTooltip(null);
                setMvLineTooltip(null);
            } else if (type === 'mv_line') {
                setHoveredTransformerId(null);
                setMvLineTooltip(createMvLineTooltip(feature, evt.pixel));
                setTransformerTooltip(null);
                setBuildingTooltip(null);
            }
        };
        map.on('pointermove', handlePointerMove);
        return () => {
            map.un('click', handleClick);
            map.un('pointermove', handlePointerMove);
        };
    }, [map, isDrawing, suppressDialogOnClick, suppressMapInteractions]);

    const handleCloseTransformerDialog = useCallback(() => {
        setTransformerDialogOpen(false);
        setSelectedTransformer(null);
    }, []);

    const handleCloseBuildingDialog = useCallback(() => {
        setBuildingDialogOpen(false);
        setSelectedBuilding(null);
        setSelectedBuildingFeature(null);
    }, []);

    return {
        transformerDialogOpen, setTransformerDialogOpen, selectedTransformer, setSelectedTransformer,
        transformerTooltip, setTransformerTooltip, buildingDialogOpen, setBuildingDialogOpen,
        selectedBuilding, setSelectedBuilding, selectedBuildingFeature, setSelectedBuildingFeature,
        buildingTooltip, setBuildingTooltip, mvLineTooltip, setMvLineTooltip,
        handleCloseTransformerDialog, handleCloseBuildingDialog
    };
};

export const useAreaSelect = ({
	onAreaSelected,
	onCancel,
	editMode = false,
	existingModelId,
	buildingLimit = 0,
	suppressDialogOnClick = false,
	draftId,
}: UseAreaSelectProps & { buildingLimit?: number }) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const params = useParams();
	const modelId = editMode ? (existingModelId || Number.parseInt(params.id || '0', 10)) : undefined;

	const createModelMutation = useCreateModelMutation();
	const updateModelMutation = useUpdateModelMutation2();
    const { notification, showSuccess, showError, hide } = useNotification();
    const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);

	const [modelName, setModelName] = useState<string>("");
	const [fromDate, setFromDate] = useState<string>("");
	const [toDate, setToDate] = useState<string>("");
	const [resolution, setResolution] = useState<number>(DEFAULT_RESOLUTION);
	const [isSaving, setIsSaving] = useState(false);
	const [isLoadingModel, setIsLoadingModel] = useState(false);
    const [isGeneratingGrid, setIsGeneratingGrid] = useState(false);
	const [showAreaSelectTour, setShowAreaSelectTour] = useState(false);
	const [loadedCoordinates, setLoadedCoordinates] = useState<[number, number][][]>();
	const [loadedConfig, setLoadedConfig] = useState<PylovoGridData | undefined>();

    const { map } = useMapStore();
    const { mapRef } = useMapProvider();
    const [allPolygons, setAllPolygons] = useState<[number, number][][]>([]);
    const [showAdvancedParams, setShowAdvancedParams] = useState(false);
    const [advancedParams, setAdvancedParams] = useState(getDefaultAdvancedParameters());
    const [isDrawing, setIsDrawing] = useState(false);
    const [allowMultiplePolygons, setAllowMultiplePolygons] = useState(false);
    const [clearTrigger, setClearTrigger] = useState(0);
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
    const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');

    // Generation counter to invalidate stale async grid responses after Clear All
    const gridGenIdRef = useRef(0);

    // Snapshot of the original model data when editing, used to detect actual changes
    const originalModelRef = useRef<{ title: string; from_date: string; to_date: string; resolution: number; config: any; status: string } | null>(null);

    // Custom building filters
    const [includePublicBuildings, setIncludePublicBuildings] = useState(true);
    const [includePrivateBuildings, setIncludePrivateBuildings] = useState(true);
    const [excludedBuildingIds, setExcludedBuildingIds] = useState<Set<number>>(new Set());

    const customLocationsData = useCustomLocations(map, allPolygons);
    const pylovoLayersData = usePylovoLayers({ map, editMode, loadedConfig });
    const techOperationsData = useTechOperations({
        map, mapRef, pylovoLayersRef: pylovoLayersData.pylovoLayersRef,
        showSuccess, showError, t
    });
    const mapInteractionsData = useMapInteractions({
        map,
        isDrawing,
        pylovoLayersRef: pylovoLayersData.pylovoLayersRef,
        suppressDialogOnClick,
        suppressMapInteractions: isMapLibre3D,
    });

	useEffect(() => {
		loadExistingModelData({
			editMode, modelId,
			setters: {
				setModelName, setResolution, setFromDate, setToDate,
				setLoadedCoordinates, setIsLoadingModel, setLoadedConfig
			},
			originalModelRef
		});
	}, [editMode, modelId]);

    useEffect(() => {
        if (editMode && loadedCoordinates && loadedCoordinates.length > 0) {
            setAllPolygons(loadedCoordinates);
        }
    }, [editMode, loadedCoordinates]);

	useEffect(() => {
		checkAndShowAreaSelectTour(editMode, setShowAreaSelectTour);
	}, [editMode]);

	useEffect(() => {
		const handleRestartTour = () => setShowAreaSelectTour(true);
		globalThis.addEventListener('restart-area-select-tour', handleRestartTour);
		return () => globalThis.removeEventListener('restart-area-select-tour', handleRestartTour);
	}, []);

	const handleUpdateRange = useCallback((e: any) => {
		updateDateRange(e, setFromDate, setToDate);
	}, []);

	const handleTourComplete = useCallback(() => {
		setShowAreaSelectTour(false);
		void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => {});
	}, []);

	const handleTourSkip = useCallback(() => {
		setShowAreaSelectTour(false);
		void axios.patch('/settings', { area_select_tour_completed: true }).catch(() => {});
	}, []);

	const handleCancel = useCallback((): void => {
		if (onCancel) { onCancel(); return; }
		navigate(DASHBOARD_ROUTE);
	}, [onCancel, navigate]);

    const getUpdatedPylovoData = useCallback(() => {
        const baseData = pylovoLayersData.pylovoGridData || {};
        const updatedData = { ...baseData };

        if (!map) return updatedData;

        const format = new GeoJSON();

        pylovoLayersData.pylovoLayersRef.current.forEach(layer => {
            const source = layer.getSource();
            if (!source) return;

            const features = source.getFeatures();
            if (features.length === 0) return;

            const firstFeature = features[0];
            const type = firstFeature.get('feature_type');

            if (type === 'building') {
                 const geojson = format.writeFeaturesObject(features, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: map.getView().getProjection()
                 });
                 updatedData.buildings = geojson;
            }
        });

        return updatedData;
    }, [pylovoLayersData, map]);

	const handleSave = useCallback(async (): Promise<void> => {
        const currentPylovoData = getUpdatedPylovoData();
        const user = useAuthStore.getState().user;
        const userId = user?.id ? String(user.id) : undefined;
		await saveAreaData({
			fromDate, toDate, modelName, resolution, editMode, modelId,
			onAreaSelected, polygonCoordinates: allPolygons, workspaceId: currentWorkspace?.id,
			updateModelMutation, createModelMutation, navigate, setIsSaving,
			pylovoData: currentPylovoData, advancedParams,
			draftId, userId, originalModel: originalModelRef.current
		});
	}, [fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, navigate, allPolygons, currentWorkspace?.id, updateModelMutation, createModelMutation, getUpdatedPylovoData, advancedParams, draftId]);

    const handleResetAdvancedParameters = useCallback(() => {
        setAdvancedParams(getDefaultAdvancedParameters());
    }, []);

    const isPolygonInEnabledRegion = useCallback((polygonCoords: [number, number][]): boolean => {
        const { availableRegions, showBoundary } = pylovoLayersData;
        // If no regions loaded (boundary display off), allow drawing everywhere
        if (availableRegions.length === 0 && !showBoundary) return true;
        if (availableRegions.length === 0) return false;
        // Calculate center of the polygon
        let totalLat = 0, totalLon = 0;
        for (const [lon, lat] of polygonCoords) {
            totalLat += lat;
            totalLon += lon;
        }
        const centerLat = totalLat / polygonCoords.length;
        const centerLon = totalLon / polygonCoords.length;
        // Check if center falls within any available region's bbox
        return availableRegions.some(r => {
            if (!r.bbox) return false;
            return centerLat >= r.bbox.south && centerLat <= r.bbox.north &&
                   centerLon >= r.bbox.west && centerLon <= r.bbox.east;
        });
    }, [pylovoLayersData]);

    const handlePolygonDrawn = useCallback(async (_coordinates: [number, number][], allPolygons: [number, number][][]) => {
        // Check if polygon is in an enabled region
        if (!isPolygonInEnabledRegion(_coordinates)) {
            showError(t("gridNotifications.regionDisabled", { defaultValue: "This region is not available. The region may be disabled or has no grid data." }));
            setAllPolygons([]);
            setClearTrigger(prev => prev + 1);
            return;
        }

        setAllPolygons(allPolygons);
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            // Get user_id for custom buildings filtering
            const user = useAuthStore.getState().user;
            const userId = user?.id ? String(user.id) : undefined;

            const response = await pylovoService.generateGrid({
                polygon: _coordinates,
                polygons: allPolygons,
                user_id: userId,
                model_id: modelId,
                draft_id: draftId,
                include_public_buildings: includePublicBuildings,
                include_private_buildings: includePrivateBuildings,
                excluded_building_ids: Array.from(excludedBuildingIds),
            });

            // Discard stale response if a newer request was started (e.g. Clear All)
            if (genId !== gridGenIdRef.current) return;

            const buildingsCount = response.buildings?.features?.length || 0;

            // Check building limit (0 means unlimited)
            if (buildingLimit > 0 && buildingsCount > buildingLimit) {
                showError(t("gridNotifications.buildingLimitExceeded", { count: buildingsCount, limit: buildingLimit }));
                setAllPolygons([]);
                setClearTrigger(prev => prev + 1);
                pylovoLayersData.processPylovoData({});
                return;
            }

            if (buildingsCount > 0) showSuccess(t("gridNotifications.gridGenerated", { count: buildingsCount }));
            else showSuccess(t("gridNotifications.gridCompleteNoBuildings"));
            pylovoLayersData.processPylovoData(response as PylovoGridData);
        } catch {
            if (genId !== gridGenIdRef.current) return;
            showError(t("gridNotifications.gridGenerationFailed"));
        } finally {
            if (genId === gridGenIdRef.current) setIsGeneratingGrid(false);
        }
    }, [pylovoLayersData, showSuccess, showError, includePublicBuildings, includePrivateBuildings, excludedBuildingIds, buildingLimit, t, modelId, draftId, isPolygonInEnabledRegion]);

    const handleClearAllPolygons = useCallback(() => {
        // Invalidate any in-flight grid generation requests
        gridGenIdRef.current++;
        setAllPolygons([]);
        setClearTrigger(prev => prev + 1);
        pylovoLayersData.processPylovoData({});
        mapInteractionsData.handleCloseTransformerDialog();
        mapInteractionsData.handleCloseBuildingDialog();
        setExcludedBuildingIds(new Set()); // Clear excluded buildings when clearing polygons
    }, [pylovoLayersData, mapInteractionsData]);

    // Handle polygon modification (vertex dragging, adding/removing points)
    const handlePolygonModified = useCallback(async (updatedPolygons: [number, number][][]) => {
        setAllPolygons(updatedPolygons);

        if (updatedPolygons.length === 0) return;

        // Check if any polygon moved outside enabled regions
        const lastPolygon = updatedPolygons[updatedPolygons.length - 1];
        if (!isPolygonInEnabledRegion(lastPolygon)) {
            showError(t("gridNotifications.regionDisabled", { defaultValue: "This region is not available. The region may be disabled or has no grid data." }));
            return;
        }

        // Regenerate grid with updated polygon coordinates
        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const user = useAuthStore.getState().user;
            const userId = user?.id ? String(user.id) : undefined;

            const response = await pylovoService.generateGrid({
                polygons: updatedPolygons,
                user_id: userId,
                model_id: modelId,
                draft_id: draftId,
                include_public_buildings: includePublicBuildings,
                include_private_buildings: includePrivateBuildings,
                excluded_building_ids: Array.from(excludedBuildingIds),
            });

            // Discard stale response if a newer request was started
            if (genId !== gridGenIdRef.current) return;

            const buildingsCount = response.buildings?.features?.length || 0;
            showSuccess(t("gridNotifications.gridUpdated", { count: buildingsCount }));
            pylovoLayersData.processPylovoData(response as PylovoGridData);
        } catch {
            if (genId !== gridGenIdRef.current) return;
            showError(t("gridNotifications.gridRegenerationFailed"));
        } finally {
            if (genId === gridGenIdRef.current) setIsGeneratingGrid(false);
        }
    }, [pylovoLayersData, showSuccess, showError, includePublicBuildings, includePrivateBuildings, excludedBuildingIds, t, modelId, draftId, isPolygonInEnabledRegion]);

    // Toggle individual building exclusion
    const toggleBuildingExclusion = useCallback((buildingId: number) => {
        setExcludedBuildingIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(buildingId)) {
                newSet.delete(buildingId);
            } else {
                newSet.add(buildingId);
            }
            return newSet;
        });
    }, []);

    const clearExcludedBuildings = useCallback(() => {
        setExcludedBuildingIds(new Set());
    }, []);

    // Track previous filter values to detect changes - these refs hold the current values for the async function
    const filtersRef = useRef({
        includePublicBuildings,
        includePrivateBuildings,
        excludedBuildingIds,
        allPolygons
    });

    // Update refs when values change
    useEffect(() => {
        filtersRef.current = {
            includePublicBuildings,
            includePrivateBuildings,
            excludedBuildingIds,
            allPolygons
        };
    }, [includePublicBuildings, includePrivateBuildings, excludedBuildingIds, allPolygons]);

    // Regenerate grid - stable callback that reads from refs
    const regenerateGridWithFilters = useCallback(async () => {
        const { allPolygons: polygons, includePublicBuildings: incPublic, includePrivateBuildings: incPrivate, excludedBuildingIds: excluded } = filtersRef.current;

        if (polygons.length === 0) return;

        setIsGeneratingGrid(true);
        const genId = ++gridGenIdRef.current;
        try {
            const user = useAuthStore.getState().user;
            const userId = user?.id ? String(user.id) : undefined;

            const response = await pylovoService.generateGrid({
                polygons: polygons,
                user_id: userId,
                model_id: modelId,
                draft_id: draftId,
                include_public_buildings: incPublic,
                include_private_buildings: incPrivate,
                excluded_building_ids: Array.from(excluded),
            });

            // Discard stale response if a newer request was started
            if (genId !== gridGenIdRef.current) return;

            const buildingsCount = response.buildings?.features?.length || 0;
            showSuccess(t("gridNotifications.gridUpdated", { count: buildingsCount }));
            pylovoLayersData.processPylovoData(response as PylovoGridData);
        } catch {
            if (genId !== gridGenIdRef.current) return;
            showError(t("gridNotifications.gridRegenerationFailed"));
        } finally {
            if (genId === gridGenIdRef.current) setIsGeneratingGrid(false);
        }
    }, [pylovoLayersData, showSuccess, showError, t, modelId, draftId]); // Stable deps only

    // Track if filters have been initialized (polygon drawn)
    const hasInitializedFiltersRef = useRef(false);
    const prevPublicRef = useRef(includePublicBuildings);
    const prevPrivateRef = useRef(includePrivateBuildings);
    const prevExcludedSizeRef = useRef(excludedBuildingIds.size);

    // Regenerate when filter toggles change
    useEffect(() => {
        // Skip if no polygons drawn yet; reset filter tracking on clear
        if (allPolygons.length === 0) {
            hasInitializedFiltersRef.current = false;
            prevPublicRef.current = includePublicBuildings;
            prevPrivateRef.current = includePrivateBuildings;
            prevExcludedSizeRef.current = excludedBuildingIds.size;
            return;
        }

        // Mark as initialized once we have polygons
        if (!hasInitializedFiltersRef.current) {
            hasInitializedFiltersRef.current = true;
            prevPublicRef.current = includePublicBuildings;
            prevPrivateRef.current = includePrivateBuildings;
            prevExcludedSizeRef.current = excludedBuildingIds.size;
            return;
        }

        // Check what changed
        const publicChanged = prevPublicRef.current !== includePublicBuildings;
        const privateChanged = prevPrivateRef.current !== includePrivateBuildings;
        const excludedChanged = prevExcludedSizeRef.current !== excludedBuildingIds.size;

        if (publicChanged || privateChanged || excludedChanged) {
            // Update refs
            prevPublicRef.current = includePublicBuildings;
            prevPrivateRef.current = includePrivateBuildings;
            prevExcludedSizeRef.current = excludedBuildingIds.size;

            // Regenerate the grid
            regenerateGridWithFilters();
        }
    }, [includePublicBuildings, includePrivateBuildings, excludedBuildingIds.size, allPolygons.length, regenerateGridWithFilters]);

	const state: AreaSelectState = {
		modelName, fromDate, toDate, resolution, isSaving, isLoadingModel,
		showAreaSelectTour, loadedCoordinates, loadedConfig, allPolygons,
		advancedParams, showAdvancedParams, isDrawing, allowMultiplePolygons,
		clearTrigger, cursorPos, isGeneratingGrid,
        includePublicBuildings, includePrivateBuildings, excludedBuildingIds,
	};

	const actions: AreaSelectActions = {
		setModelName, setResolution, handleUpdateRange, setShowAreaSelectTour,
		handleTourComplete, handleTourSkip, handleSave, handleCancel,
        setAllPolygons, setAdvancedParams, setShowAdvancedParams,
        handleResetAdvancedParams: handleResetAdvancedParameters,
        handlePolygonDrawn, handlePolygonModified, handleClearAllPolygons, setAllowMultiplePolygons,
        setIsDrawing, setIncludePublicBuildings, setIncludePrivateBuildings,
        toggleBuildingExclusion, clearExcludedBuildings,
	};

	return {
        state, actions, customLocations: customLocationsData,
        pylovoLayers: pylovoLayersData, techOperations: techOperationsData,
        mapInteractions: mapInteractionsData,
        notification: { data: notification, showSuccess, showError, hide },
        setCursorPos,
        map,
        mapRef
    };
};

// Helper functions
function updateDateRange(e: any, setFromDate: (date: string) => void, setToDate: (date: string) => void) {
	const formatDate = ({ year, month, day }: { year: number; month: number; day: number }) =>
		`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	setFromDate(formatDate(e.start));
	setToDate(formatDate(e.end));
}

interface ModelDataSetters {
	setModelName: (name: string) => void;
	setResolution: (resolution: number) => void;
	setFromDate: (date: string) => void;
	setToDate: (date: string) => void;
	setLoadedCoordinates: (coords: [number, number][][]) => void;
	setIsLoadingModel: (loading: boolean) => void;
	setLoadedConfig?: (config: PylovoGridData | undefined) => void;
}

// Helper to parse MultiPolygon coordinates from model
function parseModelCoordinates(coordinates: any): [number, number][][] | null {
	if (coordinates?.type !== 'MultiPolygon' || !Array.isArray(coordinates.coordinates)) {
		return null;
	}
	const polygons = coordinates.coordinates
		.map((poly: any) => poly[0])
		.filter((poly: any) => poly?.length > 0);
	return polygons.length > 0 ? polygons : null;
}

// Helper to extract PylovoGridData from model config
function extractPylovoConfig(config: any): PylovoGridData | null {
	if (!config) return null;
	const pylovoData: PylovoGridData = {};
	if (config.buildings) pylovoData.buildings = config.buildings;
	if (config.lines) pylovoData.lines = config.lines;
	if (config.mv_lines) pylovoData.mv_lines = config.mv_lines;
	if (config.transformers) pylovoData.transformers = config.transformers;
	if (config.grids) pylovoData.grids = config.grids;
	return Object.keys(pylovoData).length > 0 ? pylovoData : null;
}

// Helper to apply model data to setters
function applyModelToSetters(model: any, setters: ModelDataSetters): void {
	if (model.title) setters.setModelName(model.title);
	if (model.resolution !== undefined) setters.setResolution(model.resolution);
	if (model.from_date) setters.setFromDate(new Date(model.from_date).toISOString().split('T')[0]);
	if (model.to_date) setters.setToDate(new Date(model.to_date).toISOString().split('T')[0]);

	const polygons = parseModelCoordinates(model.coordinates);
	if (polygons) setters.setLoadedCoordinates(polygons);

	const pylovoConfig = extractPylovoConfig(model.config);
	if (pylovoConfig) setters.setLoadedConfig?.(pylovoConfig);
}

async function loadExistingModelData(params: { editMode: boolean; modelId: number | undefined; setters: ModelDataSetters; originalModelRef?: React.MutableRefObject<{ title: string; from_date: string; to_date: string; resolution: number; config: any; status: string } | null>; }) {
	const { editMode, modelId, setters, originalModelRef } = params;
	if (!editMode || !modelId) return;

	setters.setIsLoadingModel(true);
	try {
		const response = await modelService.getModelById(modelId);
		if (response.success && response.data) {
			applyModelToSetters(response.data, setters);
			if (originalModelRef) {
				const m = response.data;
				originalModelRef.current = {
					title: m.title || '',
					from_date: m.from_date ? new Date(m.from_date).toISOString().split('T')[0] : '',
					to_date: m.to_date ? new Date(m.to_date).toISOString().split('T')[0] : '',
					resolution: m.resolution ?? 0,
					config: m.config || null,
					status: m.status || 'draft',
				};
			}
		}
	} catch {
		/* ignore load errors */
	} finally {
		setters.setIsLoadingModel(false);
	}
}

async function checkAndShowAreaSelectTour(editMode: boolean, setShowAreaSelectTour: (show: boolean) => void) {
	if (editMode) return;
	try {
		const { data } = await axios.get('/settings');
		if (data.success && data.data && !data.data.area_select_tour_completed) {
			const timer = setTimeout(() => setShowAreaSelectTour(true), 1000);
			return () => clearTimeout(timer);
		}
	} catch { /* ignore */ }
}

// Calculate the center point of polygon coordinates
function calculatePolygonCenter(polygonCoordinates: number[][][]): { lat: number; lon: number } {
	let totalLat = 0;
	let totalLon = 0;
	let pointCount = 0;

	for (const polygon of polygonCoordinates) {
		for (const coord of polygon) {
			totalLon += coord[0];
			totalLat += coord[1];
			pointCount++;
		}
	}

	return {
		lat: pointCount > 0 ? totalLat / pointCount : 0,
		lon: pointCount > 0 ? totalLon / pointCount : 0,
	};
}

// Helper to build config object for saving
function buildSaveConfig(pylovoData: any, advancedParams: any): any {
	if (!pylovoData) return undefined;

	const config: any = {};
	if (pylovoData.buildings) config.buildings = pylovoData.buildings;
	if (pylovoData.lines) config.lines = pylovoData.lines;
	if (pylovoData.mv_lines) config.mv_lines = pylovoData.mv_lines;
	if (pylovoData.transformers) config.transformers = pylovoData.transformers;
	if (pylovoData.grids) config.grids = pylovoData.grids;

	// Check if PyPSA is enabled
	const pypsaEnabled = advancedParams?.pypsa_enabled !== false;

	if (pypsaEnabled) {
		config.pypsa = {
			trafo_mv_lv_used: true,
			trafo_mv_lv_type: advancedParams?.trafo_mv_lv_type || "0.4 MVA 20/0.4 kV",
			line_type_mv: advancedParams?.line_type_mv || "NA2XS2Y 1x185 RM/25 12/20 kV",
			line_type_lv: advancedParams?.line_type_lv || "NAYY 4x150 SE"
		};
	} else {
		config.pypsa = false;
	}

	return Object.keys(config).length > 0 ? config : undefined;
}

// Helper to get region info from geocoding
async function getRegionFromPolygon(polygonCoordinates: number[][][]): Promise<{ region: string; country: string }> {
	try {
		const center = calculatePolygonCenter(polygonCoordinates);
		const locationInfo = await geocodingService.reverseRegion(center.lat, center.lon);
		return locationInfo ? { region: locationInfo.region, country: locationInfo.country } : { region: '', country: '' };
	} catch {
		return { region: '', country: '' };
	}
}

// Fingerprint a config by counting features and tech assignments — robust to
// floating-point / key-ordering differences that break JSON.stringify equality.
function configFingerprint(cfg: any): string {
	if (!cfg) return '';
	const fc = (g: any) => g?.features?.length ?? 0;
	const techCount = (cfg.buildings?.features || []).reduce(
		(s: number, f: any) => s + (f.properties?.technologies?.length || 0), 0
	);
	// Sort pypsa keys so DB key-order vs code key-order doesn't cause a mismatch
	const pypsaStr = cfg.pypsa && typeof cfg.pypsa === 'object'
		? JSON.stringify(cfg.pypsa, Object.keys(cfg.pypsa).sort())
		: JSON.stringify(cfg.pypsa ?? null);
	return [
		fc(cfg.buildings), fc(cfg.transformers), fc(cfg.lines),
		fc(cfg.mv_lines), fc(cfg.grids), techCount, pypsaStr,
	].join('|');
}

// Helper to validate save data
function isValidSaveData(fromDate: string, toDate: string, modelName: string, polygonCoordinates: any): boolean {
	return Boolean(fromDate && toDate && modelName?.trim() && polygonCoordinates?.length > 0);
}

async function saveAreaData(params: any) {
	const { fromDate, toDate, modelName, resolution, editMode, modelId, onAreaSelected, polygonCoordinates, workspaceId, updateModelMutation, createModelMutation, navigate, setIsSaving, pylovoData, advancedParams, draftId, userId, originalModel } = params;

	if (!isValidSaveData(fromDate, toDate, modelName, polygonCoordinates)) return;

	setIsSaving(true);
	try {
		await new Promise(resolve => setTimeout(resolve, SAVE_DELAY_MS));
		const areaData: AreaData = { fromDate, toDate, resolution, modelName: modelName.trim(), timestamp: new Date().toISOString() };

		if (onAreaSelected) {
			onAreaSelected(areaData);
			return;
		}

		const coordinatesGeoJSON = { type: "MultiPolygon", coordinates: polygonCoordinates.map((polygon: number[][]) => [polygon]) };
		const config = buildSaveConfig(pylovoData, advancedParams);
		const { region, country } = await getRegionFromPolygon(polygonCoordinates);

		const modelData = {
			title: areaData.modelName,
			from_date: areaData.fromDate,
			to_date: areaData.toDate,
			resolution: areaData.resolution,
			workspace_id: workspaceId,
			coordinates: coordinatesGeoJSON,
			config
		};

		if (editMode && modelId) {
			// Detect whether the user actually changed anything
			let hasChanges = !originalModel;
			if (originalModel) {
				hasChanges =
					originalModel.title !== areaData.modelName ||
					originalModel.from_date !== areaData.fromDate ||
					originalModel.to_date !== areaData.toDate ||
					originalModel.resolution !== areaData.resolution ||
					configFingerprint(originalModel.config) !== configFingerprint(config);
			}
			const updatePayload = hasChanges
				? { ...modelData, status: 'modified' as const }
				: modelData;
			await updateModelMutation.mutateAsync({ id: modelId, data: updatePayload });
		} else {
			// Create new model and get the new model ID
			const newModel = await createModelMutation.mutateAsync({ ...modelData, region, country });

			// Finalize user-placed transformers: convert draft_id to model_id
			if (draftId && newModel?.data?.id) {
				try {
					await pylovoService.finalizeTransformers(draftId, newModel.data.id, userId);
				} catch (err) {
					// Log but don't fail the save - transformers are nice-to-have
					console.error('Failed to finalize transformers:', err);
				}
			}
		}

		navigate(DASHBOARD_ROUTE, { state: { workspaceId } });
	} catch {
		/* ignore save errors */
	} finally {
		setIsSaving(false);
	}
}
