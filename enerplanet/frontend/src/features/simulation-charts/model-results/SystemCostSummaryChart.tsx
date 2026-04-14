import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors, useIsDarkMode } from '../pypsa/chartUtils';

interface SystemCostSummaryChartProps {
  systemLCOE?: number;
  totalCost: number;
  investmentCost: number;
  variableCost: number;
  annualizedProduction: number; // kWh
  height?: number;
  simulationDays?: number;
  isPartialYear?: boolean;
}

export const SystemCostSummaryChart: FC<SystemCostSummaryChartProps> = ({
  systemLCOE,
  totalCost,
  investmentCost,
  variableCost,
  annualizedProduction,
  height = 280,
  simulationDays,
  isPartialYear,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const isDark = useIsDarkMode();

  const option = useMemo<EChartsOption>(() => {

    const fmtEur = (v: number) =>
      v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: v >= 100 ? 0 : 2 });

    const formatCurrency = (v: number) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M€`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(1)} k€`;
      return `${v.toFixed(0)} €`;
    };

    const lcoeCtkwh = systemLCOE ? (systemLCOE * 100).toFixed(2) : '—';
    const periodLabel = isPartialYear && simulationDays
      ? ` (${simulationDays} ${t('results.chartLabels.days')})`
      : '';

    // Center display: total cost + LCOE
    const centerTotalFmt = formatCurrency(totalCost);

    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: themeColors.tooltipBg,
        borderColor: themeColors.tooltipBorder,
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: themeColors.text, fontSize: 12 },
        formatter: (params: any) => {
          if (!params.name || params.seriesIndex !== 0) return '';
          const val = params.value as number;
          const rowStyle = `display: flex; justify-content: space-between; gap: 24px; line-height: 1.8;`;
          const labelStyle = `color: ${themeColors.textMuted}; font-size: 11px;`;
          const valueStyle = `font-weight: 600; color: ${themeColors.text}; font-size: 11px;`;
          const dividerStyle = `border-top: 1px solid ${themeColors.tooltipBorder}; margin: 6px 0;`;

          let html = `<div style="font-weight: 600; margin-bottom: 6px; color: ${themeColors.text}; font-size: 13px;">${params.name}</div>`;

          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.amount')}:</span>
            <span style="${valueStyle}">${fmtEur(val)}</span>
          </div>`;

          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.share')}:</span>
            <span style="${valueStyle}">${params.percent?.toFixed(1)}%</span>
          </div>`;

          html += `<div style="${dividerStyle}"></div>`;

          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.totalCost')}${periodLabel}:</span>
            <span style="${valueStyle}">${fmtEur(totalCost)}</span>
          </div>`;

          if (systemLCOE) {
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.systemLCOE')}:</span>
              <span style="${valueStyle}">${lcoeCtkwh} ct/kWh</span>
            </div>`;
          }

          return html;
        },
      },
      series: [
        // Main interactive donut
        {
          type: 'pie',
          radius: ['52%', '72%'],
          center: ['50%', '46%'],
          startAngle: 180,
          z: 2,
          data: [
            {
              value: investmentCost,
              name: t('results.chartLabels.investmentCost'),
              itemStyle: { color: '#3b82f6' },
            },
            {
              value: variableCost,
              name: t('results.chartLabels.operatingCost'),
              itemStyle: { color: '#f59e0b' },
            },
          ],
          label: {
            show: true,
            position: 'outside',
            formatter: (p: any) => `{name|${p.name}}\n{pct|${p.percent?.toFixed(0)}%}`,
            rich: {
              name: {
                fontSize: 10,
                color: themeColors.textMuted,
                lineHeight: 14,
              },
              pct: {
                fontSize: 11,
                fontWeight: 600,
                color: themeColors.text,
                lineHeight: 16,
              },
            },
          },
          labelLine: {
            lineStyle: { color: themeColors.gridLine },
            length: 8,
            length2: 12,
          },
          itemStyle: {
            borderRadius: 4,
            borderColor: themeColors.background,
            borderWidth: 2,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.15)',
            },
            label: {
              show: true,
              fontSize: 11,
              fontWeight: 600,
            },
          },
          animation: true,
          animationDuration: 800,
        },
        // Center display (invisible pie for label only)
        {
          type: 'pie',
          radius: ['0%', '0%'],
          center: ['50%', '46%'],
          silent: true,
          z: 0,
          label: {
            show: true,
            position: 'center',
            formatter: () => {
              const lines = [
                `{total|${centerTotalFmt}}`,
                isPartialYear && simulationDays
                  ? `{period|${t('results.chartLabels.totalCost')} (${simulationDays} ${t('results.chartLabels.days')})}`
                  : `{sublabel|${t('results.chartLabels.totalCost')}}`,
              ];
              if (systemLCOE) {
                lines.push(`{lcoe|${lcoeCtkwh} ct/kWh}`);
                lines.push(`{lcoeLabel|${t('results.chartLabels.systemLCOE')}}`);
              }
              return lines.join('\n');
            },
            rich: {
              total: {
                fontSize: 22,
                fontWeight: 700,
                color: isDark ? '#f1f5f9' : '#0f172a',
                lineHeight: 30,
              },
              sublabel: {
                fontSize: 10,
                color: themeColors.textMuted,
                lineHeight: 16,
              },
              period: {
                fontSize: 10,
                color: isDark ? '#fbbf24' : '#d97706',
                lineHeight: 16,
              },
              lcoe: {
                fontSize: 14,
                fontWeight: 600,
                color: isDark ? '#f1f5f9' : '#0f172a',
                lineHeight: 24,
                padding: [6, 0, 0, 0],
              },
              lcoeLabel: {
                fontSize: 9,
                color: themeColors.textMuted,
                lineHeight: 14,
              },
            },
          },
          data: [{ value: 0, name: '' }],
        },
      ] as any,
    };
  }, [systemLCOE, totalCost, investmentCost, variableCost, annualizedProduction, t, themeColors, isDark, simulationDays, isPartialYear]);

  return (
    <ReactECharts
      option={option}
      notMerge={true}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};
