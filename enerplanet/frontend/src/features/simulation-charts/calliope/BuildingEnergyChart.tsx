import { FC, useMemo, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CarrierProdRecord, CarrierConRecord } from '@/features/model-results/types';
import { useThemeColors } from '../pypsa/chartUtils';

interface BuildingEnergyChartProps {
  production: CarrierProdRecord[];
  consumption: CarrierConRecord[];
  expectedYearlyDemandKwh?: number;
  height?: number;
}

// Source category definitions
type SourceCategory = 'pv' | 'wind' | 'battery' | 'biomass' | 'geothermal' | 'grid' | 'other';

interface SourceConfig {
  label: string;
  color: string;
  icon: string;
  matchPatterns: string[];
}

const SOURCE_CONFIGS: Record<SourceCategory, SourceConfig> = {
  pv: {
    label: 'Solar PV',
    color: '#f5b841',
    icon: '☀️',
    matchPatterns: ['pv', 'solar', 'photovoltaic'],
  },
  wind: {
    label: 'Wind',
    color: '#47d154',
    icon: '💨',
    matchPatterns: ['wind', 'turbine'],
  },
  battery: {
    label: 'Battery',
    color: '#8b5cf6',
    icon: '🔋',
    matchPatterns: ['battery', 'storage'],
  },
  biomass: {
    label: 'Biomass',
    color: '#84cc16',
    icon: '🌿',
    matchPatterns: ['biomass', 'bio', 'biogas'],
  },
  geothermal: {
    label: 'Geothermal',
    color: '#ef4444',
    icon: '🌋',
    matchPatterns: ['geothermal', 'geo', 'heat_pump'],
  },
  grid: {
    label: 'Grid Import',
    color: '#3b82f6',
    icon: '⚡',
    matchPatterns: ['grid', 'transformer', 'import', 'transmission'],
  },
  other: {
    label: 'Other',
    color: '#9ca3af',
    icon: '🔌',
    matchPatterns: [],
  },
};

const categorizeSource = (tech: string): SourceCategory => {
  const techLower = tech.toLowerCase();
  for (const [category, config] of Object.entries(SOURCE_CONFIGS)) {
    if (config.matchPatterns.some(pattern => techLower.includes(pattern))) {
      return category as SourceCategory;
    }
  }
  return 'other';
};

// Consumption color (single demand line)
const CONSUMPTION_COLOR = '#dc2626';

const formatPowerWithUnit = (valueKw: number): string => {
  const abs = Math.abs(valueKw);
  if (abs === 0) return '0.00 kW';
  if (abs < 0.1) return `${(valueKw * 1000).toFixed(2)} W`;
  return `${valueKw.toFixed(2)} kW`;
};

const formatAxisKw = (valueKw: number): string => {
  const abs = Math.abs(valueKw);
  if (abs >= 10) return valueKw.toFixed(1);
  if (abs >= 1) return valueKw.toFixed(2);
  if (abs >= 0.1) return valueKw.toFixed(3);
  if (abs > 0) return valueKw.toFixed(4);
  return '0';
};

const formatEnergyKwh = (valueKwh: number): string => {
  const abs = Math.abs(valueKwh);
  if (abs >= 1000) return `${valueKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`;
  if (abs >= 1) return `${valueKwh.toFixed(2)} kWh`;
  if (abs >= 0.1) return `${valueKwh.toFixed(3)} kWh`;
  if (abs > 0) return `${valueKwh.toFixed(4)} kWh`;
  return '0.000 kWh';
};

const parseTimestampMs = (timestamp: string): number | null => {
  const direct = Date.parse(timestamp);
  if (Number.isFinite(direct)) return direct;

  const normalized = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T');
  const withT = Date.parse(normalized);
  if (Number.isFinite(withT)) return withT;

  const asUtc = Date.parse(`${normalized}Z`);
  if (Number.isFinite(asUtc)) return asUtc;

  return null;
};

const getTypicalTimestepHours = (timestamps: string[]): number => {
  if (timestamps.length < 2) return 1;
  const diffs: number[] = [];

  for (let i = 1; i < timestamps.length; i += 1) {
    const prev = parseTimestampMs(timestamps[i - 1]);
    const curr = parseTimestampMs(timestamps[i]);
    if (prev == null || curr == null) continue;

    const diffHours = (curr - prev) / (1000 * 60 * 60);
    if (Number.isFinite(diffHours) && diffHours > 0 && diffHours < 24 * 14) {
      diffs.push(diffHours);
    }
  }

  if (diffs.length === 0) return 1;

  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  const median =
    diffs.length % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid];

  return Number.isFinite(median) && median > 0 ? median : 1;
};

