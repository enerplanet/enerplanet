import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map as OLMap, Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { pylovoService } from "@/features/configurator/services/pylovoService";
import type { PylovoGridData } from "@/features/configurator/types/area-select";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { toFiniteNumber } from "@/features/configurator/utils/parsing";
import {
  transformerStyleFunction, cableStyleFunction, mvLineStyleFunction,
  parsePoiClass, createBuildingStyleFunction,
} from "@/features/interactive-map/utils/mapStyleUtils";
import { normalizeFClass, getFeatureFClasses, getPrimaryFClass } from "@/features/configurator/utils/fClassUtils";
import { normalizeFClassToken } from "@/features/configurator/utils/buildingFeatureExtraction";
import { getDataProjection, loadBoundaryLayer, loadAvailableBoundaryLayers } from "@/features/configurator/utils/gridLayerUtils";
import { extractPeakLoadFromProps } from "@/features/configurator/utils/buildingFeatureExtraction";
import { extractYearlyDemandAll } from "@/features/configurator/utils/parsing";
import { estimateYearlyHeatDemand } from "@/features/configurator/utils/heatDemand";
import { buildFClassDetails, type FClassDetail } from "@/features/configurator/hooks/useAreaSelect/helpers/fClassDemand";
import { collectTransformerIds, normalizeGridLineAssignments, setFeatureColorIndex } from "@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments";

// Local aliases matching original useAreaSelect.ts
const extractPeakLoadKw = extractPeakLoadFromProps;
const extractYearlyDemandKwh = (props: Record<string, unknown>): number => extractYearlyDemandAll(props);

/**
 * Backfill a default heat demand onto a building feature based on its building
 * type (f-class × area), mirroring how the backend ships default electricity
 * demand per building type (demand_energy / yearly_demand_kwh). Only fills when
 * no explicit heat demand is present; zero-demand classes (shed/garage/…) resolve
 * to 0, which is a valid outcome — not every building is heated.
 */
const backfillDefaultHeatDemand = (feature: Feature<Geometry>): void => {
  const props = feature.getProperties() as Record<string, unknown>;
  if (props.demand_heat !== undefined || props.yearly_heat_demand_kwh !== undefined) return;
  const primary = getPrimaryFClass(props) || "unknown";
  const area = toFiniteNumber(props.area);
  if (!area || area <= 0) return;
  const heat = estimateYearlyHeatDemand(primary, area);
  feature.set("demand_heat", heat.kwh);
  feature.set("yearly_heat_demand_kwh", heat.kwh);
  feature.set("heat_demand_estimated", heat.estimated);
};

