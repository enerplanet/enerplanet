import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import { createChartGrid, createTimeXAxis, createDataZoom, createSplitLineStyle } from './chartUtils';
import { formatNumber } from '@/utils/formatNumber';

interface VoltageChartProps {
  timestamps: string[];
  voltage: number[];  // v_mag_pu values
  height?: number;
  title?: string;
}

export const PyPSAVoltageChart = ({ 
  timestamps, 
  voltage, 
  height = 300,
  title = 'Voltage Profile'
}: VoltageChartProps) => {
  const option = useMemo(() => {
    // Calculate voltage bounds (typically 0.95 - 1.05 pu)
    const minV = Math.min(...voltage);
    const maxV = Math.max(...voltage);

    return {
      title: {
        text: title,
        left: 'center',
        textStyle: {
          fontSize: 14,
          fontWeight: 500,
        },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (params: any) => {
          const point = params[0];
          return `${point.axisValue}<br/>Voltage: ${formatNumber(point.value, 4)} pu`;
        },
      },
      grid: createChartGrid(15),
      xAxis: createTimeXAxis(timestamps),
      yAxis: {
        type: 'value',
        name: 'Voltage (pu)',
        min: Math.max(0.9, minV - 0.02),
        max: Math.min(1.1, maxV + 0.02),
        axisLabel: {
          formatter: (value: number) => formatNumber(value, 3),
        },
        splitLine: createSplitLineStyle(),
      },
      series: [
        {
          name: 'Voltage',
          type: 'line',
          data: voltage,
          smooth: true,
          lineStyle: {
            color: '#3b82f6',
            width: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                { offset: 1, color: 'rgba(59, 130, 246, 0.05)' },
              ],
            },
          },
          markLine: {
            silent: true,
            data: [
              {
                yAxis: 1,
                lineStyle: { color: '#10b981', type: 'dashed' },
                label: { formatter: 'Nominal' },
              },
              {
                yAxis: 0.95,
                lineStyle: { color: '#f59e0b', type: 'dashed' },
                label: { formatter: 'Lower limit' },
              },
              {
                yAxis: 1.05,
                lineStyle: { color: '#f59e0b', type: 'dashed' },
                label: { formatter: 'Upper limit' },
              },
            ],
          },
        },
      ],
      dataZoom: createDataZoom(),
    };
  }, [timestamps, voltage, title]);

  return (
    <div className="w-full">
      <ReactECharts option={option} style={{ height }} />
      <div className="flex justify-center gap-6 mt-2 text-xs text-muted-foreground">
        <span>Min: {formatNumber(Math.min(...voltage), 4)} pu</span>
        <span>Max: {formatNumber(Math.max(...voltage), 4)} pu</span>
        <span>Avg: {formatNumber(voltage.reduce((a, b) => a + b, 0) / voltage.length, 4)} pu</span>
      </div>
    </div>
  );
};

