import { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Battery,
  Building2,
  DollarSign,
  Loader2,
  TrendingUp,
  TrendingDown,
  Zap,
  Scale,
  Layers,
  Ruler,
  Calendar,
  Users,
  Home,
  MapPin,
  Gauge,
  Sun,
} from 'lucide-react';
import { fetchLocationTimeSeries, LocationTimeSeriesData } from '../../api';
import { BuildingEnergyChart } from '@/features/simulation-charts/calliope';
import { BuildingResultData } from '../map/ResultsMapTypes';
import { CostAnalysisChart } from '@/features/simulation-charts/model-results';
import { useTranslation } from '@spatialhub/i18n';
import { formatFClassLabel, parseFClassValue } from '@/features/configurator/utils/fClassUtils';


interface WindTurbineInfo {
  nominal_power: number;
  hub_height: number[];
  rotor_diameter: number;
  turbine_id: number;
}

interface BuildingDetailPanelProps {
  building: BuildingResultData;
  modelId: number;
  turbineData?: Record<string, WindTurbineInfo>;
}

type BuildingTab = 'energy' | 'cost';

const getTechIcon = (techName: string): string | null => {
  if (techName.includes('pv')) return '/images/tech-icons/solar-panel.svg';
  if (techName.includes('wind')) return '/images/tech-icons/wind-turbine.svg';
  if (techName.includes('biomass')) return '/images/tech-icons/biomass.svg';
  if (techName.includes('geothermal')) return '/images/tech-icons/geothermal.svg';
  return null;
};

const getTechDisplayName = (techName: string, windTurbineName: string | null): string => {
  if (techName.includes('wind') && windTurbineName) return windTurbineName;
  if (techName.includes('pv')) return 'Solar PV';
  if (techName.includes('biomass')) return 'Biomass';
  if (techName.includes('geothermal')) return 'Geothermal';
  if (techName.includes('battery')) return 'Battery';
  return techName.replaceAll('_', ' ');
};

