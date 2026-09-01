import { useCallback, useEffect, useRef } from "react";
import type { Map as OLMap, Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { getFeatureFClasses, getPrimaryFClass } from "@/features/configurator/utils/fClassUtils";
import { extractBuildingEnrichmentFromProps, extractPeakLoadFromProps, extractSelectedFClassFromProps } from "@/features/configurator/utils/buildingFeatureExtraction";
import { extractYearlyDemandAll } from "@/features/configurator/utils/parsing";
import { buildFClassDetails } from "@/features/configurator/hooks/useAreaSelect/helpers/fClassDemand";
import { extractTransformerId } from "@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments";
import { countConnectedBuildings, findBuildingLayer, highlightConnectedBuildings } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { createBuildingStyleFunction, createBuildingHighlightStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";

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
  return { x: pixel[0], y: pixel[1], type: primary, fClass: primary, fClasses, yearlyDemandKwh: extractYearlyDemandKwh(props), techs: feature.get('techs') || {}, gridResultId: feature.get('grid_result_id') ?? feature.get('transformer_id'), selectedFClass: extractSelectedFClass(props, fClasses, primary), ...extractBuildingEnrichment(props) };
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

export const useMapClickHandlers = ({
  map, isDrawing, pylovoLayersRef, suppressDialogOnClickRef, suppressMapInteractions = false,
}: MapClickOptions) => {
  const transformerDialogOpen = useModelStore((s) => s.transformerDialogOpen);
  const setTransformerDialogOpen = useModelStore((s) => s.setTransformerDialogOpen);
  const selectedTransformer = useModelStore((s) => s.selectedTransformer);
  const setSelectedTransformer = useModelStore((s) => s.setSelectedTransformer);
  const transformerTooltip = useModelStore((s) => s.transformerTooltip);
  const setTransformerTooltip = useModelStore((s) => s.setTransformerTooltip);
  const buildingDialogOpen = useModelStore((s) => s.buildingDialogOpen);
  const setBuildingDialogOpen = useModelStore((s) => s.setBuildingDialogOpen);
  const selectedBuilding = useModelStore((s) => s.selectedBuilding);
  const setSelectedBuilding = useModelStore((s) => s.setSelectedBuilding);
  const selectedBuildingFeature = useModelStore((s) => s.selectedBuildingFeature);
  const setSelectedBuildingFeature = useModelStore((s) => s.setSelectedBuildingFeature);
  const buildingTooltip = useModelStore((s) => s.buildingTooltip);
  const setBuildingTooltip = useModelStore((s) => s.setBuildingTooltip);
  const mvLineTooltip = useModelStore((s) => s.mvLineTooltip);
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

    const handleClick = (evt: any) => {
      if (isDrawing || suppressDialogOnClickRef?.current) return;
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
        setSelectedBuilding({
          osmId: feature.get('osm_id'), type: primaryFClass, fClass: primaryFClass, fClasses, yearlyDemandKwh: totalDemand,
          peakLoadKw: totalPeak, area: feature.get('area') || 0, gridResultId: feature.get('grid_result_id'),
          techs: feature.get('techs') || {}, fClassDetails: buildFClassDetails(effectiveFClasses, totalDemand, totalPeak, props.f_class_demands ?? props.fclass_details),
          selectedFClass: extractSelectedFClass(props, effectiveFClasses, primaryFClass), ...enrichment,
        });
        setSelectedBuildingFeature(feature as Feature<Geometry>);
        setBuildingDialogOpen(true);
      }
    };

    const handlePointerMove = (evt: any) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f: any) => { const t = f.get('feature_type'); if (t === 'transformer' || t === 'building' || t === 'mv_line') return f; return null; }, { hitTolerance: 5 });
      if (!feature) { map.getTargetElement().style.cursor = ''; setTransformerTooltip(null); setBuildingTooltip(null); setMvLineTooltip(null); return; }
      map.getTargetElement().style.cursor = 'pointer';
      const type = feature.get('feature_type');
      if (type === 'transformer') { setTransformerTooltip(createTransformerTooltip(feature, evt.pixel, pylovoLayersRef.current)); setBuildingTooltip(null); setMvLineTooltip(null); }
      else if (type === 'building') { setBuildingTooltip(createBuildingTooltip(feature, evt.pixel)); setTransformerTooltip(null); setMvLineTooltip(null); }
      else if (type === 'mv_line') { setMvLineTooltip(createMvLineTooltip(feature, evt.pixel)); setTransformerTooltip(null); setBuildingTooltip(null); }
    };

    map.on('click', handleClick);
    map.on('pointermove', handlePointerMove);
    return () => { map.un('click', handleClick); map.un('pointermove', handlePointerMove); };
  }, [map, isDrawing, suppressMapInteractions]);

  const handleCloseTransformerDialog = useCallback(() => { setTransformerDialogOpen(false); setSelectedTransformer(null); }, [setTransformerDialogOpen, setSelectedTransformer]);
  const handleCloseBuildingDialog = useCallback(() => { setBuildingDialogOpen(false); setSelectedBuilding(null); setSelectedBuildingFeature(null); }, [setBuildingDialogOpen, setSelectedBuilding, setSelectedBuildingFeature]);

  return {
    transformerDialogOpen, setTransformerDialogOpen,
    selectedTransformer, setSelectedTransformer,
    transformerTooltip, setTransformerTooltip,
    buildingDialogOpen, setBuildingDialogOpen,
    selectedBuilding, setSelectedBuilding,
    selectedBuildingFeature, setSelectedBuildingFeature,
    buildingTooltip, setBuildingTooltip,
    mvLineTooltip, setMvLineTooltip,
    handleCloseTransformerDialog, handleCloseBuildingDialog,
  };
};
