import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PyPSAModelResults } from './api';
import { ModelInfo, StructuredModelResults } from './types';
import {
  transformToCapacityData,
  transformToCostBreakdown,
  transformToEnergyFlow,
} from '@/features/configurator/utils/transformUtils';
import { transformStructuredCostBreakdown } from '@/features/configurator/utils/costUtils';
import { Model } from '@/features/model-dashboard/services/modelService';
import { Workspace } from '@/components/workspace/services/workspaceService';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Calendar,
  Clock,
  Zap,
  TrendingUp,
  DollarSign,
  BarChart3,
  X,
  Building2,
  Network,
  LineChart,
  Sun,
  Gauge,
  ChevronDown,
  Check,
  FileBarChart,
  Activity,
  Info,
} from 'lucide-react';
import { useMapProvider } from '@/providers/map-context';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { initializeMap } from '@/features/interactive-map/utils/mapUtils';
import { useModelResultsMap, MapTooltipData } from '@/features/model-results/hooks/useModelResultsMap';
import {
  useClickOutside,
  useTurbineData,
  useCompletedModels,
  useModelData,
  WindTurbineInfo,
} from '@/features/model-results/hooks/useModelResultsData';
import { BuildingResultData, BusStatusData } from './components/map/ResultsMapTypes';
import MetricCard from './components/ui/MetricCard';
import OverviewPanel from './components/panels/OverviewPanel';
import EnergyPanel from './components/panels/EnergyPanel';
import GridPanel from './components/panels/GridPanel';
import BuildingDetailPanel from './components/panels/BuildingDetailPanel';
import CostPanel from './components/panels/CostPanel';
import SystemPanel from './components/panels/SystemPanel';
import { useTranslation } from '@spatialhub/i18n';
import { formatFClassLabel } from '@/features/configurator/utils/fClassUtils';
import { MapLibre3DOverlay } from '@/components/map-controls/maplibre';

type RightPanelView = 'overview' | 'energy' | 'cost' | 'grid' | 'system' | 'building';

// Extracted component: Map tooltip for transformer

// Extracted component: Model dropdown list item
interface ModelDropdownItemProps {
  model: Model;
  isSelected: boolean;
  onSelect: (model: Model) => void;
  style?: React.CSSProperties;
}

const ModelDropdownItem = ({ model, isSelected, onSelect, style }: ModelDropdownItemProps) => (
  <div style={style} className="px-1.5 py-0.5">
    <button
      onClick={() => onSelect(model)}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-all duration-150 text-left group text-sm hover:bg-muted text-foreground ${
        isSelected ? 'bg-muted' : ''
      }`}
    >
      <div className="flex items-center justify-center w-6 h-6 rounded transition-colors bg-muted">
        <FileBarChart className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
          {model.title}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {model.region && <span>{model.region}</span>}
          <span>•</span>
          <span>{new Date(model.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      {isSelected && (
        <Check className="w-4 h-4 text-foreground flex-shrink-0" />
      )}
    </button>
  </div>
);

// Calculate bus status data from PyPSA results
function calculateBusStatusData(pypsaData: PyPSAModelResults | null): BusStatusData[] {
  if (!pypsaData) return [];

  const voltageArray = pypsaData.voltage || pypsaData.buses_t_v_mag_pu || [];
  const powerArray = pypsaData.power || pypsaData.buses_t_p || [];

  // Group by location/bus
  const locationData = new Map<string, { voltages: number[]; powers: number[] }>();

  voltageArray.forEach(v => {
    const loc = v.location || v.bus;
    if (!loc) return;
    if (!locationData.has(loc)) {
      locationData.set(loc, { voltages: [], powers: [] });
    }
    locationData.get(loc)!.voltages.push(v.v_mag_pu);
  });

  powerArray.forEach(p => {
    if (!Number.isFinite(p.p) || Math.abs(p.p) > 1_000_000) return;
    const loc = p.location || p.bus;
    if (!loc) return;
    if (!locationData.has(loc)) {
      locationData.set(loc, { voltages: [], powers: [] });
    }
    locationData.get(loc)!.powers.push(p.p);
  });

  return Array.from(locationData.entries()).map(([location, data]) => {
    const avgVoltage = data.voltages.length > 0
      ? data.voltages.reduce((a, b) => a + b, 0) / data.voltages.length
      : 1;
    const avgPower = data.powers.length > 0
      ? data.powers.reduce((a, b) => a + b, 0) / data.powers.length
      : 0;

    // Determine status based on voltage levels
    let status: 'normal' | 'warning' | 'critical' = 'normal';
    if (avgVoltage < 0.95 || avgVoltage > 1.05) status = 'warning';
    if (avgVoltage < 0.9 || avgVoltage > 1.1) status = 'critical';

    return {
      bus: location,
      location,
      avgVoltage,
      avgPower,
      status,
    };
  });
}

// Format energy value with appropriate units
function formatEnergy(kwh: number): string {
  if (kwh >= 1000000) {
    return `${(kwh / 1000000).toFixed(2)} GWh`;
  } else if (kwh >= 1000) {
    return `${(kwh / 1000).toFixed(2)} MWh`;
  }
  return `${kwh.toFixed(1)} kWh`;
}

function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (!Number.isFinite(kw)) return '0';
  if (abs >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${kw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(kw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(kw * 1_000_000).toFixed(1)} mW`;
}

