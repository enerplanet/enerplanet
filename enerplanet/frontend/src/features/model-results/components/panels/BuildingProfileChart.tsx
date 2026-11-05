import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useThemeColors } from '@/features/simulation-charts/pypsa/chartUtils';
import { carrierDisplay, formatCarrierEnergy, formatCarrierPower } from '../../carrierUnits';
import type { BuildingFlow } from '../../buildingFlows';
import { formatNumber } from '@/utils/formatNumber';

export type ProfileResolution = 'monthly' | 'daily' | 'typical';
export type Season = 'winter' | 'summer' | 'year';

/** Months (MM) the typical day averages over. */
const SEASON_MONTHS: Record<Season, string[] | null> = {
  winter: ['12', '01', '02'],
  summer: ['06', '07', '08'],
  year: null,
};

interface BuildingProfileChartProps {
  timesteps: string[];
  flows: BuildingFlow[];
  carrier: string;
  label: (key: string) => string;
  resolution: ProfileResolution;
  /** Months the typical day is averaged over; ignored by the other resolutions. */
  season: Season;
  /** Shown when no hour of the run falls in the chosen months. */
  emptyText: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket of a timestep string (YYYY-MM-DD HH:..) for each resolution. */
const BUCKET: Record<ProfileResolution, (ts: string) => string> = {
  monthly: (ts) => ts.slice(5, 7),
  daily: (ts) => ts.slice(0, 10),
  typical: (ts) => ts.slice(11, 13),
};

/** Sums hourly values per bucket; the typical day averages them instead, giving kW. */
function aggregate(timesteps: string[], hourly: number[], resolution: ProfileResolution, season: Season): Map<string, number> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  const months = resolution === 'typical' ? SEASON_MONTHS[season] : null;
  timesteps.forEach((ts, i) => {
    if (months && !months.includes(ts.slice(5, 7))) return;
    const b = BUCKET[resolution](ts);
    sums.set(b, (sums.get(b) ?? 0) + hourly[i]);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  });
  if (resolution === 'typical') sums.forEach((v, b) => sums.set(b, v / counts.get(b)!));
  return sums;
}

function axisLabel(bucket: string, resolution: ProfileResolution): string {
  if (resolution === 'monthly') return MONTHS[Number(bucket) - 1] ?? bucket;
  if (resolution === 'daily') return `${bucket.slice(5, 7)}/${bucket.slice(8, 10)}`;
  return `${bucket}:00`;
}

/** Energy at one building as stacked bars: supplies above zero, uses below. Same style as the Energy tab. */
export function BuildingProfileChart({ timesteps, flows, carrier, label, resolution, season, emptyText }: BuildingProfileChartProps) {
  const colors = useThemeColors();
  const display = carrierDisplay(carrier);

  const option = useMemo<EChartsOption>(() => {
    const series = flows.map((f) => ({ flow: f, values: aggregate(timesteps, f.hourly, resolution, season) }));
    const buckets = [...(series[0]?.values.keys() ?? [])].sort();
    const isPower = resolution === 'typical';
    const zoom = resolution === 'daily';
    return {
      animation: false,
      title: buckets.length > 0 ? undefined : { text: emptyText, left: 'center', top: 'middle', textStyle: { color: colors.textMuted, fontSize: 12, fontWeight: 'normal' } },
      grid: { left: 56, right: 12, top: 46, bottom: zoom ? 50 : 24 },
      legend: { top: 0, left: 24, right: 4, type: 'scroll', itemWidth: 10, itemHeight: 8, itemGap: 8, textStyle: { color: colors.text, fontSize: 10 } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.text, fontSize: 11 },
        valueFormatter: (v) => (isPower ? formatCarrierPower : formatCarrierEnergy)(Math.abs(Number(v)), carrier),
      },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => axisLabel(b, resolution)),
        axisTick: { show: false },
        axisLabel: { color: colors.textSubtle, fontSize: 10 },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: 'value',
        name: isPower ? display.powerUnit : `${display.energyUnit} / ${resolution === 'monthly' ? 'month' : 'day'}`,
        nameTextStyle: { color: colors.textMuted, fontSize: 11 },
        axisLabel: { color: colors.textSubtle, fontSize: 10, formatter: (v: number) => formatNumber(Math.abs(v), 0) },
        splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } },
      },
      dataZoom: zoom
        ? [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 16, bottom: 6, borderColor: colors.border, fillerColor: 'rgba(59, 130, 246, 0.1)' },
          ]
        : [],
      series: series.map(({ flow, values }) => ({
        name: label(flow.key),
        type: 'bar' as const,
        stack: flow.side,
        barMaxWidth: 28,
        itemStyle: { color: flow.color },
        emphasis: { focus: 'series' as const },
        data: buckets.map((b) => (flow.side === 'supply' ? 1 : -1) * (values.get(b) ?? 0)),
      })),
    };
  }, [timesteps, flows, carrier, label, resolution, season, emptyText, display, colors]);

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}
