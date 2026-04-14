import { FC, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CarrierConRecord, CarrierProdRecord } from '@/features/model-results/types';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';

interface LoadDurationCurveProps {
  consumption?: CarrierConRecord[];
  production?: CarrierProdRecord[];
  height?: number;
  title?: string;
}

const extractHourFromTimestamp = (timestamp: string): number | null => {
  // Use regex to find the hour part in ISO (T14:00) or Space ( 14:00) format.
  // This preserves the simulation's local time regardless of browser TZ.
  const match = timestamp.match(/[T\s](\d{2}):/);
  if (match) {
    const hour = Number.parseInt(match[1], 10);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour;
  }

  // Fallback to Date object if string parsing fails
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

export const LoadDurationCurve: FC<LoadDurationCurveProps> = ({
  consumption,
  production,
  height = 320,
  title = 'Load Duration Curve',
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const [selectedTech, setSelectedTech] = useState('all');

  const TECH_FILTERS = [
    { id: 'all', label: t('results.energy.all'), color: '#3b82f6' },
    { id: 'pv', label: t('results.energy.solarPv'), color: '#f59e0b' },
    { id: 'wind', label: t('results.energy.wind'), color: '#22c55e' },
    { id: 'biomass', label: t('results.energy.biomass'), color: '#84cc16' },
    { id: 'geothermal', label: t('results.energy.geothermal'), color: '#ef4444' },
  ];

  const chartData = useMemo(() => {
    const data = production || consumption;
    if (!data || data.length === 0) return null;

    // Filter by selected technology
    const filterTech = (techs: string): boolean => {
      if (selectedTech === 'all') return true;
      const lowerTechs = techs.toLowerCase();
      switch (selectedTech) {
        case 'pv': return lowerTechs.includes('pv') || lowerTechs.includes('solar');
        case 'wind': return lowerTechs.includes('wind');
        case 'biomass': return lowerTechs.includes('biomass');
        case 'geothermal': return lowerTechs.includes('geothermal');
        default: return true;
      }
    };

    // Aggregate system power by timestamp first, then by hour of day.
    const timestampTotals = new Map<string, number>();

    data.forEach(record => {
      if (record.carrier !== 'power' || !record.techs || record.techs.includes('power_transmission')) return;
      if (!filterTech(record.techs)) return;

      timestampTotals.set(
        record.timestep,
        (timestampTotals.get(record.timestep) || 0) + Math.abs(record.value)
      );
    });

    const hourlyData: Map<number, number[]> = new Map();
    for (let h = 0; h < 24; h++) {
      hourlyData.set(h, []);
    }

    timestampTotals.forEach((total, timestamp) => {
      const hour = extractHourFromTimestamp(timestamp);
      if (hour === null) return;
      const values = hourlyData.get(hour) || [];
      values.push(total);
      hourlyData.set(hour, values);
    });

    // Calculate average for each hour
    const hourlyAvg: { hour: number; avg: number; max: number; min: number }[] = [];
    let peakLoad = 0;
    let minLoad = Infinity;
    let totalSum = 0;
    let totalCount = 0;

    for (let hour = 0; hour < 24; hour++) {
      const values = hourlyData.get(hour) || [];
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        hourlyAvg.push({ hour, avg, max, min });
        if (max > peakLoad) peakLoad = max;
        if (min < minLoad) minLoad = min;
        totalSum += values.reduce((a, b) => a + b, 0);
        totalCount += values.length;
      } else {
        hourlyAvg.push({ hour, avg: 0, max: 0, min: 0 });
      }
    }

    const avgLoad = totalCount > 0 ? totalSum / totalCount : 0;
    if (minLoad === Infinity) minLoad = 0;

    return { hourlyAvg, peakLoad, minLoad, avgLoad };
  }, [consumption, production, selectedTech]);

  const selectedColor = TECH_FILTERS.find(t => t.id === selectedTech)?.color || '#3b82f6';

  const option: EChartsOption = useMemo(() => {
    if (!chartData) return {};

    const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

    return {
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500, color: themeColors.text },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          const data = chartData.hourlyAvg[params[0]?.dataIndex];
          if (!data) return '';
          return `
            <div style="font-weight: 600; margin-bottom: 6px; color: ${themeColors.text};">${hours[data.hour]}</div>
            <div style="margin-bottom: 4px; color: ${themeColors.text};">${t('results.energy.average')}: <b>${formatPower(data.avg)}</b></div>
            <div style="margin-bottom: 4px; color: ${themeColors.text};">${t('results.energy.peak')}: <b>${formatPower(data.max)}</b></div>
            <div style="color: ${themeColors.text};">${t('results.energy.min')}: <b>${formatPower(data.min)}</b></div>
          `;
        },
      },
      grid: {
        left: '10%',
        right: '5%',
        top: '15%',
        bottom: '15%',
      },
      xAxis: {
        type: 'category',
        data: hours,
        name: t('results.energy.hour'),
        nameLocation: 'center',
        nameGap: 30,
        nameTextStyle: { fontSize: 11, color: themeColors.textMuted },
        axisLabel: {
          fontSize: 9,
          color: themeColors.textSubtle,
          interval: 1,
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
        axisLine: { lineStyle: { color: themeColors.border } },
        splitLine: { lineStyle: { color: themeColors.gridLine } },
      },
      series: [
        {
          name: t('results.energy.average'),
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: chartData.hourlyAvg.map(d => d.avg),
          lineStyle: {
            color: selectedColor,
            width: 2,
          },
          itemStyle: {
            color: selectedColor,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${selectedColor}40` },
                { offset: 1, color: `${selectedColor}08` },
              ],
            },
          },
        },
        // Peak range (max values)
        {
          name: t('results.energy.peak'),
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: chartData.hourlyAvg.map(d => d.max),
          lineStyle: {
            color: selectedColor,
            width: 1,
            type: 'dashed',
            opacity: 0.5,
          },
        },
      ],
    };
  }, [chartData, title, selectedColor, t, themeColors]);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.energy.noDataLoadCurve')}
      </div>
    );
  }

  return (
    <div>
      {/* Technology Filter */}
      <div className="flex flex-wrap gap-2 mb-3">
        {TECH_FILTERS.map(tech => (
          <button
            key={tech.id}
            onClick={() => setSelectedTech(tech.id)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedTech === tech.id
                ? 'text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            style={selectedTech === tech.id ? { backgroundColor: tech.color } : {}}
          >
            {tech.label}
          </button>
        ))}
      </div>

      <ReactECharts
        option={option}
        style={{ height, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />

      <div className="flex justify-center gap-6 text-xs text-muted-foreground mt-2">
        <span>{t('results.energy.peak')}: <b style={{ color: selectedColor }}>{formatPower(chartData.peakLoad)}</b></span>
        <span>{t('results.energy.average')}: <b style={{ color: selectedColor }}>{formatPower(chartData.avgLoad)}</b></span>
        <span>{t('results.energy.min')}: <b style={{ color: selectedColor }}>{formatPower(chartData.minLoad)}</b></span>
      </div>
    </div>
  );
};