export const usePylovoLayers = ({ map, editMode, loadedConfig }: { map: OLMap | null, editMode: boolean, loadedConfig: any }) => {
  const pylovoGridData = useModelStore((s) => s.pylovoGridData);
  const setPylovoGridData = useModelStore((s) => s.setPylovoGridData);
  const isRunningPowerFlow = useModelStore((s) => s.isRunningPowerFlow);
  const setIsRunningPowerFlow = useModelStore((s) => s.setIsRunningPowerFlow);
  const powerFlowResults = useModelStore((s) => s.powerFlowResults);
  const setPowerFlowResults = useModelStore((s) => s.setPowerFlowResults);
  const regionBoundary = useModelStore((s) => s.regionBoundary);
  const setRegionBoundary = useModelStore((s) => s.setRegionBoundary);
  const availableBoundaryGeoJSON = useModelStore((s) => s.availableBoundaryGeoJSON);
  const setAvailableBoundaryGeoJSON = useModelStore((s) => s.setAvailableBoundaryGeoJSON);
  const availableRegions = useModelStore((s) => s.availableRegions);
  const setAvailableRegions = useModelStore((s) => s.setAvailableRegions);
  const showBoundary = useModelStore((s) => s.showBoundary);
  const toggleBoundary = useModelStore((s) => s.toggleBoundary);

  const pylovoLayersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const boundaryLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const availableBoundaryLayersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const unmountedRef = useRef(false);

  // Fetch available regions
  useEffect(() => {
    if (!map || !showBoundary) { setAvailableBoundaryGeoJSON(undefined); return; }
    const loadAvailableRegions = async () => {
      try {
        const response = await pylovoService.getAvailableRegions();
        if (response.status !== 'success' || !response.regions?.length) {
          setAvailableRegions([]); setAvailableBoundaryGeoJSON(undefined);
          availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer)); availableBoundaryLayersRef.current = []; return;
        }
        const regionsForLegend = response.regions.filter(r => r.region?.name).map(r => ({
          name: r.region!.name, gridCount: r.grid_count, country: r.region?.country,
          countryCode: r.region?.country_code || r.country_code, stateCode: r.region?.state_code || r.state_code,
          has3d: r.has_3d || false, bbox: r.bbox,
        }));
        setAvailableRegions(regionsForLegend);
        availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer)); availableBoundaryLayersRef.current = [];
        const boundaryRegions = response.regions.filter(r => r.boundary && r.region?.name).map(r => ({
          boundary: r.boundary!, name: r.region!.name, gridCount: r.grid_count,
          countryCode: r.region?.country_code || r.country_code, stateCode: r.region?.state_code || r.state_code,
        }));
        setAvailableBoundaryGeoJSON(boundaryRegions.length > 0 ? { type: 'FeatureCollection', features: boundaryRegions.map(r => ({ ...r.boundary, properties: { ...(r.boundary.properties ?? {}), name: r.name, grid_count: r.gridCount, _boundary_role: 'available' } })) } : undefined);
        if (boundaryRegions.length > 0) availableBoundaryLayersRef.current = loadAvailableBoundaryLayers(map, boundaryRegions);
      } catch {
        setAvailableBoundaryGeoJSON(undefined);
        availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer)); availableBoundaryLayersRef.current = [];
      }
    };
    loadAvailableRegions();
    return () => { availableBoundaryLayersRef.current.forEach(layer => map.removeLayer(layer)); availableBoundaryLayersRef.current = []; };
  }, [map, showBoundary]);

  const fetchBoundaryForGrid = useCallback(async (buildings: GeoJSON.FeatureCollection) => {
    if (!map || !showBoundary) return;
    const coords: [number, number][] = [];
    buildings.features.forEach(feature => {
      if (feature.geometry.type === 'Point') coords.push(feature.geometry.coordinates as [number, number]);
      else if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates[0]?.length > 0) coords.push(feature.geometry.coordinates[0][0] as [number, number]);
    });
    if (coords.length === 0) return;
    const centroidLon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const centroidLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    try {
      const br = await pylovoService.getBoundary(centroidLat, centroidLon, 4);
      if (br.status === 'success' && br.boundary && br.region) {
        setRegionBoundary({ name: br.region.name, boundary: br.boundary });
        if (map) boundaryLayerRef.current = loadBoundaryLayer(map, br.boundary, br.region.name);
      }
    } catch { /* non-critical */ }
  }, [map, showBoundary]);

  const createPylovoLayer = useCallback((geojson: any, featureType: string, zIndex: number, styleFunc: (f: Feature<Geometry>) => void, colorMap?: Map<number, number>) => {
    if (!map || !geojson?.features?.length) return null;
    const source = new VectorSource();
    const format = new GeoJSON();
    const dp = getDataProjection(geojson);
    const features = format.readFeatures(geojson, { dataProjection: dp, featureProjection: map.getView().getProjection() });
    features.forEach((f: Feature<Geometry>) => { f.set('feature_type', featureType); if (colorMap) setFeatureColorIndex(f, colorMap); styleFunc(f); });
    source.addFeatures(features);
    const layer = new VectorLayer({ source, zIndex });
    map.addLayer(layer);
    return layer;
  }, [map]);

  const runPowerFlowAnalysis = useCallback(async (loadScaling: number = 1): Promise<boolean> => {
    const gridResultIds = new Set<number>();
    const buildingsByGrid = new Map<number, string[]>();
    if (pylovoGridData?.grids) (pylovoGridData.grids as Array<{ grid_result_id?: number }>).forEach(g => { const id = toFiniteNumber(g.grid_result_id); if (id !== null) gridResultIds.add(id); });
    if (pylovoGridData?.transformers?.features) pylovoGridData.transformers.features.forEach((f: any) => { const id = toFiniteNumber(f.properties?.grid_result_id ?? f.properties?.transformer_id ?? f.properties?.trafo_id); if (id !== null) gridResultIds.add(id); });
    if (pylovoGridData?.buildings?.features) pylovoGridData.buildings.features.forEach((f: any) => { const id = toFiniteNumber(f.properties?.grid_result_id ?? f.properties?.transformer_id ?? f.properties?.trafo_id); const osm = f.properties?.osm_id; if (id !== null) { gridResultIds.add(id); if (osm) { const e = buildingsByGrid.get(id) || []; e.push(String(osm)); buildingsByGrid.set(id, e); } } });
    if (gridResultIds.size === 0) return false;
    setIsRunningPowerFlow(true);
    const results = new Map<number, any>();
    try {
      for (const gid of Array.from(gridResultIds)) {
        try { const r = await pylovoService.runPowerFlow(gid, loadScaling, buildingsByGrid.get(gid)); if (r.converged || (r.results?.lines?.length ?? 0) > 0) results.set(gid, r); } catch { /* skip */ }
      }
      setPowerFlowResults(results);
      pylovoLayersRef.current.forEach(layer => {
        const src = layer.getSource(); if (!src) return;
        src.getFeatures().forEach((f: Feature<Geometry>) => {
          const ft = f.get('feature_type'); const gid = toFiniteNumber(f.get('grid_result_id') ?? f.get('transformer_id') ?? f.get('trafo_id')); if (gid === null) return;
          const r = results.get(gid); if (!r) return;
          if (ft === 'cable' || ft === 'line') {
            const lr = r.results?.lines?.find((l: any) => l.line_id === f.get('line_id') || l.lines_result_id === f.get('lines_result_id') || l.name === f.get('name') || l.line_name === f.get('line_name'));
            if (lr) { f.set('loading_percent', lr.loading_percent); f.set('i_ka', lr.i_ka); f.set('p_from_mw', lr.p_from_mw); f.set('p_to_mw', lr.p_to_mw); }
          } else if (ft === 'transformer') {
            const tr = r.results?.transformers?.find((t: any) => { const trId = toFiniteNumber(t.trafo_id ?? t.id); const fId = toFiniteNumber(f.get('trafo_id') ?? f.get('id')); return (fId !== null && trId !== null && trId === fId) || (f.get('name') && t.name === f.get('name')); });
            if (tr) { f.set('loading_percent', tr.loading_percent); f.set('current_load_kw', tr.p_lv_mw * 1000); f.set('i_lv_ka', tr.i_lv_ka); }
          }
        }); src.changed();
      });
      // Sync to pylovoGridData for 3D layers
      setPylovoGridData((prev: any) => {
        if (!prev) return prev;
        let changed = false;
        const updLines = prev.lines?.features?.map((f: any) => { const p = f?.properties ?? {}; const gid = toFiniteNumber(p.grid_result_id ?? p.transformer_id ?? p.trafo_id); if (gid === null) return f; const r = results.get(gid); if (!r) return f; const lr = r.results?.lines?.find((l: any) => l.line_id === p.line_id || l.lines_result_id === p.lines_result_id || l.name === p.name || l.line_name === p.line_name); if (!lr) return f; if (toFiniteNumber(p.loading_percent) === toFiniteNumber(lr.loading_percent) && p.i_ka === lr.i_ka && p.p_from_mw === lr.p_from_mw && p.p_to_mw === lr.p_to_mw) return f; changed = true; return { ...f, properties: { ...p, loading_percent: lr.loading_percent, i_ka: lr.i_ka, p_from_mw: lr.p_from_mw, p_to_mw: lr.p_to_mw } }; });
        const updTrafos = prev.transformers?.features?.map((f: any) => { const p = f?.properties ?? {}; const gid = toFiniteNumber(p.grid_result_id ?? p.transformer_id ?? p.trafo_id); if (gid === null) return f; const r = results.get(gid); if (!r) return f; const tr = r.results?.transformers?.find((t: any) => { const trId = toFiniteNumber(t.trafo_id ?? t.id); const fId = toFiniteNumber(p.trafo_id ?? p.id); return (fId !== null && trId !== null && trId === fId) || (p.name && t.name === p.name); }); if (!tr) return f; const nlk = (toFiniteNumber(tr.p_lv_mw) ?? 0) * 1000; if (toFiniteNumber(p.loading_percent) === toFiniteNumber(tr.loading_percent) && toFiniteNumber(p.current_load_kw) === nlk && p.i_lv_ka === tr.i_lv_ka) return f; changed = true; return { ...f, properties: { ...p, loading_percent: tr.loading_percent, current_load_kw: nlk, i_lv_ka: tr.i_lv_ka } }; });
        if (!changed) return prev;
        return { ...prev, ...(updLines ? { lines: { ...prev.lines!, features: updLines } } : {}), ...(updTrafos ? { transformers: { ...prev.transformers!, features: updTrafos } } : {}) };
      });
      return true;
    } catch { return false; } finally { setIsRunningPowerFlow(false); }
  }, [pylovoGridData]);

  const processPylovoData = useCallback(async (data: PylovoGridData) => {
    if (!map || unmountedRef.current) return;
    const nd = normalizeGridLineAssignments(data);
    setPylovoGridData(nd);
    setPowerFlowResults(new Map());
    pylovoLayersRef.current.forEach(layer => map.removeLayer(layer)); pylovoLayersRef.current = [];
    const bIds = nd.buildings?.features ? collectTransformerIds(nd.buildings.features) : new Set<number>();
    const lIds = nd.lines?.features ? collectTransformerIds(nd.lines.features) : new Set<number>();
    const tIds = Array.from(new Set([...bIds, ...lIds])).sort((a, b) => a - b);
    const colorMap = new Map<number, number>(); tIds.forEach((id, i) => colorMap.set(id, i));
    const bLayer = createPylovoLayer(nd.buildings, 'building', 100, (f) => { f.set('parsed_class', parsePoiClass(f)); backfillDefaultHeatDemand(f); f.setStyle(createBuildingStyleFunction(true, false)); }, colorMap);
    if (bLayer) pylovoLayersRef.current.push(bLayer);
    if (nd.lines?.features?.length && map) {
      const src = new VectorSource(); const fmt = new GeoJSON();
      const feats = fmt.readFeatures(nd.lines, { dataProjection: getDataProjection(nd.lines), featureProjection: map.getView().getProjection() });
      feats.forEach((f: Feature<Geometry>) => { f.set('feature_type', 'cable'); setFeatureColorIndex(f, colorMap); }); src.addFeatures(feats);
      const layer = new VectorLayer({ source: src, style: (f) => cableStyleFunction(f as Feature<Geometry>), zIndex: 99 });
      map.addLayer(layer); pylovoLayersRef.current.push(layer);
    }
    if (nd.mv_lines?.features?.length && map) {
      const src = new VectorSource(); const fmt = new GeoJSON();
      const feats = fmt.readFeatures(nd.mv_lines, { dataProjection: getDataProjection(nd.mv_lines), featureProjection: map.getView().getProjection() });
      feats.forEach((f: Feature<Geometry>) => f.set('feature_type', 'mv_line')); src.addFeatures(feats);
      const layer = new VectorLayer({ source: src, style: (f) => mvLineStyleFunction(f as Feature<Geometry>), zIndex: 98 });
      map.addLayer(layer); pylovoLayersRef.current.push(layer);
    }
    if (nd.transformers?.features?.length && map) {
      const src = new VectorSource(); const fmt = new GeoJSON();
      const feats = fmt.readFeatures(nd.transformers, { dataProjection: getDataProjection(nd.transformers), featureProjection: map.getView().getProjection() });
      feats.forEach((f: Feature<Geometry>) => { f.set('feature_type', 'transformer'); setFeatureColorIndex(f, colorMap); }); src.addFeatures(feats);
      const layer = new VectorLayer({ source: src, style: (f, r) => transformerStyleFunction(f as Feature<Geometry>, r), zIndex: 102 });
      map.addLayer(layer); pylovoLayersRef.current.push(layer);
    }
    if (showBoundary && nd.buildings?.features?.length) fetchBoundaryForGrid(nd.buildings as GeoJSON.FeatureCollection);

    // One-time "how to add heat techs" prompt — fires once after grid data lands
    // (generation or edit-model load) so the user decides auto-assign vs manual
    // before hand-picking; never on rebuilds once a choice has been made.
    const storeState = useModelStore.getState();
    if ((nd.buildings?.features?.length ?? 0) > 0 && !storeState.heatBootstrapPrompted) {
      storeState.setHeatBootstrapOpen(true);
    }
  }, [map, showBoundary, fetchBoundaryForGrid, createPylovoLayer]);

  // Auto-run power flow debounce
  const lastGridDataRef = useRef(''); const pendingGridDataRef = useRef(''); const pfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hasB = (pylovoGridData?.buildings?.features?.length ?? 0) > 0;
    const bIds = pylovoGridData?.buildings?.features?.map((f: any) => f.properties?.osm_id).filter(Boolean).sort() || [];
    const tIds = pylovoGridData?.transformers?.features?.map((f: any) => { const p = f?.properties ?? {}; const gid = toFiniteNumber(p.grid_result_id ?? p.transformer_id ?? p.trafo_id); const kva = toFiniteNumber(p.rated_power_kva); return gid !== null ? `${gid}:${kva ?? ''}` : null; }).filter(Boolean).sort() || [];
    const key = JSON.stringify({ grids: pylovoGridData?.grids || [], buildings: bIds, transformers: tIds });
    if (!hasB) { if (pfTimerRef.current) clearTimeout(pfTimerRef.current); pfTimerRef.current = null; pendingGridDataRef.current = ''; return; }
    if (key === lastGridDataRef.current || key === pendingGridDataRef.current) return;
    if (pfTimerRef.current) { clearTimeout(pfTimerRef.current); pfTimerRef.current = null; }
    pendingGridDataRef.current = key;
    pfTimerRef.current = setTimeout(() => { const q = key; void (async () => { try { const ok = await runPowerFlowAnalysis(1); lastGridDataRef.current = ok ? q : ''; } finally { if (pendingGridDataRef.current === q) pendingGridDataRef.current = ''; pfTimerRef.current = null; } })(); }, 500);
  }, [pylovoGridData, runPowerFlowAnalysis]);
  useEffect(() => { return () => { if (pfTimerRef.current) clearTimeout(pfTimerRef.current); pendingGridDataRef.current = ''; }; }, []);
  useEffect(() => { unmountedRef.current = false; return () => { unmountedRef.current = true; if (map) { pylovoLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /* ignore */ } }); pylovoLayersRef.current = []; if (boundaryLayerRef.current) { try { map.removeLayer(boundaryLayerRef.current); } catch { /* ignore */ } boundaryLayerRef.current = null; } } }; }, [map]);
  useEffect(() => { if (editMode && loadedConfig) processPylovoData(loadedConfig as PylovoGridData).then(() => runPowerFlowAnalysis(1)); }, [editMode, loadedConfig, processPylovoData]);

  const updateTransformerKva = useCallback((gid: number, kva: number) => { pylovoLayersRef.current.forEach(layer => { const src = layer.getSource(); if (src) src.getFeatures().forEach((f: Feature<Geometry>) => { if (f.get('feature_type') === 'transformer' && f.get('grid_result_id') === gid) f.set('rated_power_kva', kva); }); }); }, []);
  const updateBuildingType = useCallback((osmId: string, t: string) => { const n = normalizeFClass(t) || t.trim().toLowerCase() || 'residential'; pylovoLayersRef.current.forEach(layer => { const src = layer.getSource(); if (src) src.getFeatures().forEach((f: Feature<Geometry>) => { if (f.get('feature_type') === 'building' && f.get('osm_id') === osmId) { f.set('type', n); f.set('f_class', n); f.set('f_classes', [n]); f.set('parsed_class', n); } }); }); }, []);
  const updateBuildingProperty = useCallback((osmId: string, key: string, val: unknown) => { pylovoLayersRef.current.forEach(layer => { const src = layer.getSource(); if (src) src.getFeatures().forEach((f: Feature<Geometry>) => { if (f.get('feature_type') === 'building' && f.get('osm_id') === osmId) f.set(key, val); }); }); }, []);
  const updateBuildingFClassDemand = useCallback((osmId: string, fClass: string, newDemand: number) => {
    pylovoLayersRef.current.forEach(layer => { const src = layer.getSource(); if (!src) return; src.getFeatures().forEach((f: Feature<Geometry>) => { if (f.get('feature_type') !== 'building' || f.get('osm_id') !== osmId) return; const nfc = normalizeFClassToken(fClass) || fClass; const props = f.getProperties() as Record<string, unknown>; const classes = getFeatureFClasses(props); if (!classes.includes(nfc)) f.set('f_classes', [...classes, nfc]); let details: FClassDetail[] = []; const stored = f.get('f_class_demands') ?? f.get('fclass_details'); if (stored) details = buildFClassDetails(getFeatureFClasses(props), extractYearlyDemandKwh(props), extractPeakLoadKw(props), stored); if (details.length === 0) { const fcs = getFeatureFClasses(props); details = buildFClassDetails(fcs.length > 0 ? fcs : [getPrimaryFClass(props) || 'unknown'], extractYearlyDemandKwh(props), extractPeakLoadKw(props)); } let updated = false; details = details.map(d => { const dc = normalizeFClassToken(d.fClass) || d.fClass; if (dc !== nfc) return d; updated = true; return { ...d, fClass: dc, yearlyDemandKwh: newDemand }; }); if (!updated) details.push({ fClass: nfc, yearlyDemandKwh: newDemand, peakLoadKw: 0 }); f.set('fclass_details', details); f.set('f_class_demands', details.map(d => ({ f_class: d.fClass, demand_energy: d.yearlyDemandKwh, peak_load_kw: d.peakLoadKw }))); const total = details.reduce((s, d) => s + d.yearlyDemandKwh, 0); f.set('yearly_demand_kwh', total); f.set('demand_energy', total); }); });
  }, []);

  return useMemo(() => ({
    pylovoGridData, setPylovoGridData, pylovoLayersRef, processPylovoData,
    updateTransformerKva, updateBuildingType, updateBuildingProperty, updateBuildingFClassDemand,
    runPowerFlowAnalysis, isRunningPowerFlow, powerFlowResults,
    regionBoundary, availableBoundaryGeoJSON,
    showBoundary, toggleBoundary, availableRegions,
  }), [
    pylovoGridData, setPylovoGridData, pylovoLayersRef, processPylovoData,
    updateTransformerKva, updateBuildingType, updateBuildingProperty, updateBuildingFClassDemand,
    runPowerFlowAnalysis, isRunningPowerFlow, powerFlowResults,
    regionBoundary, availableBoundaryGeoJSON, showBoundary, toggleBoundary, availableRegions,
  ]);
};
