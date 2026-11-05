import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createSplitLineStyle, isOverloaded, useThemeColors, saveImageToolbox } from './chartUtils';
import { formatNumber } from '@/utils/formatNumber';

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
  // When true the percentages are flow/capacity utilisation, not electrical
  // loading — relabel the axis and tooltip accordingly (meaning differs, data
  // is real; this is a relabel, never a hide).
  utilizationOnly?: boolean;
  // Losses are a declared capability: a source without loss data must not show
  // a fake "0.00 kW" line. Default true keeps legacy results unchanged.
  lossesAvailable?: boolean;
}

const formatKva = (value: number): string => {
  if (!Number.isFinite(value)) return '0 kVA';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${formatNumber(value / 1000, 2)} MVA`;
  return `${formatNumber(value, 1)} kVA`;
};

export const PyPSALineLoadingChart = ({
  items,
  height = 260,
  title = 'Peak Line Flow',
  utilizationOnly = false,
  lossesAvailable = true,
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
          ];
          // Only show the loss figure when the result actually carries loss data.
          if (lossesAvailable) {
            lines.push(`<div>Peak active loss: <b>${formatNumber(item.peakLossKw, 2)} kW</b></div>`);
          }
          if (item.peakLoadingPercent !== undefined) {
            const overloaded = isOverloaded(item.peakLoadingPercent);
            lines.push(`<div${overloaded ? ' style="color:#ef4444;font-weight:600;"' : ''}>${utilizationOnly ? 'Utilization' : 'Rated loading'}: <b>${formatNumber(item.peakLoadingPercent, 1)}%</b>${overloaded ? ' ⚠' : ''}</div>`);
          }
          return lines.join('');
        },
      },
      grid: {
        left: 170, // Increased to fit the line names e.g., "Trafo_1542_mv_Trafo..."
        right: 80, // room for the value label of the longest bar
        top: 40,
        bottom: 40,
      },
      xAxis: {
        type: 'value',
        nameLocation: 'middle',
        nameGap: 22,
        name: !utilizationOnly && displayItems.some(item => item.peakLoadingPercent !== undefined) ? 'Peak flow (kVA)' : 'kVA',
        axisLabel: {
          color: themeColors.textMuted,
          hideOverlap: true,
          formatter: (value: number) => formatNumber(value, 0),
        },
        splitLine: createSplitLineStyle(),
      },
      yAxis: {
        type: 'category',
        data: displayItems.map(item => item.name),
        axisLabel: {
          color: themeColors.textMuted,
          interval: 0,
          fontSize: 10,
          formatter: (value: string) => (value.length > 25 ? `${value.slice(0, 25)}...` : value),
        },
      },
      series: [
        {
          name: 'Peak apparent flow',
          type: 'bar',
          data: displayItems.map(item => ({
            value: item.peakApparentKva,
            itemStyle: {
              // Red when the wire's peak utilisation exceeds its rating; the
              // other wires keep the neutral blue. Colour is per bar.
              color: isOverloaded(item.peakLoadingPercent) ? '#ef4444' : '#3b82f6',
              borderRadius: [0, 6, 6, 0],
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: themeColors.text,
            formatter: ({ value }: { value: number }) => formatKva(value),
          },
        },
      ],
    };
  }, [items, themeColors, title, utilizationOnly, lossesAvailable]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No line flow data available.
      </div>
    );
  }

  return <ReactECharts option={{ ...option, toolbox: saveImageToolbox(themeColors, 'line-loading') }} style={{ height, width: '100%' }} />;
};
