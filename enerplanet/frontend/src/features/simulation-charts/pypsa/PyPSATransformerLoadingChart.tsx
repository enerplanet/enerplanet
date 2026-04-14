import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createChartGrid, createSplitLineStyle, useThemeColors } from './chartUtils';

interface TransformerLoadingItem {
  name: string;
  peakApparentKva: number;
  peakLoadingPercent?: number;
  ratingKva?: number;
}

interface PyPSATransformerLoadingChartProps {
  items: TransformerLoadingItem[];
  height?: number;
  title?: string;
}

const formatKva = (value: number): string => {
  if (!Number.isFinite(value)) return '0 kVA';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(2)} MVA`;
  return `${value.toFixed(1)} kVA`;
};

export const PyPSATransformerLoadingChart = ({
  items,
  height = 260,
  title = 'Transformer Loading',
}: PyPSATransformerLoadingChartProps) => {
  const themeColors = useThemeColors();

  const option = useMemo(() => {
    const hasPercent = items.some(item => item.peakLoadingPercent !== undefined);
    const displayItems = [...items]
      .sort((a, b) => {
        if (hasPercent) {
          return (b.peakLoadingPercent || 0) - (a.peakLoadingPercent || 0);
        }
        return b.peakApparentKva - a.peakApparentKva;
      })
      .slice(0, 8);

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
          ];
          if (item.ratingKva) {
            lines.push(`<div>Rated capacity: <b>${formatKva(item.ratingKva)}</b></div>`);
          }
          if (item.peakLoadingPercent !== undefined) {
            lines.push(`<div>Peak loading: <b>${item.peakLoadingPercent.toFixed(1)}%</b></div>`);
          }
          return lines.join('');
        },
      },
      grid: createChartGrid(18),
      xAxis: {
        type: 'value',
        name: hasPercent ? 'Loading %' : 'kVA',
        max: hasPercent ? Math.max(100, ...displayItems.map(item => item.peakLoadingPercent || 0)) * 1.1 : undefined,
        axisLabel: {
          color: themeColors.textMuted,
          formatter: hasPercent
            ? (value: number) => `${value.toFixed(0)}%`
            : (value: number) => formatKva(value),
        },
        splitLine: createSplitLineStyle(),
      },
      yAxis: {
        type: 'category',
        data: displayItems.map(item => item.name),
        axisLabel: {
          color: themeColors.textMuted,
          formatter: (value: string) => (value.length > 20 ? `${value.slice(0, 20)}...` : value),
        },
      },
      series: [
        {
          name: hasPercent ? 'Peak loading' : 'Peak apparent flow',
          type: 'bar',
          data: displayItems.map(item => (hasPercent ? item.peakLoadingPercent || 0 : item.peakApparentKva)),
          itemStyle: {
            color: '#10b981',
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: 'right',
            color: themeColors.text,
            formatter: ({ value }: { value: number }) =>
              hasPercent ? `${value.toFixed(1)}%` : formatKva(value),
          },
        },
      ],
    };
  }, [items, themeColors, title]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No transformer loading data available.
      </div>
    );
  }

  return <ReactECharts option={option} style={{ height, width: '100%' }} />;
};
