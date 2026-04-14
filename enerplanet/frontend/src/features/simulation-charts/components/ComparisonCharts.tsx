import { FC, useCallback, useMemo, type ReactNode } from 'react';
import ReactECharts from 'echarts-for-react';
import { StructuredModelResults, CostRecord } from '@/features/model-results/types';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';

interface ComparisonChartsProps {
  results1: StructuredModelResults;
  results2: StructuredModelResults;
}

const TECH_KEYS = {
  solar: 'solar',
  wind: 'wind',
  biomass: 'biomass',
  geothermal: 'geothermal',
  storage: 'storage',
  grid: 'grid',
  other: 'other',
} as const;

const BASELINE_COLOR = '#3B82F6';
const COMPARISON_COLOR = '#F59E0B';
const FLOATING_POINT_EPSILON = 1e-6;

const COLORS: Record<string, string> = {
  solar: '#F59E0B',
  wind: '#22C55E',
  biomass: '#84CC16',
  geothermal: '#EF4444',
  storage: '#8B5CF6',
  grid: '#6B7280',
  other: '#9CA3AF',
};

const getColor = (key: string): string => COLORS[key] || COLORS.other;

const normalizeMetricValue = (value: number, precision: number = 3): number => {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
};

const formatPercentValue = (value: number, digits: number = 1): string => {
  const normalized = normalizeMetricValue(value, digits + 1);
  return `${normalized.toFixed(digits)}%`;
};

const normalizeTech = (raw: string): string => {
  return (raw || '').toLowerCase().split(':')[0].trim();
};

const isDemandOrTransmissionTech = (tech: string): boolean => {
  return tech.includes('demand') || tech.includes('transmission');
};

const isMonetaryCost = (costType?: string): boolean => {
  const normalized = (costType || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('monetary') || normalized.includes('money') || normalized.includes('eur') || normalized.includes('euro')) {
    return true;
  }
  if (normalized.includes('co2') || normalized.includes('emission') || normalized.includes('carbon') || normalized.includes('ghg')) {
    return false;
  }
  return true;
};

const mapTechCategory = (rawTech: string): string => {
  const tech = normalizeTech(rawTech);
  if (tech.includes('pv') || tech.includes('solar')) return TECH_KEYS.solar;
  if (tech.includes('wind')) return TECH_KEYS.wind;
  if (tech.includes('biomass')) return TECH_KEYS.biomass;
  if (tech.includes('geothermal')) return TECH_KEYS.geothermal;
  if (tech.includes('battery') || tech.includes('storage')) return TECH_KEYS.storage;
  if (tech.includes('transformer') || tech.includes('grid_import') || tech.includes('grid import') || tech.includes('grid_connection') || tech.includes('grid connection')) {
    return TECH_KEYS.grid;
  }
  return TECH_KEYS.other;
};

const getInstalledCapacityMix = (results: StructuredModelResults) => {
  const mix: Record<string, number> = {};

  results.energy_cap?.forEach((ec) => {
    const tech = normalizeTech(ec.tech);
    if (isDemandOrTransmissionTech(tech)) return;

    const category = mapTechCategory(tech);
    mix[category] = (mix[category] || 0) + Math.abs(ec.value);
  });

  return mix;
};

const getCostBreakdown = (results: StructuredModelResults) => {
  const costs: Record<string, number> = {};

  results.cost?.forEach((c: CostRecord) => {
    if (!isMonetaryCost(c.costs)) return;
    const category = mapTechCategory(c.techs || '');
    costs[category] = (costs[category] || 0) + Math.abs(c.value);
  });

  return costs;
};

const getInvestmentBreakdown = (results: StructuredModelResults) => {
  const inv: Record<string, number> = {};

  results.cost_investment?.forEach((c) => {
    if (!isMonetaryCost(c.costs)) return;
    const category = mapTechCategory(c.techs || '');
    inv[category] = (inv[category] || 0) + Math.abs(c.value);
  });

  return inv;
};

