import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';

interface GaugeMetric {
  name: string;
  value: number;
  max?: number;
  unit?: string;
  color?: string;
}

interface PerformanceGaugesProps {
  selfConsumption: number;
  gridDependency: number;
  capacityUtilization: number;
  co2Reduction?: number;
  height?: number;
}

const SingleGauge = ({ metric, themeColors }: { metric: GaugeMetric, themeColors: any }) => {
  const option: EChartsOption = useMemo(() => ({
    series: [
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '95%',
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        itemStyle: {
          color: metric.color,
          shadowColor: `${metric.color}40`,
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
        },
        progress: {
          show: true,
          roundCap: true,
          width: 12,
        },
        pointer: {
          show: false,
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 12,
            color: [[1, themeColors.border]],
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: false,
        },
        title: {
          show: false, // We'll render title in HTML below the chart
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '15%'],
          fontSize: 22,
          fontWeight: 700,
          formatter: '{value}%',
          color: metric.color,
        },
        data: [{ value: Math.round(metric.value * 10) / 10, name: metric.name }],
      },
    ],
  }), [metric, themeColors]);

  return (
    <div className="flex flex-col items-center justify-center">
      <ReactECharts
        option={option}
        style={{ height: 120, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
      <span className="text-xs font-medium text-muted-foreground mt-1 text-center truncate w-full px-2">
        {metric.name}
      </span>
    </div>
  );
};

export const PerformanceGauges: FC<PerformanceGaugesProps> = ({
  selfConsumption,
  gridDependency,
  capacityUtilization,
  co2Reduction = 0,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  
  const metrics: GaugeMetric[] = [
    { name: t('results.gauges.selfConsumption', 'Self-Consumption'), value: selfConsumption * 100, color: '#10b981' },
    { name: t('results.gauges.gridIndependence', 'Grid Independence'), value: (1 - gridDependency) * 100, color: '#3b82f6' },
    { name: t('results.gauges.capacityFactor', 'Capacity Factor'), value: capacityUtilization * 100, color: '#8b5cf6' },
    { name: t('results.gauges.co2Reduction', 'CO₂ Reduction'), value: Math.min(co2Reduction, 100), color: '#22c55e' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
      {metrics.map((metric, index) => (
        <SingleGauge key={index} metric={metric} themeColors={themeColors} />
      ))}
    </div>
  );
};
