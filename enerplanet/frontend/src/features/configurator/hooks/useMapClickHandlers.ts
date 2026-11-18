import { useCallback, useEffect, useRef } from "react";
import { useConfiguratorParams } from "@/features/configurator/building-config";
import type { Map as OLMap, Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OLFeature from "ol/Feature";
import { Fill, Stroke, Style } from "ol/style";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { getFeatureFClasses, getPrimaryFClass } from "@/features/configurator/utils/fClassUtils";
import { extractBuildingEnrichmentFromProps, extractPeakLoadFromProps, extractSelectedFClassFromProps } from "@/features/configurator/utils/buildingFeatureExtraction";
import { extractYearlyDemandAll } from "@/features/configurator/utils/parsing";
import { estimateYearlyHeatDemand, explicitHeatDemandKwh } from "@/features/configurator/utils/heatDemand";
import { buildFClassDetails } from "@/features/configurator/hooks/useAreaSelect/helpers/fClassDemand";
import { extractTransformerId } from "@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments";
import { collectBuildingsFromLayers, countConnectedBuildings, findBuildingLayer, highlightConnectedBuildings } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { createBuildingStyleFunction, createBuildingHighlightStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";
import { isBuildingDisabled } from "@/features/configurator/hooks/useBuildingSelection";

/** Delay between the pointer entering a feature and its tooltip appearing. */
const HOVER_DELAY_MS = 300;

const extractYearlyDemandKwh = (props: Record<string, unknown>): number => extractYearlyDemandAll(props);
const extractPeakLoadKw = extractPeakLoadFromProps;
const extractBuildingEnrichment = extractBuildingEnrichmentFromProps;
const extractSelectedFClass = extractSelectedFClassFromProps;

const createTransformerTooltip = (feature: any, pixel: number[], layers: VectorLayer<VectorSource>[]) => {
  const numId = extractTransformerId(feature.getProperties());
  const { count, types } = countConnectedBuildings(numId, layers);
  return { x: pixel[0], y: pixel[1], ratedPowerKva: feature.get('rated_power_kva') || 0, gridResultId: feature.get('grid_result_id'), connectedBuildingCount: count, connectedBuildingTypes: types };
};

const createBuildingTooltip = (feature: any, pixel: number[]) => {
  const props = feature.getProperties() as Record<string, unknown>;
  const fClasses = getFeatureFClasses(props);
  const primary = getPrimaryFClass(props) || 'unknown';
  const heat = estimateYearlyHeatDemand(primary, props.area as number, explicitHeatDemandKwh(props));
  return { x: pixel[0], y: pixel[1], osmId: String(feature.get('osm_id') ?? ''), disabled: isBuildingDisabled(feature), type: primary, fClass: primary, fClasses, yearlyDemandKwh: extractYearlyDemandKwh(props), yearlyHeatDemandKwh: heat.kwh, heatDemandEstimated: heat.estimated, techs: feature.get('techs') || {}, gridResultId: feature.get('grid_result_id') ?? feature.get('transformer_id'), selectedFClass: extractSelectedFClass(props, fClasses, primary), ...extractBuildingEnrichment(props) };
};

const createMvLineTooltip = (feature: any, pixel: number[]) => ({
  x: pixel[0], y: pixel[1], voltage: feature.get('voltage') || (feature.get('vn_kv') ? `${feature.get('vn_kv')} kV` : '20 kV'),
  lengthM: feature.get('length_m') || feature.get('length') || 0, cableType: feature.get('cable_type') || feature.get('std_type') || '',
  normallyOpen: feature.get('normally_open') || false, fromBus: feature.get('from_bus') || feature.get('from_node') || '',
  toBus: feature.get('to_bus') || feature.get('to_node') || '',
});

interface MapClickOptions {
  map: OLMap | null;
  isDrawing: boolean;
  pylovoLayersRef: React.RefObject<VectorLayer<VectorSource>[]>;
  suppressDialogOnClickRef?: React.RefObject<boolean>;
  suppressMapInteractions?: boolean;
}

// The 3D view's hover colour (HOVER_COLOR in maplibre-lod2.ts).
const HOVER_STYLE = new Style({
  stroke: new Stroke({ color: '#3b82f6', width: 3 }),
  fill: new Fill({ color: 'rgba(59, 130, 246, 0.25)' }),
});

export const useMapClickHandlers = ({
  map, isDrawing, pylovoLayersRef, suppressDialogOnClickRef, suppressMapInteractions = false,
}: MapClickOptions) => {
  // The map click effect below re-registers only when the map or the drawing
  // mode changes. A ref keeps it reading the current opener without widening
  // that to every URL change, which is when react-router rebuilds it.
  const { openBuilding } = useConfiguratorParams();
  const openBuildingRef = useRef(openBuilding);
  openBuildingRef.current = openBuilding;

  const transformerDialogOpen = useModelStore((s) => s.transformerDialogOpen);
  const setTransformerDialogOpen = useModelStore((s) => s.setTransformerDialogOpen);
  const selectedTransformer = useModelStore((s) => s.selectedTransformer);
  const setSelectedTransformer = useModelStore((s) => s.setSelectedTransformer);
  const setTransformerTooltip = useModelStore((s) => s.setTransformerTooltip);
  const buildingDialogOpen = useModelStore((s) => s.buildingDialogOpen);
  const setBuildingDialogOpen = useModelStore((s) => s.setBuildingDialogOpen);
  const selectedBuilding = useModelStore((s) => s.selectedBuilding);
  const setSelectedBuilding = useModelStore((s) => s.setSelectedBuilding);
  const selectedBuildingFeature = useModelStore((s) => s.selectedBuildingFeature);
  const setSelectedBuildingFeature = useModelStore((s) => s.setSelectedBuildingFeature);
  const setBuildingTooltip = useModelStore((s) => s.setBuildingTooltip);
  const setMvLineTooltip = useModelStore((s) => s.setMvLineTooltip);

  const highlightedBuildingsRef = useRef<Feature<Geometry>[]>([]);

  // Highlight buildings connected to hovered transformer
  useEffect(() => {
    if (!map || !pylovoLayersRef.current.length) return;
    highlightedBuildingsRef.current.forEach(f => f.setStyle(createBuildingStyleFunction(true, false)));
    highlightedBuildingsRef.current = [];
    // hoveredTransformerId is now local to this effect via the store
    const hoveredId = useModelStore.getState().transformerTooltip?.gridResultId ?? null;
    if (hoveredId === null) return;
    const buildingLayer = findBuildingLayer(pylovoLayersRef.current);
    const buildingSource = buildingLayer?.getSource();
    if (!buildingSource) return;
    highlightConnectedBuildings(buildingSource, hoveredId, highlightedBuildingsRef, (f) => f.setStyle(createBuildingHighlightStyleFunction()));
  }, [map, pylovoLayersRef]);

  // Map click + pointer move handlers
  useEffect(() => {
    if (!map) return;
    if (suppressMapInteractions) { setTransformerTooltip(null); setBuildingTooltip(null); setMvLineTooltip(null); return; }

    // The 3D view picks buildings by their LoD2 shape (useMapLibreInteractions); the hidden 2D layers
    // would find the footprint on the ground under the pointer, another building when the view is tilted.
    const in3D = () => useMapStore.getState().selectedBaseLayerId === "maplibre_3d";

    const handleClick = (evt: any) => {
      if (in3D()) return;
      // Modified clicks belong to the polygon drawer (Shift, Alt on a corner) and useBuildingSelection (Alt, Ctrl, Cmd).
      const e = evt.originalEvent;
      if (isDrawing || suppressDialogOnClickRef?.current || e?.shiftKey || e?.altKey || e?.ctrlKey || e?.metaKey) return;
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => { const t = f.get('feature_type'); if (t === 'transformer' || t === 'building') return f; return null; });
      if (!feature) return;
      const type = feature.get('feature_type');
      if (type === 'transformer') {
        setSelectedTransformer({ gridResultId: feature.get('grid_result_id'), osmId: feature.get('osm_id') || '', ratedPowerKva: feature.get('rated_power_kva') || 0 });
        setTransformerDialogOpen(true);
      } else if (type === 'building') {
        const props = feature.getProperties() as Record<string, unknown>;
        const fClasses = getFeatureFClasses(props);
        const primaryFClass = getPrimaryFClass(props) || 'unknown';
        const enrichment = extractBuildingEnrichment(props);
        const totalDemand = extractYearlyDemandKwh(props);
        const totalPeak = extractPeakLoadKw(props);
        const effectiveFClasses = fClasses.length > 0 ? fClasses : [primaryFClass];
        const heat = estimateYearlyHeatDemand(primaryFClass, Number(props.area) || 0, explicitHeatDemandKwh(props));
        setSelectedBuilding({
          osmId: feature.get('osm_id'), type: primaryFClass, fClass: primaryFClass, fClasses, yearlyDemandKwh: totalDemand,
          yearlyHeatDemandKwh: heat.kwh, heatDemandEstimated: heat.estimated,
          peakLoadKw: totalPeak, area: feature.get('area') || 0, gridResultId: feature.get('grid_result_id'),
          techs: feature.get('techs') || {}, fClassDetails: buildFClassDetails(effectiveFClasses, totalDemand, totalPeak, props.f_class_demands ?? props.fclass_details),
          selectedFClass: extractSelectedFClass(props, effectiveFClasses, primaryFClass), ...enrichment,
        });
        setSelectedBuildingFeature(feature as Feature<Geometry>);
        // The configurator is URL-driven, so opening it is a query-string
        // change rather than dialog state. A building with no osm_id has
        // nothing to resolve an envelope by, so it keeps the older dialog.
        const osmId = feature.get('osm_id');
        if (osmId != null && String(osmId) !== '') {
          openBuildingRef.current(String(osmId));
        } else {
          setBuildingDialogOpen(true);
        }
      }
    };

    // A tooltip appears HOVER_DELAY_MS after the pointer enters a feature,
    // however it moves within it, and stays where it appeared. Leaving the
    // feature first cancels it, so sweeping across buildings renders nothing.
    let pending: ReturnType<typeof setTimeout> | undefined;
    // The 3D overlay sets the same cursor, so it is cleared only on leaving a feature.
    let pointing = false;
    let target: unknown = null;
    let shown = false;
    let lastPixel: number[] = [];
    // The building under the pointer is outlined, as the 3D view tints it, so a click's target shows first.
    const hoverSource = new VectorSource();
    const hoverLayer = new VectorLayer({ source: hoverSource, style: HOVER_STYLE, zIndex: 101 });
    map.addLayer(hoverLayer);
    let hovered: unknown = null;
    // Found at the exact pixel, as a click finds what it opens; the tooltip lookup allows for thin lines.
    const setHovered = (pixel: number[] | null) => {
      const building = pixel && map.forEachFeatureAtPixel(pixel, (f: any) => (f.get('feature_type') === 'building' ? f : undefined)) || null;
      if (building === hovered) return;
      hovered = building;
      hoverSource.clear();
      if (building) hoverSource.addFeature(new OLFeature(building.getGeometry()));
    };
    const clearTooltips = () => { setTransformerTooltip(null); setBuildingTooltip(null); setMvLineTooltip(null); };
    const showTooltip = (feature: any, pixel: number[]) => {
      const type = feature.get('feature_type');
      clearTooltips();
      if (type === 'transformer') setTransformerTooltip(createTransformerTooltip(feature, pixel, pylovoLayersRef.current));
      else if (type === 'building') setBuildingTooltip(createBuildingTooltip(feature, pixel));
      else if (type === 'mv_line') setMvLineTooltip(createMvLineTooltip(feature, pixel));
      shown = true;
    };
    const hide = () => {
      clearTimeout(pending);
      if (shown) clearTooltips();
      shown = false;
      target = null;
    };

    const handlePointerMove = (evt: any) => {
      if (evt.dragging || isDrawing || in3D()) { hide(); setHovered(null); return; }
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => { const t = f.get('feature_type'); if (t === 'transformer' || t === 'building' || t === 'mv_line') return f; return null; }, { hitTolerance: 5 });
      if (feature || pointing) map.getTargetElement().style.cursor = feature ? 'pointer' : '';
      pointing = !!feature;
      setHovered(evt.pixel);
      if (feature && feature === target) {
        if (!shown) lastPixel = evt.pixel;
        return;
      }
      hide();
      if (!feature) return;
      target = feature;
      lastPixel = evt.pixel;
      pending = setTimeout(() => showTooltip(feature, lastPixel), HOVER_DELAY_MS);
    };

    map.on('click', handleClick);
    map.on('pointermove', handlePointerMove);
    return () => { clearTimeout(pending); map.un('click', handleClick); map.un('pointermove', handlePointerMove); map.removeLayer(hoverLayer); };
  }, [map, isDrawing, suppressMapInteractions]);

  const handleCloseTransformerDialog = useCallback(() => { setTransformerDialogOpen(false); setSelectedTransformer(null); }, [setTransformerDialogOpen, setSelectedTransformer]);
  // The 3D view's building data is copied when the grid loads; technologies and analysis results
  // added since are on the 2D map's features, so its tooltip is built from those.
  const buildingTooltipFor = useCallback((osmId: string, pixel: number[]) => {
    const feature = collectBuildingsFromLayers(pylovoLayersRef.current).find((f) => String(f.get('osm_id')) === osmId);
    return feature ? createBuildingTooltip(feature, pixel) : null;
  }, [pylovoLayersRef]);
  const handleCloseBuildingDialog = useCallback(() => { setBuildingDialogOpen(false); setSelectedBuilding(null); setSelectedBuildingFeature(null); }, [setBuildingDialogOpen, setSelectedBuilding, setSelectedBuildingFeature]);

  // Hover tooltips change on every pointer move, so they are read in
  // MapOverlays; reading them here would re-render the configurator.
  return {
    transformerDialogOpen, setTransformerDialogOpen,
    selectedTransformer, setSelectedTransformer,
    setTransformerTooltip,
    buildingDialogOpen, setBuildingDialogOpen,
    selectedBuilding, setSelectedBuilding,
    selectedBuildingFeature, setSelectedBuildingFeature,
    setBuildingTooltip,
    buildingTooltipFor,
    setMvLineTooltip,
    handleCloseTransformerDialog, handleCloseBuildingDialog,
  };
};
