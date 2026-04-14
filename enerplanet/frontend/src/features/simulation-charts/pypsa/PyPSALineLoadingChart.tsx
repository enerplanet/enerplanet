import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createSplitLineStyle, useThemeColors } from './chartUtils';

interface LineLoadingItem {
  name: string;
  peakApparentKva: number;
  peakLossKw: number;
  peakLoadingPercent?: number;
}

interface PyPSALineLoadingChartProps {
  items: LineLoadingItem[];
  height?: number;
  title?: string;
}

const formatKva = (value: number): string => {
  if (!Number.isFinite(value)) return '0 kVA';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(2)} MVA`;
  return `${value.toFixed(1)} kVA`;
};

export const PyPSALineLoadingChart = ({
  items,
  height = 260,
  title = 'Peak Line Flow',
}: PyPSALineLoadingChartProps) => {
  const themeColors = useThemeColors();

  const option = useMemo(() => {
    const displayItems = [...items]
      .sort((a, b) => b.peakApparentKva - a.peakApparentKva)
      .slice(0, 12);

    return {
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
        axisPointer: { type: 'shadow' },
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        textStyle: { color: themeColors.text },
        formatter: (params: any) => {
          const item = displayItems[params[0].dataIndex];
          const lines = [
            `<div style="font-weight:600;margin-bottom:4px;color:${themeColors.text};">${item.name}</div>`,
            `<div>Peak apparent flow: <b>${formatKva(item.peakApparentKva)}</b></div>`,
            `<div>Peak active loss: <b>${item.peakLossKw.toFixed(2)} kW</b></div>`,
          ];
          if (item.peakLoadingPercent !== undefined) {
            lines.push(`<div>Rated loading: <b>${item.peakLoadingPercent.toFixed(1)}%</b></div>`);
          }
          return lines.join('');
        },
      },
      grid: {
        left: 170, // Increased to fit the line names e.g., "Trafo_1542_mv_Trafo..."
        right: 40,
        top: 40,
        bottom: 25,
      },
      xAxis: {
        type: 'value',
        name: displayItems.some(item => item.peakLoadingPercent !== undefined) ? 'Peak flow' : 'kVA',
        axisLabel: {
          color: themeColors.textMuted,
          formatter: (value: number) => formatKva(value),
        },
        splitLine: createSplitLineStyle(),
      },
      yAxis: {
        type: 'category',
        data: displayItems.map(item => item.name),
        axisLabel: {
          color: themeColors.textMuted,
          formatter: (value: string) => (value.length > 25 ? `${value.slice(0, 25)}...` : value),
        },
      },
      series: [
        {
          name: 'Peak apparent flow',
          type: 'bar',
          data: displayItems.map(item => item.peakApparentKva),
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: 'right',
            color: themeColors.text,
            formatter: ({ value }: { value: number }) => formatKva(value),
          },
        },
      ],
    };
  }, [items, themeColors, title]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No line flow data available.
      </div>
    );
  }

  return <ReactECharts option={option} style={{ height, width: '100%' }} />;
};
