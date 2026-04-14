import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createChartGrid, createDataZoomWithStyle, createTimeXAxis, createSplitLineStyle, useThemeColors } from './chartUtils';

interface PyPSACurtailmentChartProps {
  timestamps: string[];
  availableKw: number[];
  actualKw: number[];
  curtailedKw: number[];
  height?: number;
  title?: string;
}

export const PyPSACurtailmentChart = ({
  timestamps,
  availableKw,
  actualKw,
  curtailedKw,
  height = 260,
  title = 'Renewable Curtailment',
}: PyPSACurtailmentChartProps) => {
  const themeColors = useThemeColors();

  const option = useMemo(() => ({
    title: {
      text: title,
      left: 'center',
      textStyle: {
        fontSize: 14,
        fontWeight: 500,
        color: themeColors.text,
      },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: themeColors.tooltipBg,
      borderColor: themeColors.tooltipBorder,
      textStyle: { color: themeColors.text },
      formatter: (params: any) => {
        const lines = [`<div style="font-weight:600;margin-bottom:4px;color:${themeColors.text};">${params[0].axisValue}</div>`];
        params.forEach((item: any) => {
          lines.push(`${item.marker} ${item.seriesName}: <b>${item.value.toFixed(2)} kW</b>`);
        });
        return lines.join('<br/>');
      },
    },
    legend: {
      top: 28,
      textStyle: { color: themeColors.textMuted },
      data: ['Available', 'Actual', 'Curtailed'],
    },
    grid: createChartGrid(24),
    xAxis: createTimeXAxis(timestamps),
    yAxis: {
      type: 'value',
      name: 'kW',
      axisLabel: { color: themeColors.textMuted },
      splitLine: createSplitLineStyle(),
    },
    series: [
      {
        name: 'Available',
        type: 'line',
        smooth: true,
        data: availableKw,
        lineStyle: { color: '#94a3b8', width: 2, type: 'dashed' },
      },
      {
        name: 'Actual',
        type: 'line',
        smooth: true,
        data: actualKw,
        lineStyle: { color: '#22c55e', width: 2 },
        areaStyle: { color: 'rgba(34, 197, 94, 0.10)' },
      },
      {
        name: 'Curtailed',
        type: 'bar',
        data: curtailedKw,
        itemStyle: { color: '#f59e0b' },
      },
    ],
    dataZoom: createDataZoomWithStyle(),
  }), [actualKw, availableKw, curtailedKw, themeColors, timestamps, title]);

  if (timestamps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No curtailment data available.
      </div>
    );
  }

  return <ReactECharts option={option} style={{ height, width: '100%' }} />;
};