function formatEnergy(kwh: number): string {
  const abs = Math.abs(kwh);
  if (abs === 0) return '0 kWh';
  if (abs >= 1000000) return `${(kwh / 1000000).toFixed(2)} GWh`;
  if (abs >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  if (abs >= 1) return `${kwh.toFixed(1)} kWh`;
  return `${(kwh * 1000).toFixed(1)} Wh`;
}

function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (abs === 0) return '0 kW';
  if (abs >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${kw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(kw * 1000).toFixed(1)} W`;
  return `${(kw * 1_000_000).toFixed(1)} mW`;
}

const getEnergyLabelColor = (label: string): string => {
  const colors: Record<string, string> = {
    'A+++++': 'bg-green-700 text-white',
    'A++++': 'bg-green-700 text-white',
    'A+++': 'bg-green-600 text-white',
    'A++': 'bg-green-500 text-white',
    'A+': 'bg-green-400 text-white',
    'A': 'bg-green-500 text-white',
    'B': 'bg-lime-500 text-white',
    'C': 'bg-yellow-400 text-black',
    'D': 'bg-orange-400 text-white',
    'E': 'bg-orange-500 text-white',
    'F': 'bg-red-500 text-white',
    'G': 'bg-red-700 text-white',
  };
  return colors[label] || 'bg-muted text-muted-foreground';
};

const BuildingDetailPanel = ({ building, modelId, turbineData = {} }: BuildingDetailPanelProps) => {
  const [timeSeriesData, setTimeSeriesData] = useState<LocationTimeSeriesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<BuildingTab>('energy');
  const { t } = useTranslation();

  const turbineIdToName = useMemo(() => {
    const lookup: Record<number, string> = {};
    Object.entries(turbineData).forEach(([name, info]) => {
      lookup[info.turbine_id] = name;
    });
    return lookup;
  }, [turbineData]);

  const getWindTurbineName = (): string | null => {
    if (!building.techConfig) return null;
    const windKey = Object.keys(building.techConfig).find(k =>
      k.includes('wind') || k === 'wind_onshore'
    );
    if (!windKey) return null;
    const windConfig = building.techConfig[windKey] as Record<string, unknown> | undefined;
    if (!windConfig) return null;
    const constraints = windConfig.constraints as Array<{ key: string; value: unknown }> | undefined;
    let turbineId: number | null = null;
    if (constraints) {
      const idConstraint = constraints.find(c => c.key === 'turbine_id');
      if (idConstraint) turbineId = Number(idConstraint.value);
    } else if (windConfig.turbine_id) {
      turbineId = Number(windConfig.turbine_id);
    }
    if (turbineId && turbineIdToName[turbineId]) {
      return turbineIdToName[turbineId];
    }
    return null;
  };

  const windTurbineName = getWindTurbineName();

  useEffect(() => {
    const loadTimeSeries = async () => {
      if (!building.matchedLocationId) return;
      setLoading(true);
      try {
        const data = await fetchLocationTimeSeries(modelId, building.matchedLocationId);
        setTimeSeriesData(data);
      } catch (error) {
        console.error('Failed to load time series:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTimeSeries();
  }, [modelId, building.matchedLocationId]);

  const fClassLabels = useMemo(() => {
    const rawClasses =
      building.fClasses && building.fClasses.length > 0
        ? building.fClasses
        : parseFClassValue(building.fClass);
    return rawClasses.map(formatFClassLabel).filter(Boolean);
  }, [building.fClass, building.fClasses]);

  const isTransformer =
    building.fClass === 'Transformer' ||
    (building.fClasses ?? []).some((value) => value.toLowerCase() === 'transformer');

  const energyBalance = building.totalProduction - building.totalDemand;
  const isPositiveBalance = energyBalance >= 0;

  // Compute self-sufficiency for this building
  const selfSufficiency = building.totalDemand > 0
    ? Math.min(100, (building.totalProduction / building.totalDemand) * 100)
    : 0;

  // Compute total cost from time series data
  const totalCost = useMemo(() => {
    if (!timeSeriesData?.costs) return null;
    const sum = timeSeriesData.costs.reduce((acc, c) => acc + Math.abs(c.value), 0);
    return sum > 0 ? sum : null;
  }, [timeSeriesData?.costs]);

  // Building properties
  const floors = building.floors3dbag || building.levels;
  const heightVal = building.heightMax || building.height;
  const yearBuilt = building.constructionYear || building.yearBuilt;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              {isTransformer ? (
                <img src="/images/transformer-icon-black.svg" alt={t('results.grid.transformer')} className="w-6 h-6 dark:invert" />
              ) : (
                <Building2 className="w-6 h-6 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-foreground">
                {isTransformer
                  ? building.matchedLocationId || t('results.grid.transformer')
                  : `${t('results.buildingDetail.building')} ${building.osmId || building.buildingId}`}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {fClassLabels.map((label, idx) => (
                  <span
                    key={`${label}-${idx}`}
                    className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full"
                  >
                    {label}
                  </span>
                ))}
                {building.matchedLocationId && !isTransformer && (
                  <span className="px-2 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded-full flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {building.matchedLocationId}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Building Properties */}
        {!isTransformer && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {building.area != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.area', 'Area')}</p>
                    <p className="text-sm font-semibold text-foreground">{building.area.toFixed(0)} m²</p>
                  </div>
                </div>
              )}
              {floors != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.floors', 'Floors')}</p>
                    <p className="text-sm font-semibold text-foreground">{floors}</p>
                  </div>
                </div>
              )}
              {heightVal != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Ruler className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.height', 'Height')}</p>
                    <p className="text-sm font-semibold text-foreground">{heightVal.toFixed(1)} m</p>
                  </div>
                </div>
              )}
              {yearBuilt != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.yearBuilt', 'Built')}</p>
                    <p className="text-sm font-semibold text-foreground">{yearBuilt}</p>
                  </div>
                </div>
              )}
              {building.energyLabel && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Gauge className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.energyLabel', 'Energy Label')}</p>
                    <span className={`inline-block mt-0.5 font-bold px-2 py-0 rounded text-xs ${getEnergyLabelColor(building.energyLabel)}`}>
                      {building.energyLabel}
                    </span>
                  </div>
                </div>
              )}
              {building.cbsHouseholds != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Home className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.households', 'Households')}</p>
                    <p className="text-sm font-semibold text-foreground">{building.cbsHouseholds.toLocaleString()}</p>
                  </div>
                </div>
              )}
              {building.cbsPopulation != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{t('results.buildingDetail.population', 'Population')}</p>
                    <p className="text-sm font-semibold text-foreground">{building.cbsPopulation.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Energy Metrics */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" />
          {t('results.buildingDetail.energyOverview', 'Energy Overview')}
        </h4>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {building.yearlyDemandKwh != null && building.yearlyDemandKwh > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 border border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">{t('results.buildingDetail.yearlyDemand', 'Yearly Demand')}</span>
              </div>
              <p className="text-base font-bold text-foreground">{formatEnergy(building.yearlyDemandKwh)}</p>
              {building.peakLoadKw != null && building.peakLoadKw > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{t('results.buildingDetail.peak', 'Peak')}: {formatPower(building.peakLoadKw)}</p>
              )}
            </div>
          )}
          <div className="bg-muted/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">{t('results.buildingDetail.production')}</span>
            </div>
            <p className="text-base font-bold text-foreground">{formatPower(building.totalProduction)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">{t('results.buildingDetail.demand')}</span>
            </div>
            <p className="text-base font-bold text-foreground">{formatPower(building.totalDemand)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <Scale className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground">
                {t('results.buildingDetail.balance')}
              </span>
            </div>
            <p className="text-base font-bold text-foreground">
              {isPositiveBalance ? '+' : ''}{formatPower(energyBalance)}
            </p>
            {building.totalDemand > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {selfSufficiency.toFixed(1)}% {t('results.buildingDetail.selfSufficient', 'self-sufficient')}
              </p>
            )}
          </div>
        </div>

        {/* Cost summary (if available) */}
        {totalCost != null && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              {t('results.buildingDetail.totalCost', 'Total Cost')}
            </span>
            <span className="font-bold text-foreground">€{totalCost.toLocaleString('de-DE', { maximumFractionDigits: 0 })}</span>
          </div>
        )}
      </div>

      {/* Technologies */}
      {building.technologies.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5" />
            {t('results.buildingDetail.installedTechnologies', 'Installed Technologies')}
          </h4>
          <div className="space-y-2">
            {building.technologies.map((tech) => {
              const iconSrc = getTechIcon(tech.tech);
              const displayName = getTechDisplayName(tech.tech, windTurbineName);
              const isBattery = tech.tech.includes('battery');

              return (
                <div
                  key={tech.tech}
                  className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2.5 border border-border/50"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-background rounded-md border border-border/50">
                      {iconSrc ? (
                        <img src={iconSrc} alt={tech.tech} className="w-4 h-4" />
                      ) : isBattery ? (
                        <Battery className="w-4 h-4 text-foreground" />
                      ) : (
                        <Zap className="w-4 h-4 text-foreground" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-foreground">{displayName}</span>
                  </div>
                  <span className="text-sm font-bold text-foreground">
                    {isBattery ? `${tech.capacity.toFixed(1)} kWh` : formatPower(tech.capacity)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Energy / Cost Tabs */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {([
            { id: 'energy' as BuildingTab, label: t('results.buildingDetail.energyProfile'), icon: Activity },
            { id: 'cost' as BuildingTab, label: t('results.buildingDetail.costs'), icon: DollarSign },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-card text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground bg-muted/30'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {(() => {
            if (loading) {
              return (
                <div className="flex flex-col items-center justify-center h-[300px]">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mb-2" />
                  <p className="text-xs text-muted-foreground">{t('results.buildingDetail.loadingTimeSeries', 'Loading time series...')}</p>
                </div>
              );
            }
            if (activeTab === 'energy') {
              const hasEnergyData = building.matchedLocationId &&
                timeSeriesData &&
                (timeSeriesData.production?.length > 0 || timeSeriesData.consumption?.length > 0);
              if (hasEnergyData) {
                return (
                  <BuildingEnergyChart
                    production={timeSeriesData.production || []}
                    consumption={timeSeriesData.consumption || []}
                    expectedYearlyDemandKwh={building.yearlyDemandKwh}
                    height={300}
                  />
                );
              }
              return (
                <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                  <Activity className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">
                    {building.matchedLocationId
                      ? t('results.buildingDetail.noEnergyData')
                      : t('results.buildingDetail.noSimulationLinked')}
                  </p>
                </div>
              );
            }

            if (timeSeriesData?.costs && timeSeriesData.costs.length > 0) {
              return (
                <CostAnalysisChart
                  data={timeSeriesData.costs.map(c => ({
                    category: (c.techs || '').replaceAll('_', ' ').replaceAll(/\b\w/g, l => l.toUpperCase()),
                    value: c.value,
                  }))}
                  totalCost={timeSeriesData.costs.reduce((sum, c) => sum + c.value, 0)}
                  height={280}
                />
              );
            }
            return (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <DollarSign className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">{t('results.chartLabels.noCostData')}</p>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default BuildingDetailPanel;
