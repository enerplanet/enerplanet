import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createChartGrid, createDataZoomWithStyle, createTimeXAxis, createSplitLineStyle, useThemeColors } from './chartUtils';

interface PyPSALossesChartProps {
  timestamps: string[];
  lineLossesKw: number[];
  transformerLossesKw: number[];
  height?: number;
  title?: string;
}

export const PyPSALossesChart = ({
  timestamps,
  lineLossesKw,
  transformerLossesKw,
  height = 260,
  title = 'Network Losses',
}: PyPSALossesChartProps) => {
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
          lines.push(`${item.marker} ${item.seriesName}: <b>${item.value.toFixed(3)} kW</b>`);
        });
        return lines.join('<br/>');
      },
    },
    legend: {
      top: 28,
      textStyle: { color: themeColors.textMuted },
      data: ['Line losses', 'Transformer losses'],
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
        name: 'Line losses',
        type: 'line',
        smooth: true,
        data: lineLossesKw,
        lineStyle: { color: '#f97316', width: 2 },
        areaStyle: { color: 'rgba(249, 115, 22, 0.12)' },
      },
      {
        name: 'Transformer losses',
        type: 'line',
        smooth: true,
        data: transformerLossesKw,
        lineStyle: { color: '#ef4444', width: 2 },
        areaStyle: { color: 'rgba(239, 68, 68, 0.10)' },
      },
    ],
    dataZoom: createDataZoomWithStyle(),
  }), [lineLossesKw, themeColors, timestamps, title, transformerLossesKw]);

  if (timestamps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No network loss data available.
      </div>
    );
  }

  return <ReactECharts option={option} style={{ height, width: '100%' }} />;
};
