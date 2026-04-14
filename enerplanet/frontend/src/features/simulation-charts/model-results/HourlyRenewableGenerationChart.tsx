import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { CarrierProdRecord } from '@/features/model-results/types';
import { useTranslation } from '@spatialhub/i18n';
import { createDataZoomWithStyle, useThemeColors } from '../pypsa/chartUtils';

interface HourlyRenewableGenerationChartProps {
  production: CarrierProdRecord[];
  height?: number;
}

type RenewableTechKey = 'pv' | 'wind' | 'biomass' | 'geothermal';

const FLOATING_POINT_EPSILON = 1e-6;

const TECH_DEFINITIONS: Array<{
  key: RenewableTechKey;
  labelKey: string;
  fallbackLabel: string;
  color: string;
}> = [
  { key: 'pv', labelKey: 'results.energy.solarPv', fallbackLabel: 'Solar PV', color: '#f59e0b' },
  { key: 'wind', labelKey: 'results.energy.wind', fallbackLabel: 'Wind', color: '#22c55e' },
  { key: 'biomass', labelKey: 'results.energy.biomass', fallbackLabel: 'Biomass', color: '#84cc16' },
  { key: 'geothermal', labelKey: 'results.techNames.geothermal', fallbackLabel: 'Geothermal', color: '#ef4444' },
];

function normalizeEnergyValue(value: number, precision: number = 4): number {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
}

function formatEnergy(value: number): string {
  const normalized = normalizeEnergyValue(value, 2);
  const abs = Math.abs(normalized);

  if (normalized === 0) return '0 kWh';
  if (abs >= 1000) return `${(normalized / 1000).toFixed(2)} MWh`;
  if (abs >= 10) return `${normalized.toFixed(1)} kWh`;
  return `${normalized.toFixed(2)} kWh`;
}

function formatAxisEnergy(value: number): string {
  const normalized = normalizeEnergyValue(value, 2);
  const abs = Math.abs(normalized);

  if (normalized === 0) return '0';
  if (abs >= 1000) return `${(normalized / 1000).toFixed(1)} MWh`;
  if (abs >= 10) return `${normalized.toFixed(0)}`;
  return `${normalized.toFixed(1)}`;
}

function categorizeRenewableTech(techs: string): RenewableTechKey | null {
  const normalized = techs.toLowerCase();
  if (normalized.includes('power_transmission')) return null;
  if (normalized.includes('geothermal') || normalized.includes('geothermie')) return 'geothermal';
  if (normalized.includes('biomass') || normalized.includes('biomasse')) return 'biomass';
  if (normalized.includes('wind')) return 'wind';
  if (normalized.includes('pv') || normalized.includes('solar')) return 'pv';
  return null;
}

function formatTimestampLabel(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;

    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return timestamp;
  }
}

function formatTimestampAxis(value: number): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    });
  } catch (e) {
    return '';
  }
}

// Fast string extraction for "YYYY-MM-DD" from ISO strings or "YYYY-MM-DD HH:mm:ss"
function extractDateString(timestamp: string): string {
  if (!timestamp) return '';
  return timestamp.substring(0, 10);
}