const getLcoeByTech = (results: StructuredModelResults) => {
  const lcoeMap = new Map<string, { sum: number; count: number }>();

  results.model_levelised_cost?.forEach((row) => {
    if (!isMonetaryCost(row.costs)) return;
    const category = mapTechCategory(row.techs || '');
    if (category === TECH_KEYS.other) return;

    const current = lcoeMap.get(category) || { sum: 0, count: 0 };
    current.sum += Math.abs(row.value);
    current.count += 1;
    lcoeMap.set(category, current);
  });

  const result: Record<string, number> = {};
  lcoeMap.forEach((value, key) => {
    if (value.count > 0) {
      result[key] = value.sum / value.count;
    }
  });

  return result;
};

const getCapacityFactorByTech = (results: StructuredModelResults) => {
  const cf: Record<string, number> = {};

  results.model_capacity_factor?.forEach((row) => {
    const category = mapTechCategory(row.techs || '');
    if (category === TECH_KEYS.other || category === TECH_KEYS.grid || category === TECH_KEYS.storage) return;
    cf[category] = Math.abs(row.value) * 100;
  });

  return cf;
};

const extractTotalCost = (results: StructuredModelResults): number => {
  let total = 0;
  results.cost?.forEach((c) => {
    if (!isMonetaryCost(c.costs)) return;
    total += Math.abs(c.value);
  });
  return total;
};

const extractTotalLcoe = (results: StructuredModelResults): number | null => {
  const powerRows = (results.model_total_levelised_cost || []).filter((row) => {
    return (row.carrier || '').toLowerCase() === 'power' && Number.isFinite(row.value) && isMonetaryCost(row.costs);
  });

  if (powerRows.length === 0) return null;

  const monetary = powerRows.find((row) => (row.costs || '').toLowerCase().includes('monetary'));
  const chosen = monetary || powerRows[0];
  return Math.abs(chosen.value);
};

interface ComparisonMetrics {
  renewableProduction: number;
  totalConsumption: number;
  gridImport: number;
  peakDemand: number;
  totalCost: number;
  selfSufficiency: number;
  gridDependency: number;
  lcoe: number;
}

const calculateMetrics = (results: StructuredModelResults): ComparisonMetrics => {
  const renewableProduction = Math.abs(results.renewable_production || 0);
  const totalConsumption = Math.abs(results.sum_consumption || 0);
  const gridImport = Math.abs(results.grid_import || 0);
  const totalCost = extractTotalCost(results);
  const peakDemand = Math.abs(results.peak_demand || 0);

  const lcoeFromStructured = extractTotalLcoe(results);
  const lcoeFallback = renewableProduction > 0 ? totalCost / renewableProduction : 0;

  const selfSufficiency = totalConsumption > 0
    ? normalizeMetricValue(Math.min(100, (renewableProduction / totalConsumption) * 100))
    : 0;

  const totalSupply = renewableProduction + gridImport;
  const gridDependency = totalSupply > 0
    ? normalizeMetricValue((gridImport / totalSupply) * 100)
    : 100;

  return {
    renewableProduction,
    totalConsumption,
    gridImport,
    peakDemand,
    totalCost,
    selfSufficiency,
    gridDependency,
    lcoe: lcoeFromStructured ?? lcoeFallback,
  };
};