const FLOATING_POINT_EPSILON = 1e-6;

function normalizeDisplayValue(value: number, precision: number = 3): number {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
}

function isMonetaryCost(costType?: string): boolean {
  const normalized = (costType || '').toLowerCase();
  if (!normalized) return true;
  if (
    normalized.includes('monetary') ||
    normalized.includes('money') ||
    normalized.includes('eur') ||
    normalized.includes('euro')
  ) {
    return true;
  }
  if (
    normalized.includes('co2') ||
    normalized.includes('emission') ||
    normalized.includes('carbon') ||
    normalized.includes('ghg')
  ) {
    return false;
  }
  return true;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

// Calculate summary from structured results (uses server-side aggregates)
function calculateSummaryFromStructured(structured: StructuredModelResults) {
  const totalProduction = Math.abs(structured.sum_production || 0);
  const totalConsumption = Math.abs(structured.sum_consumption || 0);
  const renewableProduction = Math.abs(structured.renewable_production || 0);
  const gridImport = Math.abs(structured.grid_import || 0);
  const peakDemand = Math.abs(structured.peak_demand || 0);
  const timesteps = structured.timestep_count || 8760;

  const totalCost = structured.cost?.reduce((sum, c) => {
    if (!isMonetaryCost(c.costs)) return sum;
    return sum + Math.abs(c.value);
  }, 0) || 0;

  const structuredLcoe = (structured.model_total_levelised_cost || []).find((row) => {
    return (row.carrier || '').toLowerCase() === 'power' && isMonetaryCost(row.costs);
  });

  const selfSufficiencyRate = totalConsumption > 0
    ? normalizeDisplayValue(Math.min(1, renewableProduction / totalConsumption), 6)
    : 0;

  const totalSupply = renewableProduction + gridImport;
  const gridDependencyRate = totalSupply > 0
    ? normalizeDisplayValue(gridImport / totalSupply, 6)
    : 1;

  const lcoe = structuredLcoe
    ? Math.abs(structuredLcoe.value)
    : (renewableProduction > 0 ? totalCost / renewableProduction : 0);

  return {
    total_generation_kwh: totalProduction,
    total_demand_kwh: totalConsumption,
    renewable_production_kwh: renewableProduction,
    grid_import_kwh: gridImport,
    self_sufficiency_rate: selfSufficiencyRate,
    grid_dependency_rate: gridDependencyRate,
    peak_demand_kw: peakDemand,
    average_demand_kw: totalConsumption / timesteps,
    total_cost_eur: totalCost,
    lcoe_eur_kwh: lcoe,
    co2_savings_kg: renewableProduction * 0.4,
  };
}

// Calculate model configuration stats
interface ModelStats {
  totalBuildings: number;
  totalArea: number;
  windTurbineName: string | null;
  windTurbineCount: number;
  pvCount: number;
  pvTotalCapacityKw: number;
  transformerCount: number;
  technologies: { name: string; count: number }[];
}

// Helper to extract turbine ID from tech config
function extractTurbineId(techConfig: Record<string, unknown>): number | null {
  const constraints = techConfig.constraints as Array<{key: string; value: unknown}> | undefined;
  if (constraints) {
    const idConstraint = constraints.find(c => c.key === 'turbine_id');
    if (idConstraint) return Number(idConstraint.value);
  }
  if (techConfig.turbine_id) return Number(techConfig.turbine_id);
  return null;
}

// Helper to extract PV capacity from tech config
function extractPvCapacity(techConfig: Record<string, unknown>): number {
  const constraints = techConfig.constraints as Array<{key: string; value: unknown}> | undefined;
  const candidateKeys = ['cont_energy_cap_max', 'energy_cap_max', 'energy_cap', 'system_capacity'];

  if (constraints) {
    for (const key of candidateKeys) {
      const capConstraint = constraints.find(c => c.key === key);
      const numericValue = toFiniteNumber(capConstraint?.value);
      if (numericValue !== null) {
        return numericValue;
      }
    }
  }

  for (const key of candidateKeys) {
    const numericValue = toFiniteNumber(techConfig[key]);
    if (numericValue !== null) {
      return numericValue;
    }
  }

  return 0;
}

function calculateModelStats(model: ModelInfo, turbineData: Record<string, WindTurbineInfo>): ModelStats {
  const buildings = model.config?.buildings?.features || [];
  const transformers = model.config?.transformers?.features || [];
  
  // Reverse lookup: turbine_id -> name
  const turbineIdToName: Record<number, string> = {};
  Object.entries(turbineData).forEach(([name, info]) => {
    turbineIdToName[info.turbine_id] = name;
  });
  
  let totalArea = 0;
  let windTurbineName: string | null = null;
  let windTurbineCount = 0;
  let pvCount = 0;
  let pvTotalCapacityKw = 0;
  const techCounts: Record<string, number> = {};

  buildings.forEach(feature => {
    const props = feature.properties || {};
    if (typeof props.area === 'number') totalArea += props.area;
    
    const techs = props.techs as Record<string, unknown> | undefined;
    if (!techs) return;
    
    Object.keys(techs).forEach(techName => {
      techCounts[techName] = (techCounts[techName] || 0) + 1;
      const techConfig = techs[techName] as Record<string, unknown> | undefined;
      
      // Handle wind turbine
      if ((techName === 'wind_onshore' || techName === 'wind_supply')) {
        windTurbineCount++;
        if (techConfig && !windTurbineName) {
          const turbineId = extractTurbineId(techConfig);
          if (turbineId && turbineIdToName[turbineId]) {
            windTurbineName = turbineIdToName[turbineId];
          }
        }
      }
      
      // Handle PV
      if ((techName === 'pv_supply' || techName === 'pv')) {
        pvCount++;
        if (techConfig) pvTotalCapacityKw += extractPvCapacity(techConfig);
      }
    });
  });

  return {
    totalBuildings: buildings.length,
    totalArea,
    windTurbineName,
    windTurbineCount,
    pvCount,
    pvTotalCapacityKw,
    transformerCount: transformers.length,
    technologies: Object.entries(techCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export const ModelResultsViewer = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isFromAdmin = (location.state as { from?: string })?.from === 'admin';
  const modelId = id ? Number.parseInt(id, 10) : null;

  useDocumentTitle(t('results.title'), ' | EnerPlanET');

  // Map initialization
  const { mapRef, initMapInstance, MapControls } = useMapProvider();
  const { map } = useMapStore();
  const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');

  useEffect(() => {
    initializeMap(mapRef, initMapInstance, () => {});
  }, [mapRef, initMapInstance]);

  // Use custom hooks to reduce complexity
  const turbineData = useTurbineData();
  const {
    model,
    results,
    structuredResults,
    pypsaData,
    selectedBus,
    setSelectedBus,
    loading,
    error,
    initialWorkspace,
  } = useModelData(modelId);

  const [selectedBuilding, setSelectedBuilding] = useState<BuildingResultData | null>(null);
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>('overview');
  const [highlightedBuildings, setHighlightedBuildings] = useState<string[] | null>(null);
  const [mapTooltip, setMapTooltip] = useState<MapTooltipData | null>(null);

  // Workspace and model selector state
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(initialWorkspace);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownScrollRef = useRef<HTMLDivElement>(null);

  // Use custom hooks
  const { completedModels, isLoadingModels } = useCompletedModels(currentWorkspace);

  // Virtualizer for the model list
  const virtualizer = useVirtualizer({
    count: completedModels.length,
    getScrollElement: () => dropdownScrollRef.current,
    estimateSize: () => 52, // Height of ModelDropdownItem
    overscan: 5,
  });

  // Sync workspace from loaded model
  useEffect(() => {
    if (initialWorkspace) setCurrentWorkspace(initialWorkspace);
  }, [initialWorkspace]);

  const closeDropdown = useCallback(() => setIsModelDropdownOpen(false), []);
  useClickOutside(modelDropdownRef, isModelDropdownOpen, closeDropdown);

  // Handle workspace change
  const handleWorkspaceChange = useCallback((workspace: Workspace | null) => {
    setCurrentWorkspace(workspace);
  }, []);

  // Handle model selection
  const handleModelSelect = useCallback((selectedModel: Model) => {
    setIsModelDropdownOpen(false);
    if (selectedModel.id !== modelId) {
      navigate(`/app/model-results/${selectedModel.id}`);
    }
  }, [modelId, navigate]);

  // Handle building selection
  const handleBuildingSelect = useCallback((building: BuildingResultData | null) => {
    setSelectedBuilding(building);
    if (building) {
      setRightPanelView('building');
    }
  }, []);

  // Calculate derived data
  const capacityData = useMemo(() => (results ? transformToCapacityData(results, t) : []), [results, t]);
  const costBreakdown = useMemo(() => {
    if (structuredResults?.cost && structuredResults.cost.length > 0) {
      return transformStructuredCostBreakdown(structuredResults);
    }
    return results ? transformToCostBreakdown(results) : [];
  }, [structuredResults, results]);
  const energyFlow = useMemo(() => (results ? transformToEnergyFlow(results, t) : { nodes: [], links: [] }), [results, t]);

  // Buildings GeoJSON for MapLibre 3D overlay
  const buildingsGeoJSON = useMemo(() => {
    if (!model?.config?.buildings) return null;
    return model.config.buildings as GeoJSON.FeatureCollection;
  }, [model?.config?.buildings]);

  // Grid layers GeoJSON for MapLibre 3D overlay
  const linesGeoJSON = useMemo(() => {
    return (model?.config as any)?.lines ?? null;
  }, [(model?.config as any)?.lines]);

  const mvLinesGeoJSON = useMemo(() => {
    return (model?.config as any)?.mv_lines ?? null;
  }, [(model?.config as any)?.mv_lines]);

  const transformersGeoJSON = useMemo(() => {
    return (model?.config as any)?.transformers ?? null;
  }, [(model?.config as any)?.transformers]);

  // Calculate accurate summary
  const summary = useMemo(() => {
    if (structuredResults) {
      return calculateSummaryFromStructured(structuredResults);
    }
    return null;
  }, [structuredResults]);

  // Calculate model stats
  const modelStats = useMemo(() => {
    if (model) {
      return calculateModelStats(model, turbineData);
    }
    return null;
  }, [model, turbineData]);

  // PyPSA data for selected bus (memoized to avoid re-filtering on every render)
  const voltageArray = useMemo(() => pypsaData?.voltage || pypsaData?.buses_t_v_mag_pu || [], [pypsaData?.voltage, pypsaData?.buses_t_v_mag_pu]);
  const powerArray = useMemo(() => pypsaData?.power || pypsaData?.buses_t_p || [], [pypsaData?.power, pypsaData?.buses_t_p]);
  const selectedVoltage = useMemo(() => voltageArray.filter(v => v.location === selectedBus), [voltageArray, selectedBus]);
  const selectedPower = useMemo(() => powerArray.filter(p => p.location === selectedBus), [powerArray, selectedBus]);

  // Calculate bus status data
  const busStatusData: BusStatusData[] = useMemo(() => {
    return calculateBusStatusData(pypsaData);
  }, [pypsaData]);



  // Use shared map for model results visualization
  useModelResultsMap({
    model,
    results,
    onBuildingSelect: handleBuildingSelect,
    onTransformerHover: setHighlightedBuildings,
    onTooltipChange: setMapTooltip,
    busStatusData,
    showBusMarkers: rightPanelView === 'grid',
    highlightedBuildings,
  });

  
  const lineConnections = useMemo(() => {
    const energyCapData = results?.energy_cap || structuredResults?.energy_cap;
    if (!energyCapData || energyCapData.length === 0) return [];

    const connections: { bus0: string; bus1: string }[] = [];

    energyCapData.forEach((ec: any) => {
      const tech = ec.tech;
      const location = ec.location || ec.from_location;
      const toLoc = ec.to_loc || ec.to_location;

      // power_transmission records link buildings to transformers via to_loc field
      if (tech === 'power_transmission' && location && toLoc) {
        connections.push({
          bus0: location.replace(/^ID_/, ''), // "ID_1" → "1"
          bus1: toLoc, // "Trafo_36646"
        });
      }
    });

    return connections;
  }, [results?.energy_cap, structuredResults?.energy_cap]);

  // Average capacity factor — only for supply techs (PV, wind, etc.), not demand
  const supplyCapacity = capacityData.filter(d => d.type === 'supply');
  const avgCapacityFactor = supplyCapacity.length > 0
    ? supplyCapacity.reduce((sum, d) => sum + (d.installed_capacity_kw * d.capacity_factor), 0) /
      supplyCapacity.reduce((sum, d) => sum + d.installed_capacity_kw, 0)
    : 0;

  // Memoize panel content to reduce cognitive complexity
  const panelContent = useMemo(() => {
    if (selectedBuilding && modelId) {
      return (
        <BuildingDetailPanel
          building={selectedBuilding}
          modelId={modelId}
          turbineData={turbineData}
        />
      );
    }

    switch (rightPanelView) {
      case 'overview':
        return (
          <OverviewPanel
            summary={summary}
            capacityData={capacityData}
            costBreakdown={costBreakdown}
            energyFlow={energyFlow}
            avgCapacityFactor={avgCapacityFactor}
            simulationPeriod={model ? {
              from_date: model.from_date,
              to_date: model.to_date,
            } : null}
          />
        );
      case 'energy':
        return <EnergyPanel structuredResults={structuredResults} modelId={modelId} />;
      case 'cost':
        return (
          <CostPanel
            structuredResults={structuredResults}
            summary={summary}
            simulationPeriod={model ? {
              from_date: model.from_date,
              to_date: model.to_date,
              timestep_count: structuredResults?.timestep_count || 8760,
            } : null}
          />
        );
      case 'grid':
        return (
          <GridPanel
            pypsaData={pypsaData}
            selectedBus={selectedBus}
            setSelectedBus={setSelectedBus}
            selectedVoltage={selectedVoltage}
            selectedPower={selectedPower}
            onTransformerHover={setHighlightedBuildings}
            lineConnections={lineConnections}
            highlightedBuildings={highlightedBuildings}
          />
        );
      case 'system':
        return <SystemPanel structuredResults={structuredResults} modelId={modelId} />;
      default:
        return null;
    }
  }, [
    selectedBuilding, modelId, turbineData, rightPanelView, summary,
    capacityData, costBreakdown, energyFlow, avgCapacityFactor,
    structuredResults, pypsaData, selectedBus, setSelectedBus,
    selectedVoltage, selectedPower, lineConnections, highlightedBuildings,
  ]);

  if (error || (!model && !loading)) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">{t('results.unableToLoad')}</h2>
          <p className="text-muted-foreground mb-6">{error || t('results.modelNotFound')}</p>
          <button
            onClick={() => navigate('/app/model-dashboard')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            {t('results.backToDashboard')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-card border-b border-border flex-shrink-0">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(isFromAdmin ? '/app/admin-dashboard' : '/app/model-dashboard')}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>

              {!isFromAdmin && (
                <>
                  {/* Workspace Selector */}
                  <WorkspaceSelector
                    onWorkspaceChange={handleWorkspaceChange}
                    activeWorkspace={currentWorkspace}
                  />

                  {/* Model Selector Dropdown */}
                  <div className="relative" ref={modelDropdownRef}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                          className="flex items-center gap-2.5 px-3 py-2 bg-card border border-border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200"
                          disabled={isLoadingModels}
                        >
                          <div className="flex items-center justify-center w-6 h-6 bg-muted rounded">
                            <FileBarChart className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <span className="font-normal text-foreground max-w-[180px] truncate text-sm">
                            {isLoadingModels ? t('common.loading') : model?.title || t('results.selectModel')}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('results.selectModel')}</TooltipContent>
                    </Tooltip>

                    {/* Model Dropdown */}
                    {isModelDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1.5 w-80 bg-card border border-border rounded-lg shadow-lg z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-2 border-b border-border">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {t('results.completedSimulations')} {completedModels.length > 0 && `(${completedModels.length})`}
                          </span>
                        </div>
                        <div 
                          ref={dropdownScrollRef}
                          className="max-h-64 overflow-y-auto"
                        >
                          {completedModels.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              {isLoadingModels ? t('results.loadingModels') : t('results.noCompletedSimulations')}
                            </div>
                          ) : (
                            <div 
                              style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                width: '100%',
                                position: 'relative',
                              }}
                            >
                              {virtualizer.getVirtualItems().map((virtualRow) => (
                                <ModelDropdownItem
                                  key={completedModels[virtualRow.index].id}
                                  model={completedModels[virtualRow.index]}
                                  isSelected={completedModels[virtualRow.index].id === modelId}
                                  onSelect={handleModelSelect}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Model title when viewing from admin */}
              {isFromAdmin && model && (
                <span className="font-medium text-foreground text-sm truncate max-w-[240px]">
                  {model.title}
                </span>
              )}

              {/* Model Info */}
              {loading ? (
                <div className="space-y-2">
                  <div className="h-6 w-48 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                </div>
              ) : model && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground border-l border-border pl-4">
                  {model.region && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {model.region}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {new Date(model.from_date).toLocaleDateString()} -{' '}
                    {new Date(model.to_date).toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {model.resolution}h {t('results.resolution')}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Power Flow Convergence Status */}
              {structuredResults?.pypsa && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1.5 cursor-pointer ${
                        structuredResults.pypsa.converged
                          ? 'bg-white text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800'
                          : 'bg-white text-red-700 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      {structuredResults.pypsa.converged ? t('results.powerFlow.converged') : t('results.powerFlow.notConverged')}
                      <Info className="w-3.5 h-3.5 opacity-60" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
                    <p className="font-medium mb-1">
                      {structuredResults.pypsa.converged ? t('results.powerFlow.convergedTitle') : t('results.powerFlow.notConvergedTitle')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {structuredResults.pypsa.converged 
                        ? t('results.powerFlow.convergedDescription')
                        : t('results.powerFlow.notConvergedDescription')}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {model && (
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    model.status === 'completed'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                >
                  {t(`modelStatus.${model.status}`)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary Metrics Bar */}
        {!loading && summary && (() => {
          const simDays = model ? (() => {
            const from = new Date(model.from_date);
            const to = new Date(model.to_date);
            if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
              return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24) * 10) / 10;
            }
            return null;
          })() : null;
          const periodLabel = simDays ? `${t('results.metrics.over')} ${simDays} ${t('results.chartLabels.days')}` : undefined;
          const installedRenewable = supplyCapacity.length > 0
            ? formatPower(supplyCapacity.reduce((sum, d) => sum + d.installed_capacity_kw, 0))
            : undefined;
          return (
            <div className="px-6 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <MetricCard
                  icon={Zap}
                  label={t('results.metrics.totalDemand')}
                  value={formatEnergy(summary.total_demand_kwh)}
                  subtitle={periodLabel}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
                <MetricCard
                  icon={Sun}
                  label={t('results.metrics.renewableGen')}
                  value={formatEnergy(summary.renewable_production_kwh)}
                  subtitle={installedRenewable ? `${t('results.metrics.from')} ${installedRenewable} ${t('results.metrics.installed')}` : periodLabel}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
                <MetricCard
                  icon={Network}
                  label={t('results.metrics.gridImport')}
                  value={formatEnergy(summary.grid_import_kwh)}
                  subtitle={periodLabel}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
                <MetricCard
                  icon={TrendingUp}
                  label={t('results.metrics.selfSufficiency')}
                  value={`${(summary.self_sufficiency_rate * 100).toFixed(1)}%`}
                  subtitle={t('results.metrics.selfSufficiencyDesc')}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
                <MetricCard
                  icon={Gauge}
                  label={t('results.metrics.peakDemand')}
                  value={formatPower(summary.peak_demand_kw)}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
                <MetricCard
                  icon={DollarSign}
                  label={t('results.metrics.totalCost')}
                  value={`€${summary.total_cost_eur.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`}
                  subtitle={periodLabel ? `${t('results.metrics.equipmentAndRunning')} · ${periodLabel}` : t('results.metrics.equipmentAndRunning')}
                  color="text-foreground"
                  bgColor="bg-muted"
                />
              </div>
            </div>
          );
        })()}
      </header>

      {/* Main Content - Map LEFT, Charts/Details RIGHT */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Panel - Map (always visible) */}
        <div className="w-[35%] flex-shrink-0 border-r border-border relative">
          <div ref={mapRef} className="w-full h-full" />
          {map && <MapControls />}
          {map && isMapLibre3D && (
            <MapLibre3DOverlay
              olMap={map}
              buildingsGeoJSON={buildingsGeoJSON}
              linesGeoJSON={linesGeoJSON}
              mvLinesGeoJSON={mvLinesGeoJSON}
              transformersGeoJSON={transformersGeoJSON}
              visible={isMapLibre3D}
            />
          )}

          {/* Map Info Panel - shows on hover (tooltip) or click (selectedBuilding) */}
          {model && (
            <div className="absolute top-3 left-3 z-40 max-w-[280px]">
              {selectedBuilding ? (
                <div className="bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-lg shadow-lg px-2.5 py-1.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {selectedBuilding.fClass === 'Transformer' ? (
                        <img src="/images/transformer-icon-black.svg" alt="" className="w-3.5 h-3.5 dark:invert flex-shrink-0" />
                      ) : (
                        <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      )}
                      <span className="text-[11px] font-semibold text-foreground truncate">
                        {selectedBuilding.fClass === 'Transformer'
                          ? selectedBuilding.matchedLocationId || t('results.grid.transformer')
                          : `${t('results.building')} ${selectedBuilding.osmId || selectedBuilding.buildingId}`}
                      </span>
                      {selectedBuilding.fClasses?.length ? (
                        <span className="text-[10px] text-muted-foreground truncate">{selectedBuilding.fClasses.map(formatFClassLabel).join(', ')}</span>
                      ) : selectedBuilding.fClass ? (
                        <span className="text-[10px] text-muted-foreground">{formatFClassLabel(selectedBuilding.fClass)}</span>
                      ) : null}
                    </div>
                    <button
                      onClick={() => { setSelectedBuilding(null); setRightPanelView('overview'); }}
                      className="p-0.5 hover:bg-muted rounded transition-colors flex-shrink-0"
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                    {selectedBuilding.area != null && selectedBuilding.fClass !== 'Transformer' && (
                      <span><span className="text-muted-foreground">{t('results.buildingDetail.area', 'Area')}: </span><span className="font-semibold text-foreground">{selectedBuilding.area.toFixed(0)} m²</span></span>
                    )}
                    {selectedBuilding.yearlyDemandKwh != null && selectedBuilding.yearlyDemandKwh > 0 && (
                      <span><span className="text-muted-foreground">{t('results.buildingDetail.demand', 'Demand')}: </span><span className="font-semibold text-foreground">{selectedBuilding.yearlyDemandKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</span></span>
                    )}
                  </div>
                  {selectedBuilding.technologies.length > 0 && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {selectedBuilding.technologies.map(tech => tech.tech.replaceAll('_', ' ')).join(', ')}
                    </p>
                  )}
                </div>
              ) : mapTooltip ? (
                <div className="bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-lg shadow-lg px-2.5 py-1.5 space-y-1 pointer-events-none">
                  {mapTooltip.type === 'transformer' ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <img src="/images/transformer-icon-black.svg" alt="" className="w-3.5 h-3.5 dark:invert flex-shrink-0" />
                        <span className="text-[11px] font-semibold text-foreground">{mapTooltip.name || t('results.grid.transformer')}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                        {mapTooltip.powerKva && (
                          <span><span className="text-muted-foreground">Power: </span><span className="font-semibold text-foreground">{mapTooltip.powerKva} kVA</span></span>
                        )}
                        {mapTooltip.connectedBuildings != null && mapTooltip.connectedBuildings > 0 && (
                          <span><span className="text-muted-foreground">Buildings: </span><span className="font-semibold text-foreground">{mapTooltip.connectedBuildings}</span></span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                        <span className="text-[11px] font-semibold text-foreground">{mapTooltip.buildingType ? formatFClassLabel(mapTooltip.buildingType) : t('results.building')}</span>
                        {(mapTooltip.fClasses?.length ? mapTooltip.fClasses : mapTooltip.fClass ? [mapTooltip.fClass] : []).length > 0 && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {(mapTooltip.fClasses?.length ? mapTooltip.fClasses : [mapTooltip.fClass!]).map(formatFClassLabel).join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                        {mapTooltip.area != null && (
                          <span><span className="text-muted-foreground">{t('results.buildingDetail.area', 'Area')}: </span><span className="font-semibold text-foreground">{mapTooltip.area.toFixed(0)} m²</span></span>
                        )}
                        {mapTooltip.yearlyDemandKwh != null && mapTooltip.yearlyDemandKwh > 0 && (
                          <span><span className="text-muted-foreground">{t('results.buildingDetail.demand', 'Demand')}: </span><span className="font-semibold text-foreground">{mapTooltip.yearlyDemandKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</span></span>
                        )}
                      </div>
                      {mapTooltip.techs && Object.keys(mapTooltip.techs).length > 0 && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {Object.keys(mapTooltip.techs).map(t => t.replaceAll('_', ' ')).join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-background/90 dark:bg-gray-800/90 backdrop-blur-sm border border-border rounded-lg shadow-md px-3 py-2 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">{t('results.clickBuildingPrompt', 'Click on a building to view details')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Charts or Building Details */}
        <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                <p className="text-muted-foreground font-medium">{t('results.loadingResults')}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Panel Navigation */}
              <div className="flex-shrink-0 px-4 pt-3 bg-card border-b border-border">
            <div className="flex items-center justify-between">
              {/* Tabs */}
              <div className="flex gap-1">
                {[
                  { id: 'overview' as RightPanelView, label: t('results.tabs.overview'), icon: BarChart3 },
                  { id: 'energy' as RightPanelView, label: t('results.tabs.energy'), icon: LineChart },
                  { id: 'cost' as RightPanelView, label: t('results.tabs.cost'), icon: DollarSign },
                  { id: 'grid' as RightPanelView, label: t('results.tabs.grid'), icon: Network },
                  { id: 'system' as RightPanelView, label: t('results.tabs.system'), icon: Activity },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setRightPanelView(tab.id);
                      setSelectedBuilding(null);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                      rightPanelView === tab.id && !selectedBuilding
                        ? 'bg-background text-foreground border-t border-x border-border -mb-px'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
                {selectedBuilding && (
                  <div
                    className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg bg-background text-foreground border-t border-x border-border -mb-px"
                  >
                    <Building2 className="w-4 h-4" />
                    {selectedBuilding.fClass === 'Transformer' ? t('results.transformer') : `${t('results.building')} ${selectedBuilding.osmId || selectedBuilding.buildingId}`}
                    {selectedBuilding.area && (
                      <span className="text-xs text-muted-foreground ml-1">
                        {selectedBuilding.fClass === 'Transformer' ? `(${selectedBuilding.area} kVA)` : `(${selectedBuilding.area.toFixed(0)} m²)`}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setSelectedBuilding(null);
                        setRightPanelView('overview');
                      }}
                      className="ml-2 p-0.5 hover:bg-muted rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Summary Info - Right side */}
              {modelStats && !selectedBuilding && (
                <div className="flex items-center gap-3 text-sm text-foreground pr-2">
                  <span className="flex items-center gap-1.5">
                    <Building2 className="w-4 h-4" />
                    {modelStats.totalBuildings}
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className="flex items-center gap-1.5">
                    <img src="/images/transformer-icon-black.svg" alt="Transformer" className="w-4 h-4" />
                    {modelStats.transformerCount}
                  </span>
                </div>
              )}

            </div>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto">
            {panelContent}
          </div>
        </>
      )}
    </div>
      </div>
    </div>
  );
};
