import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors, useIsDarkMode } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';

interface LCOEItem {
  tech: string;
  label: string;
  lcoe: number; // €/kWh
  totalCost?: number;
  investCost?: number;
  variableCost?: number;
  energyProduced?: number; // kWh
}

interface LCOEComparisonChartProps {
  data: LCOEItem[];
  systemLCOE?: number;
  height?: number;
}

export const LCOEComparisonChart: FC<LCOEComparisonChartProps> = ({
  data,
  systemLCOE,
  height = 280,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const isDark = useIsDarkMode();

  const option: EChartsOption = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.lcoe - b.lcoe);
    const labels = sorted.map(d => d.label);
    const values = sorted.map(d => d.lcoe * 100); // Convert to ct/kWh
    const colors = sorted.map(d => getTechColor(d.tech));

    const fmtEur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    const fmtEnergy = (kwh: number) => {
      if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
      return `${kwh.toFixed(1)} kWh`;
    };

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const item = sorted[p.dataIndex];
          const rowStyle = `display: flex; justify-content: space-between; gap: 24px; line-height: 1.8;`;
          const labelStyle = `color: ${themeColors.textMuted}; font-size: 11px;`;
          const valueStyle = `font-weight: 600; color: ${themeColors.text}; font-size: 11px;`;
          const dividerStyle = `border-top: 1px solid ${themeColors.tooltipBorder}; margin: 6px 0;`;

          let html = `<div style="font-weight: 600; margin-bottom: 6px; color: ${themeColors.text}; font-size: 13px;">${p.name}</div>`;

          // Cost per kWh
          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.costPerKwh')}:</span>
            <span style="${valueStyle}">${p.value.toFixed(2)} ct/kWh</span>
          </div>`;

          // Energy produced
          if (item?.energyProduced && item.energyProduced > 0) {
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.energyProduced')}:</span>
              <span style="${valueStyle}">${fmtEnergy(item.energyProduced)}</span>
            </div>`;
          }

          // Total cost
          if (item?.totalCost && item.totalCost > 0) {
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.totalCost')}:</span>
              <span style="${valueStyle}">${fmtEur(item.totalCost)}</span>
            </div>`;
          }

          // Equipment vs Running cost
          if (item?.investCost != null || item?.variableCost != null) {
            html += `<div style="${dividerStyle}"></div>`;
            if (item.investCost != null && item.investCost > 0) {
              html += `<div style="${rowStyle}">
                <span style="${labelStyle}">${t('results.chartLabels.capex')}:</span>
                <span style="${valueStyle}">${fmtEur(item.investCost)}</span>
              </div>`;
            }
            if (item.variableCost != null && item.variableCost > 0) {
              html += `<div style="${rowStyle}">
                <span style="${labelStyle}">${t('results.chartLabels.opex')}:</span>
                <span style="${valueStyle}">${fmtEur(item.variableCost)}</span>
              </div>`;
            }
          }

          // Comparison to system average
          if (systemLCOE && systemLCOE > 0) {
            const ratio = item.lcoe / systemLCOE;
            html += `<div style="${dividerStyle}"></div>`;
            if (ratio < 0.9) {
              const pctCheaper = ((1 - ratio) * 100).toFixed(0);
              html += `<div style="${rowStyle}">
                <span style="color: #16a34a; font-size: 11px; font-weight: 500;">${pctCheaper}% ${t('results.chartLabels.cheaperThanAvg')}</span>
              </div>`;
            } else if (ratio > 1.1) {
              const pctMore = ((ratio - 1) * 100).toFixed(0);
              html += `<div style="${rowStyle}">
                <span style="color: #dc2626; font-size: 11px; font-weight: 500;">${pctMore}% ${t('results.chartLabels.moreExpensiveThanAvg')}</span>
              </div>`;
            }
          }

          return html;
        },
      },
      grid: { left: 10, right: 30, top: 20, bottom: 25, containLabel: true },
      xAxis: {
        type: 'value',
        name: 'ct/kWh',
        nameLocation: 'end',
        nameTextStyle: { fontSize: 10, color: themeColors.textMuted, padding: [0, 0, 0, -20] },
        axisLabel: { fontSize: 11, color: themeColors.textMuted, formatter: '{value}' },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: themeColors.gridLine, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: labels,
        axisLabel: { fontSize: 11, color: themeColors.text, width: 140, overflow: 'truncate' },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: colors[i],
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barWidth: '50%',
          label: {
            show: true,
            position: 'right',
            formatter: (p: any) => `${p.value.toFixed(1)}`,
            fontSize: 11,
            fontWeight: 600,
            color: themeColors.text,
          },
        },
        // System average marker line
        ...(systemLCOE ? [{
          type: 'line' as const,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              color: isDark ? '#94a3b8' : '#64748b',
              type: 'dashed' as const,
              width: 1.5,
            },
            label: {
              formatter: `Ø ${(systemLCOE * 100).toFixed(1)} ct/kWh`,
              fontSize: 10,
              color: themeColors.textMuted,
              position: 'end' as const,
            },
            data: [{ xAxis: systemLCOE * 100 }],
          },
          data: [],
        }] : []),
      ],
    };
  }, [data, systemLCOE, t, themeColors, isDark]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.chartLabels.noCostData')}
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