export const HourlyRenewableGenerationChart: FC<HourlyRenewableGenerationChartProps> = ({
  production,
  height = 340,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();

  const chartData = useMemo(() => {
    const perTimestamp = new Map<string, Record<RenewableTechKey, number>>();
    const totals: Record<RenewableTechKey, number> = {
      pv: 0,
      wind: 0,
      biomass: 0,
      geothermal: 0,
    };

    production.forEach((record) => {
      if (record.carrier !== 'power') return;

      const techKey = categorizeRenewableTech(record.techs || '');
      if (!techKey) return;

      const timestamp = record.timestep;
      const bucket = perTimestamp.get(timestamp) || {
        pv: 0,
        wind: 0,
        biomass: 0,
        geothermal: 0,
      };
      const value = Math.abs(record.value);

      bucket[techKey] += value;
      perTimestamp.set(timestamp, bucket);
      totals[techKey] += value;
    });

    // Fast sort using localeCompare directly on strings (ISO format guarantees sortability)
    let timestamps = Array.from(perTimestamp.keys()).sort((a, b) => a.localeCompare(b));

    if (timestamps.length > 24) {
      const countPerDay = new Map<string, number>();
      for (const ts of timestamps) {
        const d = extractDateString(ts);
        countPerDay.set(d, (countPerDay.get(d) || 0) + 1);
      }
      const days = Array.from(countPerDay.keys()).sort();
      if (days.length > 1) {
        const lastDay = days[days.length - 1];
        const prevDay = days[days.length - 2];
        const lastCount = countPerDay.get(lastDay) || 0;
        const prevCount = countPerDay.get(prevDay) || 0;
        if (prevCount > 0 && lastCount < prevCount * 0.5) {
          timestamps = timestamps.filter(ts => extractDateString(ts) !== lastDay);
        }
      }
    }

    const activeTechs = TECH_DEFINITIONS.filter((tech) => totals[tech.key] > FLOATING_POINT_EPSILON);

    const series = activeTechs.map((tech) => ({
      key: tech.key,
      name: t(tech.labelKey, tech.fallbackLabel),
      color: tech.color,
      total: totals[tech.key],
      data: timestamps.map((timestamp) => [
        timestamp,
        normalizeEnergyValue(perTimestamp.get(timestamp)?.[tech.key] || 0),
      ]),
    }));

    return {
      hasData: timestamps.length > 0 && series.length > 0,
      series,
      timestamps,
    };
  }, [production, t]);

  const option: EChartsOption = useMemo(() => {
    if (!chartData.hasData) return {};

    const series: SeriesOption[] = chartData.series.map((item) => ({
      name: item.name,
      type: 'line',
      stack: 'renewable-generation',
      showSymbol: false,
      symbol: 'none',
      sampling: 'lttb',
      emphasis: { focus: 'series' },
      lineStyle: {
        width: 2.5,
        color: item.color,
      },
      itemStyle: {
        color: item.color,
      },
      areaStyle: {
        opacity: 0.25,
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: `${item.color}80` },
            { offset: 1, color: `${item.color}15` },
          ],
        },
      },
      data: item.data,
    }));

    return {
      animation: false,
      legend: {
        type: 'scroll',
        top: 8,
        left: 0,
        right: 8,
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          color: themeColors.text,
          fontSize: 11,
        },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'line',
        },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params];
          const axisValue = items[0]?.axisValue as string | undefined;
          let total = 0;

          const rows = items
            .map((item: any) => {
              const value = Number(item?.value?.[1] ?? item?.data?.[1] ?? item?.value ?? 0);
              if (!Number.isFinite(value) || value <= FLOATING_POINT_EPSILON) return null;
              total += value;
              return `<div style="display:flex;justify-content:space-between;gap:20px;margin:3px 0;color:${themeColors.text};">
                <span>${item.marker} ${item.seriesName}</span>
                <span style="font-weight:600;">${formatEnergy(value)}</span>
              </div>`;
            })
            .filter(Boolean)
            .join('');

          if (!rows) return '';

          return `
            <div style="font-weight:600;margin-bottom:8px;border-bottom:1px solid ${themeColors.border};padding-bottom:6px;color:${themeColors.text};">
              ${axisValue ? formatTimestampLabel(axisValue) : ''}
            </div>
            ${rows}
            <div style="display:flex;justify-content:space-between;gap:20px;margin-top:8px;padding-top:8px;border-top:1px solid ${themeColors.border};color:${themeColors.text};">
              <span style="font-weight:500;">${t('results.energy.totalRenewable', 'Total renewable')}</span>
              <span style="font-weight:700;color:#059669;">${formatEnergy(total)}</span>
            </div>
          `;
        },
      },
      grid: {
        left: 68,
        right: 24,
        top: 62,
        bottom: 56,
      },
      dataZoom: createDataZoomWithStyle(),
      xAxis: {
        type: 'time',
        axisLabel: {
          color: themeColors.textSubtle,
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: number) => formatTimestampAxis(value),
        },
        axisLine: { lineStyle: { color: themeColors.border } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: t('results.energy.energyKwh', 'Energy (kWh)'),
        nameLocation: 'middle',
        nameGap: 52,
        nameTextStyle: { color: themeColors.textMuted, fontSize: 11 },
        axisLabel: {
          color: themeColors.textSubtle,
          fontSize: 10,
          formatter: (value: number) => formatAxisEnergy(value),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: {
            color: themeColors.gridLine,
            type: 'dashed',
          },
        },
      },
      series,
    };
  }, [chartData, t, themeColors]);

  if (!chartData.hasData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t(
          'results.energy.noRenewableGenerationData',
          'No PV, wind, biomass, or geothermal production data available.'
        )}
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};

