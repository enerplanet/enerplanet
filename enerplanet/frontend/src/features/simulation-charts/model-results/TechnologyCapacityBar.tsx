import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';

interface TechCapacity {
  technology: string;
  installed_capacity_kw: number;
  utilized_capacity_kw: number;
  capacity_factor: number;
  type?: 'supply' | 'demand';
}

interface TechnologyCapacityBarProps {
  data: TechCapacity[];
  height?: number;
}

const formatCapacity = (kw: number): string => {
  const abs = Math.abs(kw);
  if (abs >= 1000) return `${(kw / 1000).toFixed(1)} MW`;
  if (abs >= 10) return `${kw.toFixed(0)} kW`;
  if (abs >= 1) return `${kw.toFixed(1)} kW`;
  if (abs > 0) return `${(kw * 1000).toFixed(0)} W`;
  return '0 kW';
};


export const TechnologyCapacityBar: FC<TechnologyCapacityBarProps> = ({
  data,
  height = 320,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  
  const option: EChartsOption = useMemo(() => {
    const sortedData = [...data].sort((a, b) => b.installed_capacity_kw - a.installed_capacity_kw);
    const technologies = sortedData.map(d => d.technology);
    const installed = sortedData.map(d => d.installed_capacity_kw);
    const capacityFactors = sortedData.map(d => d.capacity_factor * 100);
    const colors = sortedData.map(d => getTechColor(d.technology));
    const manyTechs = technologies.length > 5;

    // Use a distinct purple/indigo color for the line so it doesn't clash with Solar PV (yellow/orange)
    const lineMetricColor = '#8b5cf6';

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
          // Since trigger is 'axis', params is an array of data for each series
          const idx = params[0].dataIndex;
          const item = sortedData[idx];
          const isDemand = item.type === 'demand';
          const utilizationPercent = (item.capacity_factor * 100).toFixed(1);

          const labels = {
            installed: isDemand ? t('results.chartLabels.peakDemand', 'Peak Demand') : t('results.chartLabels.installedGen', 'Installed Generation'),
            utilized: isDemand ? t('results.chartLabels.avgConsumption', 'Avg. Consumption') : t('results.chartLabels.avgProduction', 'Avg. Production'),
            factor: isDemand ? t('results.chartLabels.demandFactor', 'Demand Factor') : t('results.chartLabels.capacityFactor', 'Capacity Factor'),
            hint: isDemand 
              ? t('results.tooltips.demandFactorHint', 'Average consumption level throughout the simulation year relative to technical peak demand.')
              : t('results.tooltips.capacityFactorHint', 'Average production level throughout the simulation year relative to technical maximum.')
          };

          return `
            <div style="font-weight: 600; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid ${themeColors.gridLine}; padding-bottom: 8px; color: ${themeColors.text};">
              ${item.technology}
              <span style="font-size: 10px; font-weight: normal; margin-left: 8px; padding: 2px 6px; border-radius: 4px; background: ${isDemand ? '#fee2e2' : '#dcfce7'}; color: ${isDemand ? '#991b1b' : '#166534'};">
                ${isDemand ? t('results.techTypes.demand', 'Demand') : t('results.techTypes.supply', 'Supply')}
              </span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px; min-width: 220px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: ${themeColors.textMuted}; font-size: 12px;">${labels.installed}</span>
                <span style="font-weight: 600; color: ${themeColors.text};">${formatCapacity(item.installed_capacity_kw)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: ${themeColors.textMuted}; font-size: 12px;">${labels.utilized}</span>
                <span style="font-weight: 600; color: ${themeColors.text};">${formatCapacity(item.utilized_capacity_kw)}</span>
              </div>
              
              <div style="margin-top: 4px; padding-top: 8px; border-top: 1px dashed ${themeColors.gridLine};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="color: ${themeColors.textMuted}; font-size: 12px; font-weight: 500;">${labels.factor}</span>
                  <span style="font-weight: 700; color: ${lineMetricColor}; font-size: 14px;">${utilizationPercent}%</span>
                </div>
                <div style="width: 100%; height: 8px; background: ${themeColors.gridLine}; border-radius: 4px; overflow: hidden;">
                  <div style="width: ${utilizationPercent}%; height: 100%; background: ${lineMetricColor}; border-radius: 4px;"></div>
                </div>
                <div style="font-size: 10px; color: ${themeColors.textSubtle}; margin-top: 8px; line-height: 1.4; font-style: italic;">
                  ${labels.hint}
                </div>
              </div>
            </div>
          `;
        },
      },
      legend: {
        data: [t('results.chartLabels.installedCapacity'), t('results.chartLabels.capacityFactor')],
        top: 0,
        textStyle: { fontSize: 11, color: themeColors.textMuted },
        itemWidth: 14,
        itemHeight: 14,
        icon: 'roundRect'
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'filter',
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'filter',
          bottom: 0,
          height: 20,
          borderColor: 'transparent',
          backgroundColor: themeColors.background,
          fillerColor: 'rgba(139, 92, 246, 0.2)',
          handleStyle: {
            color: '#8b5cf6',
          },
          textStyle: {
            color: themeColors.textMuted,
          },
        }
      ],
      grid: {
        left: '3%',
        right: '3%',
        top: '12%',
        bottom: manyTechs ? 65 : 45,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: technologies,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: themeColors.text,
          fontWeight: 500,
          interval: 0,
          rotate: manyTechs ? 35 : 0,
          overflow: 'truncate' as const,
          width: manyTechs ? 90 : 120,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: t('results.chartLabels.capacityKw'),
          nameTextStyle: { fontSize: 11, color: themeColors.textMuted, align: 'left' },
          axisLabel: { 
            fontSize: 10, 
            color: themeColors.textSubtle,
            formatter: (value: number) => formatCapacity(value),
          },
          splitLine: { 
            lineStyle: { 
              color: themeColors.gridLine, 
              type: 'dashed',
              opacity: 0.5,
            } 
          },
        },
        {
          type: 'value',
          name: t('results.chartLabels.capacityFactor'),
          nameTextStyle: { fontSize: 11, color: themeColors.textMuted, align: 'right' },
          min: 0,
          max: 100,
          axisLabel: { 
            fontSize: 10, 
            color: themeColors.textSubtle,
            formatter: '{value}%',
          },
          splitLine: { show: false },
        }
      ],
      series: [
        {
          name: t('results.chartLabels.installedCapacity'),
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 60,
          data: installed.map((val, idx) => ({
            value: val,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: colors[idx] },
                  { offset: 1, color: `${colors[idx]}cc` },
                ],
              },
              borderRadius: [4, 4, 0, 0],
            },
          })),
          label: {
            show: true,
            position: 'top',
            fontSize: manyTechs ? 9 : 11,
            fontWeight: 600,
            color: themeColors.text,
            formatter: (params: any) => formatCapacity(params.value),
          },
        },
        {
          name: t('results.chartLabels.capacityFactor'),
          type: 'line',
          yAxisIndex: 1,
          data: capacityFactors,
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: {
            color: lineMetricColor,
            borderColor: themeColors.background,
            borderWidth: 2,
          },
          lineStyle: {
            width: 2,
            type: 'dashed',
            color: lineMetricColor,
          },
        }
      ],
      animationDuration: 1000,
      animationEasing: 'elasticOut',
    };
  }, [data, t, themeColors]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.chartLabels.noCapacityData')}
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
