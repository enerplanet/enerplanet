import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { createChartGrid, createSplitLineStyle, useThemeColors } from './chartUtils';

interface VoltageViolationItem {
  name: string;
  hoursOutside: number;
  maxDeviationPu: number;
}

interface PyPSAVoltageViolationChartProps {
  items: VoltageViolationItem[];
  height?: number;
  title?: string;
}

export const PyPSAVoltageViolationChart = ({
  items,
  height = 260,
  title = 'Voltage Violations',
}: PyPSAVoltageViolationChartProps) => {
  const themeColors = useThemeColors();

  const option = useMemo(() => {
    const displayItems = [...items]
      .sort((a, b) => b.hoursOutside - a.hoursOutside || b.maxDeviationPu - a.maxDeviationPu)
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
          return [
            `<div style="font-weight:600;margin-bottom:4px;color:${themeColors.text};">${item.name}</div>`,
            `<div>Hours outside 0.95-1.05 pu: <b>${item.hoursOutside.toFixed(1)} h</b></div>`,
            `<div>Worst deviation: <b>${item.maxDeviationPu.toFixed(4)} pu</b></div>`,
          ].join('');
        },
      },
      grid: createChartGrid(18),
      xAxis: {
        type: 'value',
        name: 'Hours',
        axisLabel: { color: themeColors.textMuted },
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
          name: 'Hours outside limits',
          type: 'bar',
          data: displayItems.map(item => item.hoursOutside),
          itemStyle: {
            color: '#f59e0b',
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: 'right',
            color: themeColors.text,
            formatter: ({ value }: { value: number }) => `${value.toFixed(1)} h`,
          },
        },
      ],
    };
  }, [items, themeColors, title]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        No voltage violations for this run.
      </div>
    );
  }

  return <ReactECharts option={option} style={{ height, width: '100%' }} />;
};
