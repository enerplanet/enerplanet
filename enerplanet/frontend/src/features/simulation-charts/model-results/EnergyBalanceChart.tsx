import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CarrierProdRecord, CarrierConRecord } from '@/features/model-results/types';
import {
  carrierDisplay,
  carrierEnergyAxis,
  formatCarrierEnergy,
} from '@/features/model-results/carrierUnits';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';
import { flowLabel } from '@/features/model-results/buildingFlows';
import { formatNumber } from '@/utils/formatNumber';

interface EnergyBalanceChartProps {
  production: CarrierProdRecord[];
  consumption: CarrierConRecord[];
  /** Carrier the records belong to — drives units and the production wording. */
  carrier?: string;
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
    return formatNumber(normalized, 0, 0);
  }
  if (absolute >= 10) {
    return formatNumber(normalized, 1, 0);
  }
  return formatNumber(normalized, 2, 0);
}

export const EnergyBalanceChart: FC<EnergyBalanceChartProps> = ({
  production,
  consumption,
  carrier,
  height = 350,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const isGeneration = carrierDisplay(carrier).generation;

  const chartData = useMemo(() => {
    // Input data is now already aggregated by date (daily totals) from the backend
    const dailyProd = new Map<string, Map<string, number>>();
    const dailyCon = new Map<string, number>();
    const dailyGridImport = new Map<string, number>();
    const dailyGridExport = new Map<string, number>();
    const dailyDischarge = new Map<string, number>();
    const dailyCharge = new Map<string, number>();

    const add = (map: Map<string, number>, date: string, value: number) =>
      map.set(date, (map.get(date) || 0) + Math.abs(value));
    const isGridImport = (tech: string): boolean => {
      const lower = tech.toLowerCase();
      return lower.includes('transformer') || lower.includes('grid_import') || lower.includes('grid import');
    };
    const isStorage = (tech: string): boolean => /battery|storage/i.test(tech);

    production.forEach(p => {
      const techs = p.techs || '';
      if (!techs || techs.includes('power_transmission')) return;

      const date = p.timestep.substring(0, 10);
      const family = techs.split(':')[0];
      const techBase = family.replace(/_supply$/, '').replaceAll('_', ' ');

      if (isGridImport(techBase)) return add(dailyGridImport, date, p.value);
      if (isStorage(techBase)) return add(dailyDischarge, date, p.value);

      if (!dailyProd.has(date)) dailyProd.set(date, new Map());
      const dayMap = dailyProd.get(date)!;
      dayMap.set(family, (dayMap.get(family) || 0) + Math.abs(p.value));
    });

    consumption.forEach(c => {
      if (!c.techs || c.techs.includes('power_transmission')) return;
      const date = c.timestep.substring(0, 10);
      if (c.techs.toLowerCase().includes('export')) return add(dailyGridExport, date, c.value);
      if (isStorage(c.techs)) return add(dailyCharge, date, c.value);
      add(dailyCon, date, c.value);
    });

    const dates = Array.from(new Set([...dailyProd.keys(), ...dailyCon.keys(), ...dailyGridImport.keys()])).sort((a, b) => a.localeCompare(b));

    const techSet = new Set<string>();
    dailyProd.forEach(dayMap => dayMap.forEach((_, tech) => techSet.add(tech)));
    const techs = Array.from(techSet);

    const prodSeries = techs.map(tech => ({
      name: flowLabel(tech, carrier ?? 'power', t),
      data: dates.map(date => {
        const dayMap = dailyProd.get(date);
        return normalizeEnergyValue(dayMap ? (dayMap.get(tech) || 0) : 0);
      }),
      color: getTechColor(tech),
    }));

    const byDate = (map: Map<string, number>) => dates.map(date => normalizeEnergyValue(map.get(date) || 0));

    return {
      dates,
      prodSeries,
      gridImportData: byDate(dailyGridImport),
      gridExportData: byDate(dailyGridExport),
      dischargeData: byDate(dailyDischarge),
      chargeData: byDate(dailyCharge),
      conData: byDate(dailyCon),
    };
  }, [production, consumption, carrier, t]);

  const option: EChartsOption = useMemo(() => {
    const { dates, prodSeries, gridImportData, gridExportData, dischargeData, chargeData, conData } = chartData;

    if (dates.length === 0) return {};

    const hasBattery = dischargeData.some(v => v > 0) || chargeData.some(v => v > 0);
    const hasExport = gridExportData.some(v => v > 0);
    const batteryColor = getTechColor('battery storage');
    const chargeColor = '#c4b5fd';
    const exportColor = '#0d9488';

    const row = (marker: string, label: string, value: number, valueStyle = 'font-weight: 500;') =>
      `<div style="display: flex; justify-content: space-between; gap: 20px; margin: 2px 0; color: ${themeColors.text};">
        <span>${marker} ${label}</span>
        <span style="${valueStyle}">${formatCarrierEnergy(value, carrier)}</span>
      </div>`;
    const heading = (label: string, color: string) =>
      `<div style="font-weight: 500; color: ${color}; margin: 8px 0 4px;">${label}</div>`;
    const dot = (color: string) =>
      `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color};"></span>`;

    const negativeBar = (id: string, name: string, color: string, data: number[]) => ({
      id,
      name,
      type: 'bar' as const,
      stack: 'use',
      barMaxWidth: 20,
      itemStyle: { color, borderRadius: [0, 0, 0, 0] },
      emphasis: { focus: 'series' as const },
      data: data.map(v => -v),
    });
    const positiveBar = (id: string, name: string, color: string, data: number[]) => ({
      ...negativeBar(id, name, color, data),
      stack: 'production',
      data,
    });

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
          const i = params[0].dataIndex;
          const formattedDate = new Date(dates[i]).toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
          });

          let html = `<div style="font-weight: 600; margin-bottom: 8px; border-bottom: 1px solid ${themeColors.border}; padding-bottom: 6px; color: ${themeColors.text};">${formattedDate}</div>`;

          const produced = prodSeries.filter(s => s.data[i] > 0.1);
          const totalRenewable = produced.reduce((sum, s) => sum + s.data[i], 0);
          if (produced.length > 0) {
            html += `<div style="font-weight: 500; color: #059669; margin: 4px 0;">${isGeneration ? t('results.energy.renewableProduction') : t('results.energy.production')}</div>`;
            produced.forEach(s => { html += row(dot(s.color), s.name, s.data[i]); });
            html += `<div style="display: flex; justify-content: space-between; gap: 20px; margin: 4px 0; padding-top: 4px; border-top: 1px dashed ${themeColors.border}; color: ${themeColors.text};">
              <span style="font-weight: 500;">${isGeneration ? t('results.energy.totalRenewable') : t('results.energy.production')}</span>
              <span style="font-weight: 600; color: #059669;">${formatCarrierEnergy(totalRenewable, carrier)}</span>
            </div>`;
          }

          if (hasBattery) {
            html += heading(t('results.energy.battery'), batteryColor);
            html += row(dot(batteryColor), t('results.energy.batteryDischarging'), dischargeData[i]);
            html += row(dot(chargeColor), t('results.energy.batteryCharging'), chargeData[i]);
          }

          if (gridImportData[i] > 0.1 || gridExportData[i] > 0.1) {
            html += heading(t('results.energy.grid'), themeColors.textMuted);
            html += row(dot('#94a3b8'), t('results.energy.fromGrid'), gridImportData[i]);
            if (hasExport) html += row(dot(exportColor), t('results.chartLabels.gridExport'), gridExportData[i]);
          }

          html += heading(t('results.energy.consumption'), '#dc2626');
          html += row(dot('#ef4444'), t('results.energy.totalDemand'), conData[i], 'font-weight: 600; color: #dc2626;');

          // Self-sufficiency is the share of use not bought from the grid; it
          // is only meaningful for a generating carrier, not for a heat load.
          if (isGeneration && conData[i] > 0) {
            const selfSuff = Math.max(0, Math.min(100, (1 - gridImportData[i] / conData[i]) * 100));
            html += `<div style="display: flex; justify-content: space-between; gap: 20px; margin-top: 8px; padding-top: 8px; border-top: 1px solid ${themeColors.border}; color: ${themeColors.text};">
              <span style="font-weight: 500;">${t('results.energy.selfSufficiency')}</span>
              <span style="font-weight: 600; color: #059669;">${formatNumber(selfSuff, 1)}%</span>
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
      grid: { left: 70, right: 30, top: 30, bottom: 70 },
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
      yAxis: {
        type: 'value',
        name: carrierEnergyAxis(t('results.energy.energy'), carrier),
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
        ...prodSeries.map(s => positiveBar(s.name, s.name, s.color, s.data)),
        ...(hasBattery ? [positiveBar('discharge', t('results.energy.batteryDischarging'), batteryColor, dischargeData)] : []),
        positiveBar('gridImport', t('results.energy.gridImport'), '#94a3b8', gridImportData),
        negativeBar('consumption', t('results.energy.consumption'), '#ef4444', conData),
        ...(hasBattery ? [negativeBar('charge', t('results.energy.batteryCharging'), chargeColor, chargeData)] : []),
        ...(hasExport ? [negativeBar('gridExport', t('results.chartLabels.gridExport'), exportColor, gridExportData)] : []),
      ],
    };
  }, [chartData, t, themeColors, carrier, isGeneration]);

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