const formatStepLabel = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) return '1 h';
  if (hours >= 1) {
    if (Math.abs(hours - Math.round(hours)) < 0.001) return `${Math.round(hours)} h`;
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.round(hours * 60)} min`;
};

const inferTimeseriesScale = (
  totalConsumption: number[],
  categorizedProduction: Record<SourceCategory, number[]>,
  expectedYearlyDemandKwh?: number
): number => {
  if (!expectedYearlyDemandKwh || expectedYearlyDemandKwh <= 0) return 1;
  const expectedAvgKw = expectedYearlyDemandKwh / 8760;
  if (!Number.isFinite(expectedAvgKw) || expectedAvgKw <= 0) return 1;

  let observedPeak = 0;
  for (const value of totalConsumption) {
    observedPeak = Math.max(observedPeak, Math.abs(value));
  }
  for (const category of Object.keys(categorizedProduction) as SourceCategory[]) {
    for (const value of categorizedProduction[category]) {
      observedPeak = Math.max(observedPeak, Math.abs(value));
    }
  }

  if (!Number.isFinite(observedPeak) || observedPeak <= 0) return 1;

  const ratio = observedPeak / expectedAvgKw;
  if (ratio > 80 && ratio < 5000) return 0.001;
  if (ratio > 0 && ratio < 0.01) return 1000;
  return 1;
};

export const BuildingEnergyChart: FC<BuildingEnergyChartProps> = ({
  production,
  consumption,
  expectedYearlyDemandKwh,
  height = 350,
}) => {
  const themeColors = useThemeColors();

  // Parse and categorize production data
  const {
    timestamps,
    categorizedProduction,
    totalConsumption,
    availableCategories,
    timestepHours,
  } = useMemo(() => {
    // Collect all unique timestamps and sort
    const timestampSet = new Set<string>();
    production.forEach(p => timestampSet.add(p.timestep));
    consumption.forEach(c => timestampSet.add(c.timestep));
    const timestamps = Array.from(timestampSet).sort((a, b) => a.localeCompare(b));
    const timestepHours = getTypicalTimestepHours(timestamps);

    // Aggregate production by category
    const prodByCategory = new Map<SourceCategory, Map<string, number>>();
    
    production.forEach(p => {
      // Skip transmission lines and records with no tech info
      if (!p.techs || p.techs.includes('power_transmission')) return;
      
      const category = categorizeSource(p.techs);
      
      if (!prodByCategory.has(category)) {
        prodByCategory.set(category, new Map());
      }
      const existing = prodByCategory.get(category)!.get(p.timestep) || 0;
      prodByCategory.get(category)!.set(p.timestep, existing + p.value);
    });

    // Aggregate consumption (all types combined into single line)
    const totalCon = new Map<string, number>();
    consumption.forEach(c => {
      if (!c.techs || c.techs.includes('power_transmission')) return;
      const existing = totalCon.get(c.timestep) || 0;
      totalCon.set(c.timestep, existing + c.value);
    });

    // Build categorized data arrays
    const categorizedProductionRaw: Record<SourceCategory, number[]> = {
      pv: [],
      wind: [],
      battery: [],
      biomass: [],
      geothermal: [],
      grid: [],
      other: [],
    };

    for (const category of Object.keys(SOURCE_CONFIGS) as SourceCategory[]) {
      const dataMap = prodByCategory.get(category);
      categorizedProductionRaw[category] = timestamps.map(ts => dataMap?.get(ts) || 0);
    }

    const totalConsumptionRaw = timestamps.map(ts => totalCon.get(ts) || 0);

    const scale = inferTimeseriesScale(
      totalConsumptionRaw,
      categorizedProductionRaw,
      expectedYearlyDemandKwh
    );

    const categorizedProduction: Record<SourceCategory, number[]> = {
      pv: categorizedProductionRaw.pv.map(value => value * scale),
      wind: categorizedProductionRaw.wind.map(value => value * scale),
      battery: categorizedProductionRaw.battery.map(value => value * scale),
      biomass: categorizedProductionRaw.biomass.map(value => value * scale),
      geothermal: categorizedProductionRaw.geothermal.map(value => value * scale),
      grid: categorizedProductionRaw.grid.map(value => value * scale),
      other: categorizedProductionRaw.other.map(value => value * scale),
    };

    const totalConsumption = totalConsumptionRaw.map(value => value * scale);

    // Filter to categories that have generators assigned (even if values are zero)
    const availableCategories = (Object.keys(SOURCE_CONFIGS) as SourceCategory[]).filter(
      cat => prodByCategory.has(cat)
    );

    return {
      timestamps,
      categorizedProduction,
      totalConsumption,
      availableCategories,
      timestepHours,
    };
  }, [production, consumption, expectedYearlyDemandKwh]);

  // Toggle state for each source category
  const [enabledSources, setEnabledSources] = useState<Record<SourceCategory, boolean>>(() => {
    const initial: Record<SourceCategory, boolean> = {
      pv: true,
      wind: true,
      battery: true,
      biomass: true,
      geothermal: true,
      grid: true,
      other: true,
    };
    return initial;
  });

  const [showConsumption, setShowConsumption] = useState(true);

  const toggleSource = useCallback((category: SourceCategory) => {
    setEnabledSources(prev => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const option: EChartsOption = useMemo(() => {
    // Format timestamps for display
    const xAxisData = timestamps.map(ts => {
      const parsed = parseTimestampMs(ts);
      if (parsed == null) return ts;
      const date = new Date(parsed);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hour = date.getHours().toString().padStart(2, '0');
      return `${month}/${day} ${hour}:00`;
    });

    // Build production series (stacked areas)
    const prodSeries = availableCategories
      .filter(cat => enabledSources[cat])
      .map(category => {
        const config = SOURCE_CONFIGS[category];
        return {
          name: config.label,
          type: 'line' as const,
          stack: 'generation',
          smooth: true,
          symbol: 'none',
          itemStyle: {
            color: config.color,
          },
          lineStyle: {
            width: 0,
          },
          areaStyle: {
            opacity: 0.85,
          },
          emphasis: {
            focus: 'series' as const,
          },
          data: categorizedProduction[category],
        };
      });

    // Consumption series (single line)
    const conSeries = showConsumption ? [{
      name: 'Consumption',
      type: 'line' as const,
      smooth: true,
      symbol: 'none',
      lineStyle: { 
        width: 2.5,
        color: CONSUMPTION_COLOR,
        type: 'solid' as const,
      },
      emphasis: {
        focus: 'series' as const,
      },
      data: totalConsumption,
    }] : [];

    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'cross',
          animation: false,
          label: {
            backgroundColor: '#505765',
          },
        },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [12, 16],
        textStyle: {
          color: themeColors.text,
          fontSize: 12,
        },
        formatter: (params: unknown) => {
          const items = params as { seriesName: string; value: number; marker: string; color: string }[];
          if (!items || items.length === 0) return '';

          const axisValue =
            (items[0] as { axisValueLabel?: string; axisValue?: string }).axisValueLabel ||
            (items[0] as { axisValue?: string }).axisValue ||
            '';
          const stepLabel = formatStepLabel(timestepHours);

          let html = `<div style="font-weight: 600; margin-bottom: 8px; color: ${themeColors.text}; border-bottom: 1px solid ${themeColors.border}; padding-bottom: 6px;">${axisValue}</div>`;

          // Generation sources
          const genItems = items.filter(i => i.seriesName !== 'Consumption');
          const conItem = items.find(i => i.seriesName === 'Consumption');

          let genTotal = 0;
          if (genItems.length > 0) {
            html += `<div style="font-weight: 500; color: #059669; margin: 6px 0 4px;">Generation</div>`;
            genItems.forEach(item => {
              const val = Math.abs(item.value || 0);
              genTotal += val;
              html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin: 2px 0; color: ${themeColors.text};">
                <span>${item.marker} ${item.seriesName}</span>
                <span style="font-weight: 500;">${formatPowerWithUnit(val)}</span>
              </div>`;
            });
            html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin: 4px 0 2px; padding-top: 4px; border-top: 1px dashed ${themeColors.border}; color: ${themeColors.text};">
              <span style="font-weight: 500;">Total Generation</span>
              <span style="font-weight: 600; color: #059669;">${formatPowerWithUnit(genTotal)}</span>
            </div>`;
            html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin: 2px 0 0; color: ${themeColors.textMuted}; font-size: 11px;">
              <span>Energy (${stepLabel})</span>
              <span style="font-weight: 500;">${formatEnergyKwh(genTotal * timestepHours)}</span>
            </div>`;
          }

          if (conItem) {
            // Consumption values may be negative in data, use absolute value for display
            const conValue = Math.abs(conItem.value || 0);
            const conEnergyKwh = conValue * timestepHours;
            html += `<div style="font-weight: 500; color: #dc2626; margin: 8px 0 4px;">Consumption</div>`;
            html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin: 2px 0; color: ${themeColors.text};">
              <span>${conItem.marker} Total Demand (${stepLabel})</span>
              <span style="font-weight: 500;">${formatEnergyKwh(conEnergyKwh)}</span>
            </div>`;

            // Show balance: generation minus consumption (both as positive values)
            const balance = genTotal - conValue;
            const balanceEnergyKwh = Math.abs(balance) * timestepHours;
            const balanceColor = balance >= 0 ? '#059669' : '#dc2626';
            const balanceLabel = balance >= 0 ? 'Surplus' : 'Deficit';
            html += `<div style="display: flex; justify-content: space-between; gap: 24px; margin: 6px 0 2px; padding-top: 4px; border-top: 1px solid ${themeColors.border}; color: ${themeColors.text};">
              <span style="font-weight: 500;">${balanceLabel} (${stepLabel})</span>
              <span style="font-weight: 600; color: ${balanceColor};">${formatEnergyKwh(balanceEnergyKwh)}</span>
            </div>`;
          }

          return html;
        },
      },
      grid: {
        left: 55,
        right: 20,
        top: 20,
        bottom: 60,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: xAxisData,
        axisLine: { lineStyle: { color: themeColors.border } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: themeColors.textSubtle,
          rotate: 0,
          interval: Math.max(0, Math.floor(timestamps.length / 8) - 1),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Power (kW)',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          fontSize: 11,
          color: themeColors.textMuted,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: themeColors.textSubtle,
          formatter: (value: number) => formatAxisKw(value),
        },
        splitLine: {
          lineStyle: {
            color: themeColors.gridLine,
            type: 'dashed',
          },
        },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 20,
          bottom: 8,
          borderColor: themeColors.border,
          fillerColor: 'rgba(59, 130, 246, 0.15)',
          handleStyle: {
            color: '#3b82f6',
            borderColor: '#3b82f6',
          },
          textStyle: {
            fontSize: 10,
            color: themeColors.textSubtle,
          },
          dataBackground: {
            lineStyle: { color: themeColors.border },
            areaStyle: { color: themeColors.gridLine },
          },
        },
      ],
      series: [...prodSeries, ...conSeries],
    };
  }, [timestamps, categorizedProduction, totalConsumption, availableCategories, enabledSources, showConsumption, themeColors, timestepHours]);

  if (timestamps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-300 text-sm">
        No hourly data available
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height }}>
      {/* Source Toggles */}
      <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground self-center mr-1">Sources:</span>
        {availableCategories.map(category => {
          const config = SOURCE_CONFIGS[category];
          const isEnabled = enabledSources[category];
          return (
            <button
              key={category}
              onClick={() => toggleSource(category)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                isEnabled 
                  ? 'text-white shadow-sm' 
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted/50'
              }`}
              style={isEnabled ? { 
                backgroundColor: config.color,
                borderColor: config.color,
              } : undefined}
            >
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </button>
          );
        })}
        <div className="w-px bg-border mx-1" />
        <button
          onClick={() => setShowConsumption(prev => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
            showConsumption 
              ? 'text-white shadow-sm' 
              : 'bg-transparent text-muted-foreground border-border hover:bg-muted/50'
          }`}
          style={showConsumption ? { 
            backgroundColor: CONSUMPTION_COLOR,
            borderColor: CONSUMPTION_COLOR,
          } : undefined}
        >
          <span>📊</span>
          <span>Consumption</span>
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1">
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge={true}
        />
      </div>
    </div>
  );
};
