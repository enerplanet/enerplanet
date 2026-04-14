import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CarrierProdRecord, CarrierConRecord } from '@/features/model-results/types';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';

interface EnergyBalanceChartProps {
  production: CarrierProdRecord[];
  consumption: CarrierConRecord[];
  height?: number;
}

const FLOATING_POINT_EPSILON = 1e-6;

function normalizeEnergyValue(value: number, precision: number = 3): number {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
}

function formatAxisEnergy(value: number): string {
  const normalized = normalizeEnergyValue(value, 2);
  const absolute = Math.abs(normalized);

  if (normalized === 0) return '0';
  if (absolute >= 1000) {
    return normalized.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (absolute >= 10) {
    return normalized.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return normalized.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const EnergyBalanceChart: FC<EnergyBalanceChartProps> = ({
  production,
  consumption,
  height = 350,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();

  const chartData = useMemo(() => {
    // Input data is now already aggregated by date (daily totals) from the backend
    const dailyProd = new Map<string, Map<string, number>>();
    const dailyCon = new Map<string, number>();
    const dailyGridImport = new Map<string, number>();

    const isGridImport = (tech: string): boolean => {
      const lower = tech.toLowerCase();
      return lower.includes('transformer') || lower.includes('grid_import') || lower.includes('grid import');
    };

    production.forEach(p => {
      const techs = p.techs || '';
      if (!techs || techs.includes('power_transmission')) return;

      const date = p.timestep.substring(0, 10);
      const techBase = techs.split(':')[0].replace(/_supply$/, '').replaceAll('_', ' ');

      if (isGridImport(techBase)) {
        dailyGridImport.set(date, (dailyGridImport.get(date) || 0) + Math.abs(p.value));
        return;
      }

      if (!dailyProd.has(date)) dailyProd.set(date, new Map());
      const dayMap = dailyProd.get(date)!;
      dayMap.set(techBase, (dayMap.get(techBase) || 0) + Math.abs(p.value));
    });

    consumption.forEach(c => {
      if (!c.techs || c.techs.includes('power_transmission')) return;
      const date = c.timestep.substring(0, 10);
      dailyCon.set(date, (dailyCon.get(date) || 0) + Math.abs(c.value));
    });

    const dates = Array.from(new Set([...dailyProd.keys(), ...dailyCon.keys(), ...dailyGridImport.keys()])).sort((a, b) => a.localeCompare(b));

    const techSet = new Set<string>();
    dailyProd.forEach(dayMap => dayMap.forEach((_, tech) => techSet.add(tech)));
    const techs = Array.from(techSet);

    const prodSeries = techs.map(tech => ({
      name: tech,
      data: dates.map(date => {
        const dayMap = dailyProd.get(date);
        return normalizeEnergyValue(dayMap ? (dayMap.get(tech) || 0) : 0);
      }),
      color: getTechColor(tech),
    }));

    const gridImportData = dates.map(date => normalizeEnergyValue(dailyGridImport.get(date) || 0));
    const conData = dates.map(date => normalizeEnergyValue(dailyCon.get(date) || 0));

    const netBalance = dates.map((_, idx) => {
      const totalRenewable = prodSeries.reduce((sum, s) => sum + s.data[idx], 0);
      const gridImport = gridImportData[idx];
      return normalizeEnergyValue(totalRenewable + gridImport - conData[idx]);
    });

    const selfSufficiency = dates.map((_, idx) => {
      const totalRenewable = prodSeries.reduce((sum, s) => sum + s.data[idx], 0);
      const consumption = conData[idx];
      return consumption > 0 ? Math.min(100, (totalRenewable / consumption) * 100) : 0;
    });

    return { dates, prodSeries, gridImportData, conData, netBalance, selfSufficiency };
  }, [production, consumption]);

  const SERIES_KEYS = {
    consumption: 'consumption',
    netBalance: 'netBalance',
    gridImport: 'gridImport',
  };

  const option: EChartsOption = useMemo(() => {
    const { dates, prodSeries, gridImportData, conData, netBalance } = chartData;

    if (dates.length === 0) return {};

    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          const dateIdx = params[0].dataIndex;
          const dateStr = dates[dateIdx];
          const date = new Date(dateStr);
          const formattedDate = date.toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
          });

          let html = `<div style="font-weight: 600; margin-bottom: 8px; border-bottom: 1px solid ${themeColors.border}; padding-bottom: 6px; color: ${themeColors.text};">${formattedDate}</div>`;

          const renewableItems = params.filter((p: any) =>
            p.seriesId !== SERIES_KEYS.consumption &&
            p.seriesId !== SERIES_KEYS.netBalance &&
            p.seriesId !== SERIES_KEYS.gridImport
          );
          let totalRenewable = 0;
          if (renewableItems.length > 0) {
            html += `<div style="font-weight: 500; color: #059669; margin: 4px 0;">${t('results.energy.renewableProduction')}</div>`;
            renewableItems.forEach((item: any) => {
              if (item.value > 0.1) {
                totalRenewable += item.value;
                html += `<div style="display: flex; justify-content: space-between; gap: 20px; margin: 2px 0; color: ${themeColors.text};">
                  <span>${item.marker} ${item.seriesName}</span>
                  <span style="font-weight: 500;">${item.value.toFixed(1)} kWh</span>
                </div>`;
              }
            });
            if (totalRenewable > 0) {
              html += `<div style="display: flex; justify-content: space-between; gap: 20px; margin: 4px 0; padding-top: 4px; border-top: 1px dashed ${themeColors.border}; color: ${themeColors.text};">
                <span style="font-weight: 500;">${t('results.energy.totalRenewable')}</span>
                <span style="font-weight: 600; color: #059669;">${totalRenewable.toFixed(1)} kWh</span>
              </div>`;
            }
          }

          const gridItem = params.find((p: any) => p.seriesId === SERIES_KEYS.gridImport);
          if (gridItem && gridItem.value > 0.1) {
            html += `<div style="font-weight: 500; color: ${themeColors.textMuted}; margin: 8px 0 4px;">${t('results.energy.gridImport')}</div>`;
            html += `<div style="display: flex; justify-content: space-between; gap: 20px; color: ${themeColors.text};">
              <span>${gridItem.marker} ${t('results.energy.fromGrid')}</span>
              <span style="font-weight: 500;">${gridItem.value.toFixed(1)} kWh</span>
            </div>`;
          }

          const conItem = params.find((p: any) => p.seriesId === SERIES_KEYS.consumption);
          if (conItem) {
            html += `<div style="font-weight: 500; color: #dc2626; margin: 8px 0 4px;">${t('results.energy.consumption')}</div>`;
            html += `<div style="display: flex; justify-content: space-between; gap: 20px; color: ${themeColors.text};">
              <span>${conItem.marker} ${t('results.energy.totalDemand')}</span>
              <span style="font-weight: 600; color: #dc2626;">${Math.abs(conItem.value).toFixed(1)} kWh</span>
            </div>`;
          }

          const consumption = conData[dateIdx];
          const selfSuff = consumption > 0 ? Math.min(100, (totalRenewable / consumption) * 100) : 0;

          const netItem = params.find((p: any) => p.seriesId === SERIES_KEYS.netBalance);
          if (netItem) {
            const isPositive = netItem.value >= 0;
            html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${themeColors.border}; color: ${themeColors.text};">
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 4px;">
                <span style="font-weight: 500;">${t('results.energy.selfSufficiency')}</span>
                <span style="font-weight: 600; color: #059669;">${selfSuff.toFixed(1)}%</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px;">
                <span style="font-weight: 500;">${t('results.energy.netBalance')}</span>
                <span style="font-weight: 700; color: ${isPositive ? '#059669' : '#dc2626'};">
                  ${isPositive ? '+' : ''}${netItem.value.toFixed(1)} kWh
                </span>
              </div>
            </div>`;
          }

          return html;
        },
      },
      legend: {
        bottom: 0,
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        icon: 'roundRect',
        textStyle: { fontSize: 10, color: themeColors.textMuted },
      },
      grid: { left: 70, right: 65, top: 30, bottom: 70 },
      xAxis: {
        type: 'category',
        data: dates.map(d => {
          const parts = d.split('-');
          return `${parts[1]}/${parts[2]}`;
        }),
        axisLine: { lineStyle: { color: themeColors.border } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: themeColors.textSubtle,
          interval: Math.max(0, Math.floor(dates.length / 10) - 1),
        },
      },
      yAxis: [
        {
          type: 'value',
          name: t('results.energy.energyKwh'),
          nameLocation: 'middle',
          nameGap: 50,
          nameTextStyle: { fontSize: 11, color: themeColors.textMuted },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            fontSize: 10,
            color: themeColors.textSubtle,
            formatter: (value: number) => formatAxisEnergy(value),
          },
          splitLine: { lineStyle: { color: themeColors.gridLine, type: 'dashed' } },
        },
        {
          type: 'value',
          name: t('results.energy.netKwh'),
          nameLocation: 'middle',
          nameGap: 45,
          nameTextStyle: { fontSize: 11, color: themeColors.textMuted },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            fontSize: 10,
            color: themeColors.textSubtle,
            formatter: (value: number) => formatAxisEnergy(value),
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 20,
          bottom: 28,
          borderColor: themeColors.border,
          fillerColor: 'rgba(59, 130, 246, 0.1)',
          handleStyle: { color: '#3b82f6', borderColor: '#3b82f6' },
          textStyle: { fontSize: 9, color: themeColors.textSubtle },
        },
      ],
      series: [
        ...prodSeries.map((s) => ({
          id: s.name,
          name: s.name,
          type: 'bar' as const,
          stack: 'production',
          barMaxWidth: 20,
          itemStyle: { color: s.color, borderRadius: [0, 0, 0, 0] },
          emphasis: { focus: 'series' as const },
          data: s.data,
        })),
        {
          id: SERIES_KEYS.gridImport,
          name: t('results.energy.gridImport'),
          type: 'bar' as const,
          stack: 'production',
          barMaxWidth: 20,
          itemStyle: { color: '#94a3b8', borderRadius: [0, 0, 0, 0] },
          emphasis: { focus: 'series' as const },
          data: gridImportData,
        },
        {
          id: SERIES_KEYS.consumption,
          name: t('results.energy.consumption'),
          type: 'bar' as const,
          barMaxWidth: 20,
          itemStyle: { color: '#ef4444', borderRadius: [0, 0, 0, 0] },
          emphasis: { focus: 'series' as const },
          data: conData.map(v => -v),
        },
        {
          id: SERIES_KEYS.netBalance,
          name: t('results.energy.netBalance'),
          type: 'line' as const,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#8b5cf6' },
          itemStyle: { color: '#8b5cf6' },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(139, 92, 246, 0.2)' },
                { offset: 0.5, color: 'rgba(139, 92, 246, 0)' },
                { offset: 1, color: 'rgba(139, 92, 246, 0.2)' },
              ],
            },
          },
          emphasis: { focus: 'series' as const },
          data: netBalance,
        },
      ],
    };
  }, [chartData, t, themeColors, SERIES_KEYS.consumption, SERIES_KEYS.gridImport, SERIES_KEYS.netBalance]);

  if (chartData.dates.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.energy.noEnergyBalanceData')}
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
      notMerge={true}
    />
  );
};
