import { useState, useMemo, useEffect } from 'react';
import { Activity, AlertTriangle, Zap, ArrowLeftRight, Info, Loader2 } from 'lucide-react';
import { StructuredModelResults, UnmetDemandRecord, ResourceConRecord, LineFlowRecord, TransformerFlowRecord, CarrierProdRecord, CarrierConRecord } from '../../types';
import { fetchCarrierTimeSeries, fetchSystemTimeSeries } from '../../api';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { 
  createCompactGrid, 
  createDataZoomWithStyle, 
  createBaseTooltip, 
  axisStyles, 
  gradients 
} from '@/features/simulation-charts/pypsa/chartUtils';
import { useTranslation } from '@spatialhub/i18n';


const InfoTooltip = ({ 
  title, 
  description, 
  items 
}: { 
  title: string; 
  description: string; 
  items?: { color: string; label: string; detail: string }[];
}) => {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
        aria-label={`${title} information`}
      >
        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{description}</div>
            {items && items.length > 0 && (
              <div className="space-y-2 text-xs">
                {items.map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${item.color}`}></span>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SystemPanelProps {
  structuredResults: StructuredModelResults | null;
  modelId: number | null;
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
const AMBER_PALETTE = ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#fbbf24', '#e0a30a', '#c48a08'];

const toDateKey = (timestamp: string): string => {
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = new Date(timestamp);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return timestamp;
};

/** Count unique timesteps per date and check if the last day is incomplete. */
const isLastDayIncomplete = (timesteps: string[]): string | null => {
  if (timesteps.length === 0) return null;
  const countPerDay = new Map<string, number>();
  for (const ts of timesteps) {
    const d = toDateKey(ts);
    countPerDay.set(d, (countPerDay.get(d) || 0) + 1);
  }
  const days = Array.from(countPerDay.keys()).sort();
  if (days.length < 2) return null;
  const lastDay = days[days.length - 1];
  const prevDay = days[days.length - 2];
  const lastCount = countPerDay.get(lastDay) || 0;
  const prevCount = countPerDay.get(prevDay) || 0;
  return prevCount > 0 && lastCount < prevCount * 0.5 ? lastDay : null;
};

const toDateLabel = (dateKey: string): string => {
  const parsed = new Date(dateKey);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  }
  return dateKey;
};

const toTimeLabel = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return timestamp;
};

const prettifyTech = (tech: string): string =>
  tech.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());

const techBase = (tech: string): string => tech.split(':', 1)[0].toLowerCase();

const isDemandTech = (tech: string): boolean => techBase(tech).endsWith('_demand');

const isGridImportTech = (tech: string): boolean => {
  const base = techBase(tech);
  return base === 'transformer_supply' || tech.toLowerCase().includes('transformer_supply');
};

const isRenewableTech = (tech: string): boolean => {
  const base = techBase(tech);
  return ['pv_supply', 'wind_onshore', 'water_supply', 'biomass_supply', 'geothermal_supply'].includes(base);
};

const formatPowerValue = (valueKw: number): string => {
  if (!Number.isFinite(valueKw)) return '0';
  const abs = Math.abs(valueKw);
  if (abs >= 1000) return `${(valueKw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${valueKw.toFixed(2)} kW`;
  if (abs >= 0.001) return `${(valueKw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(valueKw * 1_000_000).toFixed(1)} mW`;
};

const formatEnergyValue = (valueKwh: number): string => {
  if (!Number.isFinite(valueKwh)) return '0';
  const abs = Math.abs(valueKwh);
  if (abs >= 1_000_000) return `${(valueKwh / 1_000_000).toFixed(2)} GWh`;
  if (abs >= 1_000) return `${(valueKwh / 1_000).toFixed(2)} MWh`;
  if (abs >= 1) return `${valueKwh.toFixed(2)} kWh`;
  if (abs >= 0.001) return `${(valueKwh * 1000).toFixed(1)} Wh`;
  return `${(valueKwh * 1_000_000).toFixed(1)} mWh`;
};

const formatCurrencyValue = (value: number): string => {
  if (!Number.isFinite(value)) return '€0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `€${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `€${(value / 1_000).toFixed(2)}k`;
  if (abs >= 1) return `€${value.toFixed(2)}`;
  if (abs === 0) return '€0.00';
  return `€${value.toFixed(4)}`;
};

const formatShare = (value: number, total: number): string => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0%';
  const pct = (Math.abs(value) / total) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(1)}%`;
};

const SystemPanel = ({ structuredResults, modelId }: SystemPanelProps) => {
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const { t } = useTranslation();
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemLoaded, setSystemLoaded] = useState(false);
  const [unmetDemand, setUnmetDemand] = useState<UnmetDemandRecord[]>([]);
  const [resourceCon, setResourceCon] = useState<ResourceConRecord[]>([]);
  const [lineFlows, setLineFlows] = useState<LineFlowRecord[]>([]);
  const [trafoFlows, setTrafoFlows] = useState<TransformerFlowRecord[]>([]);
  const [carrierProd, setCarrierProd] = useState<CarrierProdRecord[]>([]);
  const [carrierCon, setCarrierCon] = useState<CarrierConRecord[]>([]);

  // Lazy-load system time-series data when this panel is first rendered
  useEffect(() => {
    if (!modelId || systemLoaded) return;

    const hasEmbeddedSystemData = Boolean(
      structuredResults?.system_balance?.length ||
      structuredResults?.unmet_demand?.length ||
      structuredResults?.resource_con?.length ||
      structuredResults?.line_flows?.length ||
      structuredResults?.trafo_flows?.length
    );

    if (hasEmbeddedSystemData) {
      const embeddedResults = structuredResults;
      if (embeddedResults) {
        setUnmetDemand(embeddedResults.unmet_demand || []);
        setResourceCon(embeddedResults.resource_con || []);
        setLineFlows(embeddedResults.line_flows || []);
        setTrafoFlows(embeddedResults.trafo_flows || []);
      }
    }

    const loadSystemData = async () => {
      setSystemLoading(true);
      try {
        const [systemData, carrierData] = await Promise.all([
          hasEmbeddedSystemData ? Promise.resolve(null) : fetchSystemTimeSeries(modelId),
          fetchCarrierTimeSeries(modelId),
        ]);

        if (systemData) {
          setUnmetDemand(systemData.unmet_demand || []);
          setResourceCon(systemData.resource_con || []);
          setLineFlows(systemData.line_flows || []);
          setTrafoFlows(systemData.trafo_flows || []);
        }

        if (carrierData) {
          setCarrierProd(carrierData.carrier_prod || []);
          setCarrierCon(carrierData.carrier_con || []);
        }
      } catch (err) {
        console.error('Failed to load system time series:', err);
      } finally {
        setSystemLoading(false);
        setSystemLoaded(true);
      }
    };

    loadSystemData();
  }, [modelId, systemLoaded, structuredResults]);

  const dailySupplyDemandData = useMemo(() => {
    if (!carrierProd.length && !carrierCon.length) return [];

    const dailyData = new Map<string, { date: string; renewable: number; grid: number; demand: number }>();
    const getEntry = (date: string) => {
      if (!dailyData.has(date)) {
        dailyData.set(date, { date, renewable: 0, grid: 0, demand: 0 });
      }
      return dailyData.get(date)!;
    };

    carrierProd.forEach((record) => {
      if (record.carrier !== 'power') return;

      const date = toDateKey(record.timestep);
      const entry = getEntry(date);
      const value = Math.abs(record.value);
      const tech = record.techs || '';

      if (isGridImportTech(tech)) {
        entry.grid += value;
      } else if (isRenewableTech(tech)) {
        entry.renewable += value;
      }
    });

    carrierCon.forEach((record) => {
      if (record.carrier !== 'power' || !isDemandTech(record.techs || '')) return;
      const date = toDateKey(record.timestep);
      const entry = getEntry(date);
      entry.demand += Math.abs(record.value);
    });

    const allTimesteps = [...carrierProd, ...carrierCon].map(r => r.timestep);
    const incompleteLast = isLastDayIncomplete(allTimesteps);

    return Array.from(dailyData.values())
      .filter(d => d.date !== incompleteLast)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [carrierCon, carrierProd]);

  const unmetDemandData = useMemo(() => {
    if (!unmetDemand.length) return [];

    const dailyData = new Map<string, { date: string; value: number }>();
    const incompleteLast = isLastDayIncomplete(unmetDemand.map(r => r.timestep));

    unmetDemand.forEach((record) => {
      if (record.carrier !== 'power') return;
      const date = toDateKey(record.timestep);
      if (date === incompleteLast) return;
      if (!dailyData.has(date)) {
        dailyData.set(date, { date, value: 0 });
      }
      dailyData.get(date)!.value += Math.abs(record.value);
    });

    return Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [unmetDemand]);

  const unmetDemandByLocation = useMemo(() => {
    if (!unmetDemand.length) return [];

    const byLocation = new Map<string, { totalKwh: number; peakKw: number; hoursAffected: number }>();

    unmetDemand.forEach((record) => {
      if (record.carrier !== 'power') return;
      const val = Math.abs(record.value);
      if (val < 1e-9) return;

      const loc = record.location;
      if (!byLocation.has(loc)) {
        byLocation.set(loc, { totalKwh: 0, peakKw: 0, hoursAffected: 0 });
      }
      const entry = byLocation.get(loc)!;
      entry.totalKwh += val;
      entry.peakKw = Math.max(entry.peakKw, val);
      entry.hoursAffected += 1;
    });

    return Array.from(byLocation.entries())
      .map(([location, stats]) => ({ location, ...stats }))
      .sort((a, b) => b.totalKwh - a.totalKwh);
  }, [unmetDemand]);

  const unmetDemandStacked = useMemo(() => {
    if (!unmetDemand.length) return { dates: [] as string[], locations: [] as string[], seriesData: {} as Record<string, number[]> };

    const locationSet = new Set<string>();
    const dailyByLocation = new Map<string, Map<string, number>>();
    const incompleteLast = isLastDayIncomplete(unmetDemand.map(r => r.timestep));

    unmetDemand.forEach((record) => {
      if (record.carrier !== 'power') return;
      const val = Math.abs(record.value);
      if (val < 1e-9) return;

      const date = toDateKey(record.timestep);
      if (date === incompleteLast) return;
      const loc = record.location;
      locationSet.add(loc);

      if (!dailyByLocation.has(date)) {
        dailyByLocation.set(date, new Map());
      }
      dailyByLocation.get(date)!.set(loc, (dailyByLocation.get(date)!.get(loc) || 0) + val);
    });

    const dates = Array.from(dailyByLocation.keys()).sort();

    // Sort locations by total unmet demand descending (matches unmetDemandByLocation order)
    const locationTotals = new Map<string, number>();
    locationSet.forEach(loc => {
      let total = 0;
      dailyByLocation.forEach(dayMap => { total += dayMap.get(loc) || 0; });
      locationTotals.set(loc, total);
    });
    const locations = Array.from(locationSet).sort((a, b) =>
      (locationTotals.get(b) || 0) - (locationTotals.get(a) || 0)
    );

    const seriesData: Record<string, number[]> = {};
    locations.forEach(loc => {
      seriesData[loc] = dates.map(date => dailyByLocation.get(date)?.get(loc) || 0);
    });

    return { dates, locations, seriesData };
  }, [unmetDemand]);

  const lines = useMemo(() => {
    if (!lineFlows.length) return [];
    const lineSet = new Set(lineFlows.map((f) => f.line));
    return Array.from(lineSet);
  }, [lineFlows]);

  const transformers = useMemo(() => {
    if (!trafoFlows.length) return [];
    const trafoSet = new Set(trafoFlows.map((f) => f.transformer));
    return Array.from(trafoSet);
  }, [trafoFlows]);

  
  const lineFlowData = useMemo(() => {
    if (!selectedLine) return [];

    const isTransformer = transformers.includes(selectedLine);

    if (isTransformer) {
      if (!trafoFlows.length) return [];
      return trafoFlows
        .filter((f) => f.transformer === selectedLine)
        .map((f) => ({
          timestep: f.timestep,
          p0: Math.abs(f.p0),
          p1: Math.abs(f.p1),
          loss: Math.max(0, Math.abs(f.p0) - Math.abs(f.p1)),
        }))
        .sort((a, b) => new Date(a.timestep).getTime() - new Date(b.timestep).getTime())
        .slice(0, 168);
    } else {
      if (!lineFlows.length) return [];
      return lineFlows
        .filter((f) => f.line === selectedLine)
        .map((f) => ({
          timestep: f.timestep,
          p0: Math.abs(f.p0),
          p1: Math.abs(f.p1),
          loss: Math.max(0, Math.abs(f.p0) - Math.abs(f.p1)),
        }))
        .sort((a, b) => new Date(a.timestep).getTime() - new Date(b.timestep).getTime())
        .slice(0, 168);
    }
  }, [selectedLine, lineFlows, trafoFlows, transformers]);

  const resourceByTech = useMemo(() => {
    if (!resourceCon.length) return [];
    const techTotals = new Map<string, number>();
    resourceCon.forEach((rc) => {
      techTotals.set(rc.tech, (techTotals.get(rc.tech) || 0) + Math.abs(rc.value));
    });
    return Array.from(techTotals.entries())
      .map(([tech, value]) => ({ tech, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [resourceCon]);

  const resourceTotal = useMemo(
    () => resourceByTech.reduce((sum, item) => sum + item.value, 0),
    [resourceByTech]
  );

  const investmentByTech = useMemo(() => {
    if (!structuredResults?.cost_investment?.length) return [];
    const techTotals = new Map<string, number>();
    structuredResults.cost_investment.forEach((ci) => {
      techTotals.set(ci.techs, (techTotals.get(ci.techs) || 0) + Math.abs(ci.value));
    });
    return Array.from(techTotals.entries())
      .map(([tech, value]) => ({ tech, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [structuredResults?.cost_investment]);

  const investmentTotal = useMemo(
    () => investmentByTech.reduce((sum, item) => sum + item.value, 0),
    [investmentByTech]
  );

  if (!structuredResults) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t('results.system.noData')}</p>
        </div>
      </div>
    );
  }

  if (systemLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">{t('results.system.loadingTimeSeries', 'Loading system data...')}</p>
        </div>
      </div>
    );
  }

  const hasDailySupplyDemand = dailySupplyDemandData.length > 0;
  const hasUnmetDemand = unmetDemandData.length > 0;
  const hasPositiveUnmetDemand = unmetDemandData.some((d) => d.value > 1e-9);
  const hasLineFlows = lines.length > 0 || transformers.length > 0;
  const hasResourceCon = resourceCon.length > 0;
  const hasCostInvestment = (structuredResults?.cost_investment?.length ?? 0) > 0;

  if (!hasDailySupplyDemand && !hasUnmetDemand && !hasLineFlows && !hasResourceCon && !hasCostInvestment) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t('results.system.noAnalysisData')}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('results.system.noAnalysisDataDesc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Daily Supply vs Demand */}
      {hasDailySupplyDemand && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            {t('results.system.dailySupplyDemand', 'Daily Supply vs Demand')}
            <InfoTooltip
              title={t('results.system.dailySupplyDemand', 'Daily Supply vs Demand')}
              description={t('results.system.dailySupplyDemandDesc', 'Daily renewable generation and grid import compared to total demand.')}
              items={[
                { color: 'bg-emerald-500', label: t('simulationComparison.metrics.renewableGen', 'Renewable'), detail: t('results.system.dailyRenewableDesc', 'Energy generated from renewable technologies per day.') },
                { color: 'bg-slate-500', label: t('simulationComparison.metrics.gridImport', 'Grid Import'), detail: t('results.system.dailyGridImportDesc', 'Energy imported from the transformer or grid connection per day.') },
                { color: 'bg-rose-500', label: t('simulationComparison.metrics.totalDemand', 'Demand'), detail: t('results.system.dailyDemandDesc', 'Total daily electricity demand across all loads.') },
              ]}
            />
          </h3>
          <ReactECharts
            option={
              {
                tooltip: {
                  ...createBaseTooltip(),
                  formatter: (params: { seriesName: string; marker: string; value: number; dataIndex: number }[]) => {
                    const dataIndex = params[0]?.dataIndex ?? 0;
                    const dateStr = dailySupplyDemandData[dataIndex]?.date;
                    const date = dateStr ? new Date(dateStr).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    }) : '';
                    const rows = params.map((param) => `
                      <div style="display: flex; justify-content: space-between; gap: 20px;">
                        <span>${param.marker} ${param.seriesName}</span>
                        <span style="font-weight: 600;">${formatEnergyValue(param.value)}</span>
                      </div>
                    `).join('');
                    return `<div style="font-weight: 600; margin-bottom: 8px;">${date}</div>${rows}`;
                  },
                },
                legend: {
                  bottom: 0,
                  textStyle: { fontSize: 11, color: '#6b7280' },
                },
                grid: {
                  ...createCompactGrid(),
                  bottom: 48,
                },
                xAxis: {
                  type: 'category',
                  data: dailySupplyDemandData.map((d) => toDateLabel(d.date)),
                  axisLine: axisStyles.line,
                  axisTick: axisStyles.hiddenTick,
                  axisLabel: {
                    ...axisStyles.label,
                    interval: Math.max(0, Math.floor(dailySupplyDemandData.length / 12) - 1),
                  },
                },
                yAxis: {
                  type: 'value',
                  name: t('results.system.energyKwh', 'Energy (kWh)'),
                  nameLocation: 'middle',
                  nameGap: 42,
                  nameTextStyle: { fontSize: 11, color: '#6b7280' },
                  axisLine: axisStyles.hiddenLine,
                  axisTick: axisStyles.hiddenTick,
                  axisLabel: {
                    ...axisStyles.label,
                    formatter: (value: number) => formatEnergyValue(value),
                  },
                  splitLine: axisStyles.splitLine,
                },
                dataZoom: createDataZoomWithStyle(),
                series: [
                  {
                    name: t('simulationComparison.metrics.renewableGen', 'Renewable'),
                    type: 'bar',
                    stack: 'supply',
                    barMaxWidth: 18,
                    itemStyle: { color: gradients.green, borderRadius: [4, 4, 0, 0] },
                    data: dailySupplyDemandData.map((d) => d.renewable),
                  },
                  {
                    name: t('simulationComparison.metrics.gridImport', 'Grid Import'),
                    type: 'bar',
                    stack: 'supply',
                    barMaxWidth: 18,
                    itemStyle: { color: '#64748b', borderRadius: [4, 4, 0, 0] },
                    data: dailySupplyDemandData.map((d) => d.grid),
                  },
                  {
                    name: t('simulationComparison.metrics.totalDemand', 'Demand'),
                    type: 'line',
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { width: 2, color: '#ef4444' },
                    itemStyle: { color: '#ef4444' },
                    data: dailySupplyDemandData.map((d) => d.demand),
                  },
                ],
              } as EChartsOption
            }
            style={{ height: 320 }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      )}

      {hasUnmetDemand && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {t('results.system.dailyUnmetDemand')}
            <InfoTooltip
              title={t('results.system.unmetDemand')}
              description={t('results.system.unmetDemandDesc')}
              items={[
                { color: 'bg-amber-500', label: t('results.system.unmetEnergy'), detail: t('results.system.unmetEnergyDesc') },
              ]}
            />
          </h3>
          {hasPositiveUnmetDemand ? (
            <>
              <ReactECharts
                option={
                  {
                    tooltip: {
                      ...createBaseTooltip(),
                      trigger: 'axis',
                      formatter: (params: any[]) => {
                        if (!Array.isArray(params)) return '';
                        const dataIndex = params[0]?.dataIndex ?? 0;
                        const dateStr = unmetDemandStacked.dates[dataIndex];
                        const date = dateStr ? new Date(dateStr).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                        }) : '';
                        let total = 0;
                        const rows = params
                          .filter((p: any) => p.value > 0)
                          .map((p: any) => {
                            total += p.value;
                            return `
                              <div style="display: flex; justify-content: space-between; gap: 20px;">
                                <span>${p.marker} ${p.seriesName}</span>
                                <span style="font-weight: 600;">${formatEnergyValue(p.value)}</span>
                              </div>
                            `;
                          }).join('');
                        return `
                          <div style="font-weight: 600; margin-bottom: 8px;">${date}</div>
                          ${rows}
                          ${params.length > 1 ? `
                            <div style="border-top: 1px solid rgba(128,128,128,0.2); margin-top: 6px; padding-top: 6px; display: flex; justify-content: space-between; gap: 20px;">
                              <span style="font-weight: 600;">Total</span>
                              <span style="font-weight: 700; color: #f59e0b;">${formatEnergyValue(total)}</span>
                            </div>
                          ` : ''}
                        `;
                      },
                    },
                    legend: {
                      bottom: 0,
                      textStyle: { fontSize: 11, color: '#6b7280' },
                    },
                    grid: {
                      ...createCompactGrid(),
                      bottom: unmetDemandStacked.locations.length > 1 ? 48 : 32,
                    },
                    xAxis: {
                      type: 'category',
                      data: unmetDemandStacked.dates.map(d => toDateLabel(d)),
                      axisLine: axisStyles.line,
                      axisTick: axisStyles.hiddenTick,
                      axisLabel: {
                        ...axisStyles.label,
                        interval: Math.max(0, Math.floor(unmetDemandStacked.dates.length / 12) - 1),
                      },
                    },
                    yAxis: {
                      type: 'value',
                      name: t('results.system.unmetKwh'),
                      nameLocation: 'middle',
                      nameGap: 35,
                      nameTextStyle: { fontSize: 11, color: '#6b7280' },
                      axisLine: axisStyles.hiddenLine,
                      axisTick: axisStyles.hiddenTick,
                      axisLabel: {
                        ...axisStyles.label,
                        formatter: (value: number) => formatEnergyValue(value),
                      },
                      splitLine: axisStyles.splitLine,
                    },
                    dataZoom: createDataZoomWithStyle(),
                    series: unmetDemandStacked.locations.map((loc, idx) => ({
                      name: loc,
                      type: 'line',
                      stack: 'unmet',
                      smooth: true,
                      symbol: 'circle',
                      symbolSize: 6,
                      showSymbol: false,
                      lineStyle: { width: 1.5, color: AMBER_PALETTE[idx % AMBER_PALETTE.length] },
                      itemStyle: { color: AMBER_PALETTE[idx % AMBER_PALETTE.length] },
                      areaStyle: {
                        color: {
                          type: 'linear',
                          x: 0, y: 0, x2: 0, y2: 1,
                          colorStops: [
                            { offset: 0, color: AMBER_PALETTE[idx % AMBER_PALETTE.length] + '4D' },
                            { offset: 1, color: AMBER_PALETTE[idx % AMBER_PALETTE.length] + '0D' },
                          ],
                        },
                      },
                      emphasis: { focus: 'series' },
                      data: unmetDemandStacked.seriesData[loc],
                    })),
                  } as EChartsOption
                }
                style={{ height: 280 }}
                opts={{ renderer: 'canvas' }}
              />

              {/* Affected Locations Table */}
              {unmetDemandByLocation.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    Affected Locations
                  </h4>
                  <div className="rounded-lg border border-amber-200/50 dark:border-amber-700/30 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-amber-50/50 dark:bg-amber-900/10">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Location</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total Unmet</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Peak</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmetDemandByLocation.slice(0, 10).map((item, idx) => (
                          <tr key={item.location} className="border-t border-border/50 hover:bg-amber-50/30 dark:hover:bg-amber-900/5">
                            <td className="px-3 py-2 font-medium text-foreground">
                              <span className="flex items-center gap-2">
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: AMBER_PALETTE[idx % AMBER_PALETTE.length] }}
                                />
                                <span className="truncate max-w-[200px]">{item.location}</span>
                              </span>
                            </td>
                            <td className="text-right px-3 py-2 font-semibold text-amber-600 dark:text-amber-400">
                              {formatEnergyValue(item.totalKwh)}
                            </td>
                            <td className="text-right px-3 py-2 text-foreground">
                              {formatPowerValue(item.peakKw)}
                            </td>
                            <td className="text-right px-3 py-2 text-foreground">
                              {item.hoursAffected}h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[260px] bg-emerald-50/30 dark:bg-emerald-900/10 rounded-xl border border-emerald-200/40 dark:border-emerald-700/30">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">No unmet demand for this run</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-1">All timesteps have 0.0 kWh unmet demand.</p>
            </div>
          )}
        </div>
      )}

      {hasLineFlows && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-primary" />
            {t('results.system.powerFlowAnalysis')}
            <InfoTooltip
              title={t('results.system.powerFlow')}
              description={t('results.system.powerFlowDesc')}
              items={[
                { color: 'bg-blue-500', label: t('results.system.p0Sending'), detail: t('results.system.p0SendingDesc') },
                { color: 'bg-emerald-500', label: t('results.system.p1Receiving'), detail: t('results.system.p1ReceivingDesc') },
                { color: 'bg-rose-500', label: t('results.system.loss'), detail: t('results.system.lossDesc') },
              ]}
            />
          </h3>

          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label htmlFor="line-selector" className="text-xs text-muted-foreground">{t('results.system.select')}:</label>
              <select
                id="line-selector"
                value={selectedLine || ''}
                onChange={(e) => setSelectedLine(e.target.value || null)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground min-w-[200px] focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">-- {t('results.system.selectLineOrTransformer')} --</option>
                {lines.length > 0 && (
                  <optgroup label={`🔌 ${t('results.system.transmissionLines')}`}>
                    {lines.map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </optgroup>
                )}
                {transformers.length > 0 && (
                  <optgroup label={`⚡ ${t('results.system.transformers')}`}>
                    {transformers.map((trafo) => (
                      <option key={trafo} value={trafo}>
                        {trafo}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Summary badges */}
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                {lines.length} {t('results.system.lines')}
              </span>
              <span className="px-2 py-1 text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                {transformers.length} {t('results.system.transformers')}
              </span>
            </div>
          </div>

          {selectedLine && lineFlowData.length > 0 ? (
            <ReactECharts
              option={
                {
                  tooltip: {
                    ...createBaseTooltip(),
                    formatter: (params: { marker: string; seriesName: string; value: number; dataIndex: number }[]) => {
                      const dataIndex = params[0]?.dataIndex ?? 0;
                      const ts = lineFlowData[dataIndex]?.timestep || '';
                      const label = toTimeLabel(ts);
                      const linesHtml = params.map((p) =>
                        `<div style="display:flex;justify-content:space-between;gap:20px;">
                          <span>${p.marker} ${p.seriesName}</span>
                          <span style="font-weight:600;">${formatPowerValue(p.value)}</span>
                        </div>`
                      ).join('');
                      return `<div style="font-weight: 600; margin-bottom: 8px;">${label}</div>${linesHtml}`;
                    },
                  },
                  legend: {
                    data: [t('results.system.p0Sending'), t('results.system.p1Receiving'), t('results.system.loss')],
                    bottom: 0,
                    itemWidth: 16,
                    itemHeight: 8,
                    icon: 'roundRect',
                    textStyle: { fontSize: 11, color: '#6b7280' },
                  },
                  grid: { left: 55, right: 20, top: 20, bottom: 50 },
                  xAxis: {
                    type: 'category',
                    data: lineFlowData.map((d) => toTimeLabel(d.timestep)),
                    axisLine: axisStyles.line,
                    axisTick: axisStyles.hiddenTick,
                    axisLabel: {
                      ...axisStyles.label,
                      interval: Math.max(0, Math.floor(lineFlowData.length / 8)),
                    },
                  },
                  yAxis: {
                    type: 'value',
                    name: t('results.system.balanceKw'),
                    nameLocation: 'middle',
                    nameGap: 40,
                    nameTextStyle: { fontSize: 11, color: '#6b7280' },
                    axisLine: axisStyles.hiddenLine,
                    axisTick: axisStyles.hiddenTick,
                    axisLabel: {
                      ...axisStyles.label,
                      formatter: (value: number) => formatPowerValue(value),
                    },
                    splitLine: axisStyles.splitLine,
                  },
                  series: [
                    {
                      name: t('results.system.p0Sending'),
                      type: 'line',
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 2.5, color: '#3b82f6' },
                      itemStyle: { color: '#3b82f6' },
                      data: lineFlowData.map((d) => d.p0),
                    },
                    {
                      name: t('results.system.p1Receiving'),
                      type: 'line',
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 2.5, color: '#10b981' },
                      itemStyle: { color: '#10b981' },
                      data: lineFlowData.map((d) => d.p1),
                    },
                    {
                      name: t('results.system.loss'),
                      type: 'line',
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 1.5, color: '#ef4444', type: 'dashed' },
                      itemStyle: { color: '#ef4444' },
                      areaStyle: {
                        color: {
                          type: 'linear',
                          x: 0, y: 0, x2: 0, y2: 1,
                          colorStops: [
                            { offset: 0, color: 'rgba(239, 68, 68, 0.15)' },
                            { offset: 1, color: 'rgba(239, 68, 68, 0.02)' },
                          ],
                        },
                      },
                      data: lineFlowData.map((d) => d.loss),
                    },
                  ],
                } as EChartsOption
              }
              style={{ height: 300 }}
              opts={{ renderer: 'canvas' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-[280px] bg-muted/20 rounded-xl border border-dashed border-border">
              <ArrowLeftRight className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t('results.system.selectLinePrompt')}</p>
              <p className="text-xs text-muted-foreground/70 mt-1">{t('results.system.selectLinePromptDesc')}</p>
            </div>
          )}
        </div>
      )}

      {hasResourceCon && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            {t('results.system.resourceConsumption')}
            <InfoTooltip
              title={t('results.system.resourceConsumption')}
              description={t('results.system.resourceConsumptionDesc')}
              items={[
                { color: 'bg-blue-500', label: t('results.system.primary'), detail: t('results.system.primaryDesc') },
                { color: 'bg-emerald-500', label: t('results.system.secondary'), detail: t('results.system.secondaryDesc') },
              ]}
            />
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              {resourceByTech.map((item, idx) => {
                const maxVal = resourceByTech[0]?.value || 1;
                const widthPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                return (
                  <div key={item.tech} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                        />
                        <span className="text-sm text-foreground font-medium truncate max-w-[220px]">
                          {prettifyTech(item.tech)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{formatShare(item.value, resourceTotal)}</span>
                        <span className="text-sm font-semibold text-foreground">{formatEnergyValue(item.value)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
                        style={{
                          width: `${widthPct}%`,
                          background: `linear-gradient(90deg, ${CHART_COLORS[idx % CHART_COLORS.length]}, ${CHART_COLORS[idx % CHART_COLORS.length]}99)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{t('results.system.totalConsumption')}</span>
                <span className="text-lg font-bold text-foreground">{formatEnergyValue(resourceTotal)}</span>
              </div>
            </div>

            <div className="bg-muted/20 rounded-xl border border-border p-3">
              <ReactECharts
                option={
                  {
                    tooltip: {
                      ...createBaseTooltip(),
                      formatter: (params: any) => {
                        const info = params.data || params;
                        const name = info.name || '';
                        const value = info.value ?? 0;
                        return `
                          <div style="font-weight: 600; margin-bottom: 6px;">${name}</div>
                          <div style="display:flex;justify-content:space-between;gap:16px;">
                            <span>${t('results.chartLabels.value')}:</span>
                            <span style="font-weight:600;">${formatEnergyValue(value)}</span>
                          </div>
                          <div style="display:flex;justify-content:space-between;gap:16px;">
                            <span>${t('results.chartLabels.share')}:</span>
                            <span style="font-weight:600;">${formatShare(value, resourceTotal)}</span>
                          </div>
                        `;
                      },
                    },
                    series: [
                      {
                        type: 'treemap',
                        width: '100%',
                        height: '100%',
                        roam: false,
                        nodeClick: false,
                        breadcrumb: { show: false },
                        label: {
                          show: true,
                          formatter: (params: any) => {
                            const pct = formatShare(params.value, resourceTotal);
                            return `{name|${params.name}}\n{value|${formatEnergyValue(params.value)}}\n{pct|${pct}}`;
                          },
                          rich: {
                            name: { fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 20 },
                            value: { fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
                            pct: { fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 16 },
                          },
                        },
                        upperLabel: { show: false },
                        itemStyle: {
                          borderColor: 'rgba(255,255,255,0.15)',
                          borderWidth: 2,
                          gapWidth: 2,
                        },
                        levels: [
                          {
                            itemStyle: { borderColor: 'rgba(255,255,255,0.3)', borderWidth: 3, gapWidth: 3 },
                          },
                        ],
                        data: resourceByTech.map((item, idx) => ({
                          name: prettifyTech(item.tech),
                          value: item.value,
                          itemStyle: {
                            color: CHART_COLORS[idx % CHART_COLORS.length],
                          },
                        })),
                      },
                    ],
                  } as EChartsOption
                }
                style={{ height: 280 }}
                opts={{ renderer: 'canvas' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Cost Investment Summary */}
      {hasCostInvestment && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            {t('results.system.investmentCosts')}
            <InfoTooltip
              title={t('results.system.investmentCosts')}
              description={t('results.system.investmentCostsDesc')}
              items={[
                { color: 'bg-blue-500', label: t('results.system.capex'), detail: t('results.system.capexDesc') },
              ]}
            />
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              {investmentByTech.map((item, idx) => {
                const maxVal = investmentByTech[0]?.value || 1;
                const widthPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                return (
                  <div key={item.tech} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                        />
                        <span className="text-sm text-foreground font-medium truncate max-w-[220px]">
                          {prettifyTech(item.tech)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{formatShare(item.value, investmentTotal)}</span>
                        <span className="text-sm font-semibold text-foreground">{formatCurrencyValue(item.value)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
                        style={{
                          width: `${widthPct}%`,
                          background: `linear-gradient(90deg, ${CHART_COLORS[idx % CHART_COLORS.length]}, ${CHART_COLORS[idx % CHART_COLORS.length]}99)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{t('results.system.totalInvestment')}</span>
                <span className="text-lg font-bold text-foreground">{formatCurrencyValue(investmentTotal)}</span>
              </div>
            </div>

            <div className="bg-muted/20 rounded-xl border border-border p-3">
              <ReactECharts
                option={
                  {
                    tooltip: {
                      ...createBaseTooltip(),
                      trigger: 'item',
                      formatter: (params: any) => {
                        return `
                          <div style="font-weight: 600; margin-bottom: 6px;">${params.name}</div>
                          <div style="display:flex;justify-content:space-between;gap:16px;">
                            <span>${t('results.chartLabels.amount')}:</span>
                            <span style="font-weight:600;">${formatCurrencyValue(params.value)}</span>
                          </div>
                          <div style="display:flex;justify-content:space-between;gap:16px;">
                            <span>${t('results.chartLabels.share')}:</span>
                            <span style="font-weight:600;">${formatShare(params.value, investmentTotal)}</span>
                          </div>
                        `;
                      },
                    },
                    legend: {
                      orient: 'horizontal',
                      bottom: 0,
                      itemWidth: 10,
                      itemHeight: 10,
                      icon: 'circle',
                      textStyle: { fontSize: 10, color: '#6b7280' },
                    },
                    series: [
                      {
                        type: 'pie',
                        roseType: 'area',
                        radius: ['20%', '70%'],
                        center: ['50%', '45%'],
                        itemStyle: {
                          borderRadius: 6,
                          borderColor: 'rgba(255,255,255,0.2)',
                          borderWidth: 2,
                        },
                        label: {
                          show: true,
                          formatter: (params: any) => {
                            return `{name|${params.name}}\n{pct|${formatShare(params.value, investmentTotal)}}`;
                          },
                          rich: {
                            name: { fontSize: 11, fontWeight: 600, lineHeight: 16 },
                            pct: { fontSize: 10, color: '#6b7280', lineHeight: 14 },
                          },
                        },
                        labelLine: {
                          length: 12,
                          length2: 8,
                        },
                        emphasis: {
                          itemStyle: {
                            shadowBlur: 12,
                            shadowOffsetX: 0,
                            shadowColor: 'rgba(0, 0, 0, 0.2)',
                          },
                          label: {
                            fontSize: 13,
                            fontWeight: 'bold',
                          },
                        },
                        animationType: 'scale',
                        animationEasing: 'elasticOut',
                        data: investmentByTech.map((item, idx) => ({
                          name: prettifyTech(item.tech),
                          value: item.value,
                          itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
                        })),
                      },
                    ],
                  } as EChartsOption
                }
                style={{ height: 280 }}
                opts={{ renderer: 'canvas' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemPanel;
