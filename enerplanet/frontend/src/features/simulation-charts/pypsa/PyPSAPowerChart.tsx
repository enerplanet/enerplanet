import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import { createTimeXAxis, createDataZoom, createSplitLineStyle } from './chartUtils';

interface PowerFlowChartProps {
  timestamps: string[];
  activePower: number[];   // P values in kW
  reactivePower?: number[]; // Q values in kVAr
  height?: number;
  title?: string;
  showReactive?: boolean;
}

const formatPower = (value: number, unit: 'kW' | 'kVAr' = 'kW'): string => {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const megaUnit = unit === 'kW' ? 'MW' : 'MVAr';
  const baseUnit = unit;
  const subUnit = unit === 'kW' ? 'W' : 'VAr';
  const milliSubUnit = unit === 'kW' ? 'mW' : 'mVAr';

  if (abs >= 1000) return `${(value / 1000).toFixed(2)} ${megaUnit}`;
  if (abs >= 1) return `${value.toFixed(2)} ${baseUnit}`;
  if (abs >= 0.001) return `${(value * 1000).toFixed(1)} ${subUnit}`;
  return `${(value * 1_000_000).toFixed(1)} ${milliSubUnit}`;
};

export const PyPSAPowerChart = ({ 
  timestamps, 
  activePower,
  reactivePower,
  height = 300,
  title = 'Power Flow',
  showReactive = true,
}: PowerFlowChartProps) => {
  const option = useMemo(() => {
    const series: any[] = [
      {
        name: 'Active Power (P)',
        type: 'line',
        data: activePower,
        smooth: true,
        lineStyle: {
          color: '#10b981',
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
              { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.05)' },
            ],
          },
        },
      },
    ];

    if (showReactive && reactivePower && reactivePower.length > 0) {
      series.push({
        name: 'Reactive Power (Q)',
        type: 'line',
        data: reactivePower,
        smooth: true,
        lineStyle: {
          color: '#8b5cf6',
          width: 2,
          type: 'dashed',
        },
      });
    }

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
          let html = `${params[0].axisValue}<br/>`;
          params.forEach((p: any) => {
            const unit = p.seriesName.includes('Reactive') ? 'kVAr' : 'kW';
            html += `${p.marker} ${p.seriesName}: ${formatPower(p.value, unit)}<br/>`;
          });
          return html;
        },
      },
      legend: {
        bottom: 25,
        data: showReactive && reactivePower ? ['Active Power (P)', 'Reactive Power (Q)'] : ['Active Power (P)'],
        itemWidth: 12,
        itemHeight: 12,
        icon: 'roundRect',
      },
      grid: {
        left: '12%',
        right: '5%',
        top: '15%',
        bottom: '28%',
      },
      xAxis: createTimeXAxis(timestamps),
      yAxis: {
        type: 'value',
        name: 'Power',
        axisLabel: {
          formatter: (value: number) => formatPower(value, 'kW'),
        },
        splitLine: createSplitLineStyle(),
      },
      series,
      dataZoom: createDataZoom(),
    };
  }, [timestamps, activePower, reactivePower, title, showReactive]);

  return (
    <div className="w-full">
      <ReactECharts option={option} style={{ height }} />
    </div>
  );
};
