import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';

interface InvestmentItem {
  tech: string;
  label: string;
  investment: number;
  variable: number;
}

interface InvestmentBreakdownChartProps {
  data: InvestmentItem[];
  height?: number;
  simulationDays?: number;
  isPartialYear?: boolean;
  systemTotalCost?: number;
}

export const InvestmentBreakdownChart: FC<InvestmentBreakdownChartProps> = ({
  data,
  height = 280,
  simulationDays,
  isPartialYear,
  systemTotalCost,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();

  const option: EChartsOption = useMemo(() => {
    const sorted = [...data].sort((a, b) => (b.investment + b.variable) - (a.investment + a.variable));
    const labels = sorted.map(d => d.label);

    const formatCurrency = (v: number) =>
      v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: v >= 100 ? 0 : 2 });

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
          const items = Array.isArray(params) ? params : [params];
          const tech = items[0].name;
          const inv = items.find((p: any) => p.seriesIndex === 0)?.value || 0;
          const opex = items.find((p: any) => p.seriesIndex === 1)?.value || 0;
          const total = inv + opex;
          const periodLabel = isPartialYear && simulationDays ? ` (${simulationDays} ${t('results.chartLabels.days')})` : '';
          const rowStyle = `display:flex;justify-content:space-between;gap:20px;line-height:1.8;`;
          const labelStyle = `color:${themeColors.textMuted};font-size:11px;`;
          const valueStyle = `font-weight:600;color:${themeColors.text};font-size:11px;`;
          const dividerStyle = `border-top:1px solid ${themeColors.border};margin:6px 0;`;

          let html = `<div style="font-weight:600;margin-bottom:6px;color:${themeColors.text};font-size:13px;">${tech}</div>`;

          // Equipment cost
          html += `<div style="${rowStyle}">
            <span style="color:#3b82f6;font-size:11px;">■ ${t('results.chartLabels.investmentCost')}:</span>
            <span style="${valueStyle}">${formatCurrency(inv)}</span>
          </div>`;

          // Running cost
          html += `<div style="${rowStyle}">
            <span style="color:#f59e0b;font-size:11px;">■ ${t('results.chartLabels.operatingCost')}:</span>
            <span style="${valueStyle}">${formatCurrency(opex)}</span>
          </div>`;

          // Equipment/Running split percentage
          if (total > 0) {
            const invPct = ((inv / total) * 100).toFixed(0);
            const opexPct = ((opex / total) * 100).toFixed(0);
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.costSplit')}:</span>
              <span style="${valueStyle}">${invPct}% / ${opexPct}%</span>
            </div>`;
          }

          html += `<div style="${dividerStyle}"></div>`;

          // Total cost
          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.totalCost')}${periodLabel}:</span>
            <span style="font-weight:700;color:${themeColors.text};font-size:12px;">${formatCurrency(total)}</span>
          </div>`;

          // Share of system total
          if (systemTotalCost && systemTotalCost > 0) {
            const sharePct = ((total / systemTotalCost) * 100).toFixed(1);
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.share')}:</span>
              <span style="${valueStyle}">${sharePct}%</span>
            </div>`;
          }

          // Context note for equipment cost in partial year
          if (isPartialYear && simulationDays && inv > 0) {
            html += `<div style="color:${themeColors.textMuted};font-size:10px;font-style:italic;margin-top:4px;">${t('results.costInfo.equipmentCostNote')}</div>`;
          }

          return html;
        },
      },
      legend: {
        bottom: 0,
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        icon: 'roundRect',
        textStyle: { fontSize: 11, color: themeColors.textMuted },
        data: [t('results.chartLabels.investmentCost'), t('results.chartLabels.operatingCost')],
      },
      grid: { left: 10, right: 20, top: 20, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          fontSize: 10,
          color: themeColors.textMuted,
          rotate: labels.length > 4 ? 25 : 0,
          width: 80,
          overflow: 'truncate',
        },
        axisLine: { lineStyle: { color: themeColors.gridLine } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          fontSize: 10,
          color: themeColors.textMuted,
          formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k €` : `${v.toFixed(0)} €`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: themeColors.gridLine, type: 'dashed' } },
      },
      series: [
        {
          name: t('results.chartLabels.investmentCost'),
          type: 'bar',
          stack: 'cost',
          data: sorted.map((d, i) => ({
            value: d.investment,
            itemStyle: {
              color: getTechColor(d.tech, i),
              borderRadius: d.variable > 0 ? [0, 0, 0, 0] : [4, 4, 0, 0],
            },
          })),
          barWidth: '45%',
        },
        {
          name: t('results.chartLabels.operatingCost'),
          type: 'bar',
          stack: 'cost',
          data: sorted.map((d, i) => ({
            value: d.variable,
            itemStyle: {
              color: getTechColor(d.tech, i),
              opacity: 0.5,
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: '45%',
        },
      ],
    };
  }, [data, t, themeColors, simulationDays, isPartialYear]);

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