const formatShortNumber = (value: number, decimals = 0): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(decimals)}k`;
  return value.toFixed(decimals);
};

const SectionHeader: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="bg-muted rounded-lg px-4 py-2 text-center text-xs font-semibold text-foreground sm:text-sm border border-border">
    {children}
  </div>
);

const ChartCard: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
    <div className="p-6">{children}</div>
  </div>
);

export const ComparisonCharts: FC<ComparisonChartsProps> = ({ results1, results2 }) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();

  const metrics1 = useMemo(() => calculateMetrics(results1), [results1]);
  const metrics2 = useMemo(() => calculateMetrics(results2), [results2]);

  const baselineLabel = t('simulationComparison.baseline');
  const comparisonLabel = t('simulationComparison.comparison');

  const translateTech = useCallback((key: string): string => t(`simulationComparison.technologies.${key}`, key), [t]);

  const energyCoverageOption = useMemo(() => {
    const selfSuffKey = t('simulationComparison.metrics.selfSufficiency', 'Self-Sufficiency');

    return {
      title: {
        text: t('simulationComparison.charts.energySupplyDemandCoverage', 'Energy Supply vs Demand'),
        subtext: t('simulationComparison.charts.renewableGridDemand', 'Renewable + Grid supply compared to demand'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
        padding: [0, 0, 0, 0],
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const label = params[0]?.axisValue;
          let html = `<strong style="color: ${themeColors.text}">${label}</strong><br/>`;
          params.forEach((p) => {
            const unit = p.seriesName === selfSuffKey ? '%' : 'kWh';
            const val = unit === '%' ? p.value.toFixed(1) : formatShortNumber(p.value, 1);
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: ${val} ${unit}</span><br/>`;
          });
          return html;
        },
      },
      legend: {
        bottom: 0,
        data: [
          t('simulationComparison.metrics.renewableGen', 'Renewable'),
          t('simulationComparison.metrics.gridImport', 'Grid Import'),
          t('simulationComparison.metrics.totalDemand', 'Demand'),
          selfSuffKey,
        ],
        textStyle: { color: themeColors.textMuted, fontSize: 11 },
      },
      grid: { left: '3%', right: '5%', bottom: '16%', top: '22%', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: [baselineLabel, comparisonLabel],
        axisLabel: { color: themeColors.textSubtle },
      },
      yAxis: [
        {
          type: 'value' as const,
          name: 'kWh',
          nameTextStyle: { color: themeColors.textMuted, fontSize: 10, padding: [0, 0, 0, 30] },
          nameLocation: 'end' as const,
          splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
          axisLabel: {
            color: themeColors.textSubtle,
            formatter: (value: number) => formatShortNumber(value),
          },
        },
        {
          type: 'value' as const,
          name: '%',
          max: 100,
          nameTextStyle: { color: themeColors.textMuted, fontSize: 10, padding: [0, 30, 0, 0] },
          nameLocation: 'end' as const,
          splitLine: { show: false },
          axisLabel: { color: themeColors.textSubtle, formatter: (value: number) => formatPercentValue(value, 0) },
        },
      ],
      series: [
        {
          name: t('simulationComparison.metrics.renewableGen', 'Renewable'),
          type: 'bar' as const,
          stack: 'supply',
          barWidth: '34%',
          itemStyle: { color: '#22C55E', borderRadius: [4, 4, 0, 0] },
          data: [metrics1.renewableProduction, metrics2.renewableProduction],
        },
        {
          name: t('simulationComparison.metrics.gridImport', 'Grid Import'),
          type: 'bar' as const,
          stack: 'supply',
          barWidth: '34%',
          itemStyle: { color: '#6B7280', borderRadius: [4, 4, 0, 0] },
          data: [metrics1.gridImport, metrics2.gridImport],
        },
        {
          name: t('simulationComparison.metrics.totalDemand', 'Demand'),
          type: 'line' as const,
          yAxisIndex: 0,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: '#EF4444' },
          itemStyle: { color: '#EF4444' },
          data: [metrics1.totalConsumption, metrics2.totalConsumption],
        },
        {
          name: selfSuffKey,
          type: 'line' as const,
          yAxisIndex: 1,
          symbol: 'diamond',
          symbolSize: 8,
          lineStyle: { width: 2, type: 'dashed' as const, color: '#0EA5E9' },
          itemStyle: { color: '#0EA5E9' },
          data: [metrics1.selfSufficiency, metrics2.selfSufficiency],
        },
      ],
    };
  }, [metrics1, metrics2, t, baselineLabel, comparisonLabel, themeColors]);

  const capacityByTechOption = useMemo(() => {
    const cap1 = getInstalledCapacityMix(results1);
    const cap2 = getInstalledCapacityMix(results2);

    const allKeys = Array.from(new Set([...Object.keys(cap1), ...Object.keys(cap2)]))
      .sort((a, b) => ((cap1[b] || 0) + (cap2[b] || 0)) - ((cap1[a] || 0) + (cap2[a] || 0)));

    const translated = allKeys.map(translateTech);

    return {
      title: {
        text: t('simulationComparison.charts.installedCapacityByTechnology', 'Installed Capacity by Technology'),
        subtext: t('simulationComparison.charts.sideBySideComparison', 'Side-by-side comparison'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const tech = params[0]?.axisValue;
          let html = `<strong style="color: ${themeColors.text}">${tech}</strong><br/>`;
          params.forEach((p) => {
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: ${p.value.toFixed(1)} kW</span><br/>`;
          });
          return html;
        },
      },
      legend: {
        bottom: 0,
        data: [baselineLabel, comparisonLabel],
        textStyle: { color: themeColors.textMuted, fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '18%', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: translated,
        axisLabel: { fontSize: 10, rotate: 28, color: themeColors.textSubtle },
      },
      yAxis: {
        type: 'value' as const,
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: {
          color: themeColors.textSubtle,
          formatter: (value: number) => `${formatShortNumber(value)} kW`,
        },
      },
      series: [
        {
          name: baselineLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: BASELINE_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((key) => cap1[key] || 0),
        },
        {
          name: comparisonLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: COMPARISON_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((key) => cap2[key] || 0),
        },
      ],
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const costBreakdownOption = useMemo(() => {
    const cost1 = getCostBreakdown(results1);
    const cost2 = getCostBreakdown(results2);

    const allKeys = Array.from(new Set([...Object.keys(cost1), ...Object.keys(cost2)]))
      .sort((a, b) => ((cost1[b] || 0) + (cost2[b] || 0)) - ((cost1[a] || 0) + (cost2[a] || 0)));

    const totalLabel = t('simulationComparison.charts.total', 'Total');

    return {
      title: {
        text: t('simulationComparison.charts.totalCostBreakdown', 'Total Cost Breakdown'),
        subtext: t('simulationComparison.charts.monetaryCostsOnly', 'Monetary costs only'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          let total = 0;
          let html = `<strong style="color: ${themeColors.text}">${params[0].axisValue}</strong><br/>`;
          params.forEach((p) => {
            total += p.value;
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: €${p.value.toLocaleString()}</span><br/>`;
          });
          html += `<strong style="color: ${themeColors.text}">${totalLabel}: €${total.toLocaleString()}</strong>`;
          return html;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: themeColors.textMuted, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '18%', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: [baselineLabel, comparisonLabel],
        axisLabel: { color: themeColors.textSubtle },
      },
      yAxis: {
        type: 'value' as const,
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: {
          color: themeColors.textSubtle,
          formatter: (value: number) => value >= 1000 ? `€${(value / 1000).toFixed(0)}k` : `€${value.toFixed(0)}`,
        },
      },
      series: allKeys.map((key, idx) => ({
        name: translateTech(key),
        type: 'bar' as const,
        stack: 'total',
        barWidth: '52%',
        itemStyle: {
          color: getColor(key),
          borderRadius: idx === allKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0],
        },
        emphasis: { focus: 'series' as const },
        data: [cost1[key] || 0, cost2[key] || 0],
      })),
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const costDifferenceOption = useMemo(() => {
    const cost1 = getCostBreakdown(results1);
    const cost2 = getCostBreakdown(results2);
    const allKeys = Array.from(new Set([...Object.keys(cost1), ...Object.keys(cost2)]));

    const diffs = allKeys
      .map((key) => ({
        key,
        name: translateTech(key),
        baseline: cost1[key] || 0,
        comparison: cost2[key] || 0,
        diff: (cost2[key] || 0) - (cost1[key] || 0),
      }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const differenceLabel = t('simulationComparison.charts.difference', 'Difference');

    return {
      title: {
        text: t('simulationComparison.charts.costDifferenceByCategory', 'Cost Difference by Category'),
        subtext: t('simulationComparison.charts.comparisonVsBaseline', 'Comparison minus baseline'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const item = diffs[params[0].dataIndex];
          const sign = item.diff >= 0 ? '+' : '-';
          return `<strong style="color: ${themeColors.text}">${item.name}</strong><br/>
            <span style="color: ${themeColors.text}">${baselineLabel}: €${item.baseline.toFixed(0)}</span><br/>
            <span style="color: ${themeColors.text}">${comparisonLabel}: €${item.comparison.toFixed(0)}</span><br/>
            <strong style="color: ${themeColors.text}">${differenceLabel}: ${sign}€${Math.abs(item.diff).toFixed(0)}</strong>`;
        },
      },
      grid: { left: '3%', right: '10%', bottom: '3%', top: '18%', containLabel: true },
      xAxis: {
        type: 'value' as const,
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: {
          color: themeColors.textSubtle,
          formatter: (value: number) => {
            const sign = value >= 0 ? '+' : '-';
            const abs = Math.abs(value);
            return abs >= 1000 ? `${sign}€${(abs / 1000).toFixed(0)}k` : `${sign}€${abs.toFixed(0)}`;
          },
        },
      },
      yAxis: {
        type: 'category' as const,
        data: diffs.map((d) => d.name),
        axisLabel: { fontSize: 11, color: themeColors.textSubtle },
      },
      series: [
        {
          type: 'bar' as const,
          data: diffs.map((d) => ({
            value: d.diff,
            itemStyle: {
              color: d.diff >= 0 ? '#EF4444' : '#10B981',
              borderRadius: d.diff >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          })),
          label: {
            show: true,
            position: 'right' as const,
            formatter: (params: any) => {
              const val = Number(params.value || 0);
              const sign = val >= 0 ? '+' : '-';
              const abs = Math.abs(val);
              return abs >= 1000 ? `${sign}€${(abs / 1000).toFixed(1)}k` : `${sign}€${abs.toFixed(0)}`;
            },
            fontSize: 10,
            color: themeColors.textMuted,
          },
        },
      ],
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const gaugeOption = useMemo(() => {
    const maxLcoe = Math.max(metrics1.lcoe, metrics2.lcoe, 0.1) * 1.2;

    const buildGauge = (
      center: [string, string],
      color: string,
      value: number,
      name: string,
      max: number,
      formatter: string | ((v: number) => string),
      detailFontSize: number,
    ) => ({
      type: 'gauge' as const,
      center,
      radius: '62%',
      startAngle: 200,
      endAngle: -20,
      min: 0,
      max,
      progress: { show: true, width: 10, itemStyle: { color } },
      axisLine: { lineStyle: { width: 10, color: [[1, themeColors.gridLine]] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      title: { show: true, offsetCenter: [0, '78%'], fontSize: 10, color: themeColors.textMuted },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, '0%'],
        fontSize: detailFontSize,
        fontWeight: 600,
        formatter,
        color,
      },
      data: [{ value, name }],
    });

    return {
      title: {
        text: t('simulationComparison.charts.keyPerformanceIndicators', 'Key Performance Indicators'),
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
      },
      series: [
        buildGauge(
          ['14%', '58%'],
          BASELINE_COLOR,
          metrics1.selfSufficiency,
          t('simulationComparison.charts.selfSufficiencyBaseline', 'Baseline Self-Suff.'),
          100,
          (v: number) => formatPercentValue(v, 1),
          18,
        ),
        buildGauge(
          ['38%', '58%'],
          COMPARISON_COLOR,
          metrics2.selfSufficiency,
          t('simulationComparison.charts.selfSufficiencyComparison', 'Comparison Self-Suff.'),
          100,
          (v: number) => formatPercentValue(v, 1),
          18,
        ),
        buildGauge(
          ['62%', '58%'],
          '#8B5CF6',
          metrics1.lcoe,
          t('simulationComparison.charts.lcoeBaseline', 'Baseline LCOE'),
          maxLcoe,
          (v: number) => `€${v.toFixed(3)}/kWh`,
          13,
        ),
        buildGauge(
          ['86%', '58%'],
          '#A855F7',
          metrics2.lcoe,
          t('simulationComparison.charts.lcoeComparison', 'Comparison LCOE'),
          maxLcoe,
          (v: number) => `€${v.toFixed(3)}/kWh`,
          13,
        ),
      ],
    };
  }, [metrics1, metrics2, t, themeColors]);

  const investmentCostOption = useMemo(() => {
    const inv1 = getInvestmentBreakdown(results1);
    const inv2 = getInvestmentBreakdown(results2);

    const allKeys = Array.from(new Set([...Object.keys(inv1), ...Object.keys(inv2)]))
      .sort((a, b) => ((inv1[b] || 0) + (inv2[b] || 0)) - ((inv1[a] || 0) + (inv2[a] || 0)));

    return {
      title: {
        text: t('simulationComparison.charts.investmentCostComparison', 'Investment Cost Comparison'),
        subtext: t('simulationComparison.charts.capexByTechnology', 'CAPEX by technology'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const tech = params[0]?.axisValue;
          let html = `<strong style="color: ${themeColors.text}">${tech}</strong><br/>`;
          params.forEach((p) => {
            const val = p.value >= 1000 ? `€${(p.value / 1000).toFixed(1)}k` : `€${p.value.toFixed(0)}`;
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: ${val}</span><br/>`;
          });
          return html;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: themeColors.textMuted, fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '18%', containLabel: true },
      xAxis: { type: 'category' as const, data: allKeys.map(translateTech), axisLabel: { color: themeColors.textSubtle, fontSize: 11 } },
      yAxis: {
        type: 'value' as const,
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: { color: themeColors.textSubtle, formatter: (v: number) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v.toFixed(0)}` },
      },
      series: [
        {
          name: baselineLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: BASELINE_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => inv1[k] || 0),
        },
        {
          name: comparisonLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: COMPARISON_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => inv2[k] || 0),
        },
      ],
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const lcoeByTechOption = useMemo(() => {
    const lcoe1 = getLcoeByTech(results1);
    const lcoe2 = getLcoeByTech(results2);

    const allKeys = Array.from(new Set([...Object.keys(lcoe1), ...Object.keys(lcoe2)]))
      .sort((a, b) => Math.max(lcoe1[b] || 0, lcoe2[b] || 0) - Math.max(lcoe1[a] || 0, lcoe2[a] || 0));

    return {
      title: {
        text: t('simulationComparison.charts.lcoeByTechnology', 'LCOE by Technology'),
        subtext: t('simulationComparison.charts.levelisedCost', 'Levelised cost of energy (€/kWh)'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const tech = params[0]?.axisValue;
          let html = `<strong style="color: ${themeColors.text}">${tech}</strong><br/>`;
          params.forEach((p) => {
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: ${p.value.toFixed(3)} €/kWh</span><br/>`;
          });
          return html;
        },
      },
      legend: {
        bottom: 0,
        data: [baselineLabel, comparisonLabel],
        textStyle: { color: themeColors.textMuted, fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '18%', containLabel: true },
      xAxis: { type: 'category' as const, data: allKeys.map(translateTech), axisLabel: { color: themeColors.textSubtle, fontSize: 11 } },
      yAxis: {
        type: 'value' as const,
        name: '€/kWh',
        nameTextStyle: { color: themeColors.textMuted, fontSize: 10 },
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: { color: themeColors.textSubtle, formatter: (v: number) => `€${v.toFixed(2)}` },
      },
      series: [
        {
          name: baselineLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: BASELINE_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => lcoe1[k] || 0),
        },
        {
          name: comparisonLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: COMPARISON_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => lcoe2[k] || 0),
        },
      ],
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const capacityFactorOption = useMemo(() => {
    const cf1 = getCapacityFactorByTech(results1);
    const cf2 = getCapacityFactorByTech(results2);

    const allKeys = Array.from(new Set([...Object.keys(cf1), ...Object.keys(cf2)]))
      .sort((a, b) => Math.max(cf1[b] || 0, cf2[b] || 0) - Math.max(cf1[a] || 0, cf2[a] || 0));

    return {
      title: {
        text: t('simulationComparison.charts.capacityFactor', 'Capacity Factor Comparison'),
        subtext: t('simulationComparison.charts.utilizationByTech', 'Asset utilization by technology (%)'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any[]) => {
          const tech = params[0]?.axisValue;
          let html = `<strong style="color: ${themeColors.text}">${tech}</strong><br/>`;
          params.forEach((p) => {
            html += `<span style="color:${p.color}">●</span> <span style="color: ${themeColors.text}">${p.seriesName}: ${p.value.toFixed(1)}%</span><br/>`;
          });
          return html;
        },
      },
      legend: { bottom: 0, data: [baselineLabel, comparisonLabel], textStyle: { color: themeColors.textMuted, fontSize: 11 } },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '18%', containLabel: true },
      xAxis: { type: 'category' as const, data: allKeys.map(translateTech), axisLabel: { color: themeColors.textSubtle, fontSize: 11 } },
      yAxis: {
        type: 'value' as const,
        max: 100,
        name: '%',
        nameTextStyle: { color: themeColors.textMuted, fontSize: 10 },
        splitLine: { lineStyle: { type: 'dashed' as const, color: themeColors.gridLine } },
        axisLabel: { color: themeColors.textSubtle, formatter: (v: number) => `${v.toFixed(0)}%` },
      },
      series: [
        {
          name: baselineLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: BASELINE_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => cf1[k] || 0),
        },
        {
          name: comparisonLabel,
          type: 'bar' as const,
          barWidth: '35%',
          itemStyle: { color: COMPARISON_COLOR, borderRadius: [4, 4, 0, 0] },
          data: allKeys.map((k) => cf2[k] || 0),
        },
      ],
    };
  }, [results1, results2, t, baselineLabel, comparisonLabel, translateTech, themeColors]);

  const sankeyOption = useMemo(() => {
    const buildFlow = (metrics: ComparisonMetrics, label: string) => {
      const renewableNode = `${t('simulationComparison.metrics.renewableGen', 'Renewable')} (${label})`;
      const gridNode = `${t('simulationComparison.metrics.gridImport', 'Grid Import')} (${label})`;
      const supplyNode = `${t('simulationComparison.charts.totalSupply', 'Total Supply')} (${label})`;
      const demandNode = `${t('simulationComparison.metrics.totalDemand', 'Demand')} (${label})`;
      const surplusNode = `${t('simulationComparison.charts.surplus', 'Surplus')} (${label})`;
      const deficitNode = `${t('simulationComparison.charts.deficit', 'Deficit')} (${label})`;

      const nodes = [
        { name: renewableNode },
        { name: gridNode },
        { name: supplyNode },
        { name: demandNode },
      ];

      const links: { source: string; target: string; value: number }[] = [
        { source: renewableNode, target: supplyNode, value: Math.round(metrics.renewableProduction) },
        { source: gridNode, target: supplyNode, value: Math.round(metrics.gridImport) },
      ];

      const supply = metrics.renewableProduction + metrics.gridImport;
      const demand = metrics.totalConsumption;

      links.push({
        source: supplyNode,
        target: demandNode,
        value: Math.round(Math.min(supply, demand)),
      });

      if (supply > demand) {
        nodes.push({ name: surplusNode });
        links.push({ source: supplyNode, target: surplusNode, value: Math.round(supply - demand) });
      }

      if (demand > supply) {
        nodes.push({ name: deficitNode });
        links.push({ source: deficitNode, target: demandNode, value: Math.round(demand - supply) });
      }

      return { nodes, links };
    };

    const flow1 = buildFlow(metrics1, baselineLabel);
    const flow2 = buildFlow(metrics2, comparisonLabel);

    return {
      title: {
        text: t('simulationComparison.charts.energyFlowSankey', 'Energy Flow Comparison'),
        subtext: t('simulationComparison.charts.energyBalanceByScenario', 'Renewable + Grid supply to demand by scenario'),
        left: 'left',
        textStyle: { fontSize: 14, fontWeight: 600, color: themeColors.text },
        subtextStyle: { fontSize: 11, color: themeColors.textMuted },
      },
      tooltip: {
        trigger: 'item' as const,
        confine: true,
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any) => {
          if (params.dataType === 'edge') {
            return `<span style="color: ${themeColors.text}">${params.data.source} → ${params.data.target}: ${formatShortNumber(params.data.value, 1)} kWh</span>`;
          }
          return `<strong style="color: ${themeColors.text}">${params.name}</strong>`;
        },
      },
      series: [
        {
          type: 'sankey' as const,
          top: 60,
          bottom: 40,
          left: 20,
          right: 120,
          nodeGap: 14,
          nodeWidth: 12,
          data: [...flow1.nodes, ...flow2.nodes],
          links: [...flow1.links, ...flow2.links],
          orient: 'horizontal' as const,
          nodeAlign: 'justify' as const,
          lineStyle: { color: 'gradient' as const, curveness: 0.5, opacity: 0.4 },
          itemStyle: { borderWidth: 1, borderColor: themeColors.gridLine },
          label: { color: themeColors.text, fontSize: 10, overflow: 'truncate' as const, width: 140 },
          emphasis: { focus: 'adjacency' as const },
        },
      ],
    };
  }, [metrics1, metrics2, t, baselineLabel, comparisonLabel, themeColors]);

  const hasInvestmentData = (results1.cost_investment?.length || 0) > 0 || (results2.cost_investment?.length || 0) > 0;
  const hasLcoeData = (results1.model_levelised_cost?.length || 0) > 0 || (results2.model_levelised_cost?.length || 0) > 0;
  const hasCFData = (results1.model_capacity_factor?.length || 0) > 0 || (results2.model_capacity_factor?.length || 0) > 0;

  return (
    <div className="space-y-6">
      <SectionHeader>
        {t('simulationComparison.charts.energyCapacityAnalysis', 'Energy & Capacity Analysis')}
      </SectionHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard>
          <ReactECharts option={energyCoverageOption} style={{ height: '360px' }} />
        </ChartCard>
        <ChartCard>
          <ReactECharts option={capacityByTechOption} style={{ height: '360px' }} />
        </ChartCard>
      </div>

      <SectionHeader>
        {t('simulationComparison.charts.performanceIndicators', 'Performance Indicators')}
      </SectionHeader>
      <ChartCard>
        <ReactECharts option={gaugeOption} style={{ height: '300px' }} />
      </ChartCard>

      <SectionHeader>
        {t('simulationComparison.charts.costAnalysisSection', 'Cost Analysis')}
      </SectionHeader>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard>
          <ReactECharts option={costBreakdownOption} style={{ height: '360px' }} />
        </ChartCard>
        <ChartCard>
          <ReactECharts option={costDifferenceOption} style={{ height: '360px' }} />
        </ChartCard>
      </div>

      {(hasInvestmentData || hasLcoeData || hasCFData) && (
        <>
          <SectionHeader>
            {t('simulationComparison.charts.techEconomicsSection', 'Technology Economics')}
          </SectionHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {hasInvestmentData && (
              <ChartCard>
                <ReactECharts option={investmentCostOption} style={{ height: '360px' }} />
              </ChartCard>
            )}
            {hasLcoeData && (
              <ChartCard>
                <ReactECharts option={lcoeByTechOption} style={{ height: '360px' }} />
              </ChartCard>
            )}
          </div>
          {hasCFData && (
            <ChartCard>
              <ReactECharts option={capacityFactorOption} style={{ height: '360px' }} />
            </ChartCard>
          )}
        </>
      )}

      <SectionHeader>
        {t('simulationComparison.charts.energyFlowSection', 'Energy Flow')}
      </SectionHeader>
      <ChartCard>
        <ReactECharts option={sankeyOption} style={{ height: '450px' }} />
      </ChartCard>
    </div>
  );
};
