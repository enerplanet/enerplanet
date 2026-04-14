import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CarrierConRecord, CarrierProdRecord } from '@/features/model-results/types';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';

interface DailyLoadProfileProps {
  consumption?: CarrierConRecord[];
  production?: CarrierProdRecord[];
  height?: number;
  title?: string;
}

type DataRecord = CarrierConRecord | CarrierProdRecord;

const extractHourFromTimestamp = (timestamp: string): number | null => {
  const match = timestamp.match(/(?:T|\s)(\d{2}):\d{2}/);
  if (match) {
    const hour = Number(match[1]);
    return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCHours();
};

const formatPower = (valueKw: number): string => {
  if (!Number.isFinite(valueKw)) return '0';
  const abs = Math.abs(valueKw);
  if (abs >= 1000) return `${(valueKw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${valueKw.toFixed(2)} kW`;
  if (abs >= 0.001) return `${(valueKw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(valueKw * 1_000_000).toFixed(1)} mW`;
};

const formatAxisPower = (valueKw: number): string => {
  if (!Number.isFinite(valueKw)) return '0';
  const abs = Math.abs(valueKw);
  if (abs >= 1000) return `${(valueKw / 1000).toFixed(1)} MW`;
  if (abs >= 1) return `${valueKw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(valueKw * 1000).toFixed(0)} W`;
  return '0';
};

// Helper to aggregate data by hour
const aggregateByHour = (data: DataRecord[]): Map<number, number[]> => {
  const hourlyData = new Map<number, number[]>();
  for (let h = 0; h < 24; h++) hourlyData.set(h, []);

  // Sum all locations/tech rows per timestamp to get system-level power.
  const timestampTotals = new Map<string, number>();

  for (const record of data) {
    if (record.carrier !== 'power' || !record.techs || record.techs.includes('power_transmission')) continue;
    timestampTotals.set(
      record.timestep,
      (timestampTotals.get(record.timestep) || 0) + Math.abs(record.value)
    );
  }

  for (const [timestamp, total] of timestampTotals.entries()) {
    const hour = extractHourFromTimestamp(timestamp);
    if (hour === null) continue;
    hourlyData.get(hour)?.push(total);
  }

  return hourlyData;
};

// Helper to calculate hourly averages and find peaks
const calculateHourlyStats = (hourlyData: Map<number, number[]>) => {
  const hourlyAvg: number[] = [];
  let peakHour = 0, peakValue = 0, minHour = 0, minValue = Infinity;

  for (let hour = 0; hour < 24; hour++) {
    const values = hourlyData.get(hour) || [];
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    hourlyAvg.push(avg);
    if (avg > peakValue) { peakValue = avg; peakHour = hour; }
    if (avg < minValue && avg > 0) { minValue = avg; minHour = hour; }
  }

  return { hourlyAvg, peakHour, peakValue, minHour, minValue: minValue === Infinity ? 0 : minValue };
};

// Helper to find peak period in a range
const findPeakPeriod = (hourlyAvg: number[], threshold: number, startHour: number, endHour: number) => {
  let peakStart = -1, peakEnd = -1;
  for (let h = startHour; h <= endHour; h++) {
    if (hourlyAvg[h] > threshold) {
      if (peakStart === -1) peakStart = h;
      peakEnd = h;
    }
  }
  return peakStart >= 0 ? { start: peakStart, end: peakEnd + 1 } : null;
};

export const DailyLoadProfile: FC<DailyLoadProfileProps> = ({
  consumption,
  production,
  height = 300,
  title = '',
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  
  const chartData = useMemo(() => {
    const data = consumption || production;
    if (!data || data.length === 0) return null;

    const hourlyData = aggregateByHour(data);
    const stats = calculateHourlyStats(hourlyData);
    const { hourlyAvg } = stats;

    const avgLoad = hourlyAvg.reduce((a, b) => a + b, 0) / 24;
    const threshold = avgLoad * 1.2;

    return {
      ...stats,
      avgLoad,
      morningPeak: findPeakPeriod(hourlyAvg, threshold, 6, 12),
      eveningPeak: findPeakPeriod(hourlyAvg, threshold, 16, 22),
    };
  }, [consumption, production]);

  const option: EChartsOption = useMemo(() => {
    if (!chartData) return {};

    const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

    // Build mark areas for peak periods
    const markAreaData: any[] = [];

    if (chartData.morningPeak) {
      markAreaData.push([
        {
          name: t('results.energy.morningPeak'),
          xAxis: `${chartData.morningPeak.start.toString().padStart(2, '0')}:00`,
        },
        {
          xAxis: `${chartData.morningPeak.end.toString().padStart(2, '0')}:00`,
        },
      ]);
    }

    if (chartData.eveningPeak) {
      markAreaData.push([
        {
          name: t('results.energy.eveningPeak'),
          xAxis: `${chartData.eveningPeak.start.toString().padStart(2, '0')}:00`,
        },
        {
          xAxis: `${chartData.eveningPeak.end.toString().padStart(2, '0')}:00`,
        },
      ]);
    }

    // Create visual map pieces for coloring peak periods
    const pieces: any[] = [];

    // Off-peak (green) and peak (red) coloring
    if (chartData.morningPeak && chartData.eveningPeak) {
      pieces.push(
        { lte: chartData.morningPeak.start - 1, color: '#22c55e' },
        { gt: chartData.morningPeak.start - 1, lte: chartData.morningPeak.end - 1, color: '#ef4444' },
        { gt: chartData.morningPeak.end - 1, lte: chartData.eveningPeak.start - 1, color: '#22c55e' },
        { gt: chartData.eveningPeak.start - 1, lte: chartData.eveningPeak.end - 1, color: '#ef4444' },
        { gt: chartData.eveningPeak.end - 1, color: '#22c55e' }
      );
    } else {
      // Default coloring if no peaks detected
      pieces.push(
        { lte: 6, color: '#22c55e' },
        { gt: 6, lte: 9, color: '#ef4444' },
        { gt: 9, lte: 16, color: '#22c55e' },
        { gt: 16, lte: 20, color: '#ef4444' },
        { gt: 20, color: '#22c55e' }
      );
    }

    return {
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500, color: themeColors.text },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'cross',
          crossStyle: { color: themeColors.textSubtle },
        },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          const dataIndex = params[0]?.dataIndex;
          if (dataIndex === undefined) return '';
          const value = chartData.hourlyAvg[dataIndex];
          const hour = hours[dataIndex];
          const isPeak = (chartData.morningPeak && dataIndex >= chartData.morningPeak.start && dataIndex < chartData.morningPeak.end) ||
                        (chartData.eveningPeak && dataIndex >= chartData.eveningPeak.start && dataIndex < chartData.eveningPeak.end);

          return `
            <div style="font-weight: 600; margin-bottom: 6px; color: ${themeColors.text};">${hour}</div>
            <div style="margin-bottom: 4px; color: ${themeColors.text};">
              ${t('results.energy.power')}: <b style="color: ${isPeak ? '#ef4444' : '#22c55e'}">${formatPower(value)}</b>
            </div>
            <div style="font-size: 11px; color: ${isPeak ? '#ef4444' : '#22c55e'}">
              ${isPeak ? `⚠ ${t('results.energy.peakPeriod')}` : `✓ ${t('results.energy.offPeak')}`}
            </div>
          `;
        },
      },
      toolbox: {
        show: true,
        right: 10,
        top: 0,
        feature: {
          saveAsImage: {
            title: 'Save',
            pixelRatio: 2,
          },
        },
        iconStyle: {
          borderColor: themeColors.textSubtle,
        },
      },
      grid: {
        left: '10%',
        right: '5%',
        top: '12%',
        bottom: '18%',
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: hours,
        name: t('results.energy.timeOfDay'),
        nameLocation: 'center',
        nameGap: 35,
        nameTextStyle: { fontSize: 11, color: themeColors.textMuted },
        axisLabel: {
          fontSize: 9,
          color: themeColors.textSubtle,
          interval: 2,
        },
        axisLine: { lineStyle: { color: themeColors.border } },
      },
      yAxis: {
        type: 'value',
        name: t('results.energy.power'),
        nameLocation: 'center',
        nameGap: 45,
        nameTextStyle: { fontSize: 11, color: themeColors.textMuted },
        axisLabel: {
          fontSize: 10,
          color: themeColors.textSubtle,
          formatter: (value: number) => formatAxisPower(value),
        },
        axisPointer: {
          snap: true,
        },
        axisLine: { lineStyle: { color: themeColors.border } },
        splitLine: { lineStyle: { color: themeColors.gridLine } },
      },
      visualMap: {
        show: false,
        dimension: 0,
        pieces,
      },
      series: [
        {
          name: 'Power Consumption',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          data: chartData.hourlyAvg,
          lineStyle: {
            width: 2.5,
          },
          areaStyle: {
            opacity: 0.1,
          },
          markArea: {
            silent: true,
            itemStyle: {
              color: 'rgba(255, 173, 177, 0.25)',
              borderColor: 'rgba(239, 68, 68, 0.3)',
              borderWidth: 1,
              borderType: 'dashed',
            },
            label: {
              show: true,
              position: 'top',
              color: '#dc2626',
              fontSize: 10,
              fontWeight: 500,
            },
            data: markAreaData,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              color: themeColors.textSubtle,
              type: 'dashed',
              width: 1,
            },
            label: {
              show: true,
              position: 'end',
              fontSize: 10,
              color: themeColors.textMuted,
              formatter: (params: any) => `${t('results.energy.avg')}: ${formatPower(Number(params?.value ?? 0))}`,
            },
            data: [
              {
                yAxis: chartData.avgLoad,
                label: {
                  formatter: `${t('results.energy.avg')}: ${formatPower(chartData.avgLoad)}`,
                },
              },
            ],
          },
        },
      ],
    };
  }, [chartData, title, t, themeColors]);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.energy.noDataLoadProfile')}
      </div>
    );
  }

  return (
    <div>
      <ReactECharts
        option={option}
        style={{ height, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />

      {/* Legend and stats */}
      <div className="flex flex-wrap justify-center gap-4 text-xs mt-2">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          <span className="text-muted-foreground">{t('results.energy.offPeak')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          <span className="text-muted-foreground">{t('results.energy.peakPeriod')}</span>
        </div>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">
          {t('results.energy.peak')}: <b className="text-red-600">{formatPower(chartData.peakValue)}</b> {t('results.energy.at')} {chartData.peakHour.toString().padStart(2, '0')}:00
        </span>
        <span className="text-muted-foreground">
          {t('results.energy.min')}: <b className="text-green-600">{formatPower(chartData.minValue)}</b> {t('results.energy.at')} {chartData.minHour.toString().padStart(2, '0')}:00
        </span>
      </div>
    </div>
  );
};
