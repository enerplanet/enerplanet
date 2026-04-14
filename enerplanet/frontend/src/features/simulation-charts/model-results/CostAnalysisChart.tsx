import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors, useIsDarkMode } from '../pypsa/chartUtils';
import { getTechColor } from '@/constants/tech-colors';

interface CostItem {
  category: string;
  value: number;
  color?: string;
  locationCount?: number;
  investmentCost?: number;
  variableCost?: number;
}

interface CostAnalysisChartProps {
  data: CostItem[];
  totalCost?: number;
  lcoe?: number;
  height?: number;
  isPartialYear?: boolean;
  simulationDays?: number;
}

const formatShare = (value: number, total: number, decimals = 1): string => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0%';
  const pct = (Math.abs(value) / total) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(decimals)}%`;
};

export const CostAnalysisChart: FC<CostAnalysisChartProps> = ({
  data,
  totalCost,
  lcoe,
  height = 280,
  isPartialYear,
  simulationDays,
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const isDark = useIsDarkMode();

  const option: EChartsOption = useMemo(() => {
    const total = totalCost || data.reduce((sum, d) => sum + Math.abs(d.value), 0);
    const pieData = data.map((d, idx) => ({
      name: d.category,
      value: Math.abs(d.value),
      itemStyle: { color: d.color || getTechColor(d.category, idx) },
      locationCount: d.locationCount,
      investmentCost: d.investmentCost,
      variableCost: d.variableCost,
    }));

    const fmtEur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

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
          const pct = formatShare(params.value, total, 1);
          const rowStyle = `display: flex; justify-content: space-between; gap: 24px; line-height: 1.8;`;
          const labelStyle = `color: ${themeColors.textMuted}; font-size: 11px;`;
          const valueStyle = `font-weight: 600; color: ${themeColors.text}; font-size: 11px;`;
          const dividerStyle = `border-top: 1px solid ${themeColors.tooltipBorder}; margin: 6px 0;`;

          let html = `<div style="font-weight: 600; margin-bottom: 6px; color: ${themeColors.text}; font-size: 13px;">${params.name}</div>`;

          // Simulation period cost
          if (isPartialYear && simulationDays) {
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.simulationPeriodCost')} (${simulationDays}d):</span>
              <span style="${valueStyle}">${fmtEur(params.value)}</span>
            </div>`;
          } else {
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.totalCost')}:</span>
              <span style="${valueStyle}">${fmtEur(params.value)}</span>
            </div>`;
          }

          // Share of total system cost
          html += `<div style="${rowStyle}">
            <span style="${labelStyle}">${t('results.chartLabels.share')}:</span>
            <span style="${valueStyle}">${pct}</span>
          </div>`;

          // Equipment vs Running cost breakdown
          const invest = params.data?.investmentCost;
          const variable = params.data?.variableCost;
          if (invest != null || variable != null) {
            html += `<div style="${dividerStyle}"></div>`;
            if (invest != null && invest > 0) {
              html += `<div style="${rowStyle}">
                <span style="${labelStyle}">${t('results.chartLabels.capex')}:</span>
                <span style="${valueStyle}">${fmtEur(invest)}</span>
              </div>`;
            }
            if (variable != null && variable > 0) {
              html += `<div style="${rowStyle}">
                <span style="${labelStyle}">${t('results.chartLabels.opex')}:</span>
                <span style="${valueStyle}">${fmtEur(variable)}</span>
              </div>`;
            }
            if (isPartialYear && simulationDays && invest != null && invest > 0) {
              const noteStyle = `color: ${themeColors.textMuted}; font-size: 10px; font-style: italic; margin-top: 4px;`;
              html += `<div style="${noteStyle}">${t('results.costInfo.equipmentCostNote')}</div>`;
            }
          }

          // Location count
          const locCount = params.data?.locationCount;
          if (locCount && locCount > 1) {
            html += `<div style="${dividerStyle}"></div>`;
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.locations')}:</span>
              <span style="${valueStyle}">${locCount}</span>
            </div>`;
            html += `<div style="${rowStyle}">
              <span style="${labelStyle}">${t('results.chartLabels.perLocation')}:</span>
              <span style="${valueStyle}">${fmtEur(params.value / locCount)}</span>
            </div>`;
          }

          return html;
        },
      },
      legend: {
        type: 'scroll',
        orient: 'horizontal',
        bottom: '0%',
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        icon: 'roundRect',
        textStyle: { fontSize: 11, color: themeColors.textMuted },
        formatter: (name: string) => {
          const item = data.find(d => d.category === name);
          if (item) {
            const pct = formatShare(item.value, total, 0);
            return `${name} (${pct})`;
          }
          return name;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['50%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: themeColors.background,
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 600,
              color: themeColors.text,
            },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.2)',
            },
          },
          labelLine: {
            show: false,
          },
          data: pieData,
        },
        // Center total display
        {
          type: 'pie',
          radius: ['0%', '0%'],
          center: ['50%', '45%'],
          label: {
            show: true,
            position: 'center',
            formatter: () => {
              const totalFmt = total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
              if (isPartialYear && simulationDays) {
                return `{total|${totalFmt}}\n{period|${simulationDays} ${t('results.chartLabels.days')}}`;
              }
              if (lcoe) {
                return `{total|${totalFmt}}\n{lcoe|LCOE: ${lcoe.toFixed(3)} €/kWh}`;
              }
              return `{total|${totalFmt}}\n{label|${t('results.chartLabels.totalCost')}}`;
            },
            rich: {
              total: {
                fontSize: 18,
                fontWeight: 700,
                color: themeColors.text,
                lineHeight: 28,
              },
              period: {
                fontSize: 10,
                color: isDark ? '#fbbf24' : '#d97706',
                lineHeight: 16,
              },
              lcoe: {
                fontSize: 11,
                color: themeColors.textMuted,
                lineHeight: 18,
              },
              label: {
                fontSize: 11,
                color: themeColors.textMuted,
                lineHeight: 18,
              },
            },
          },
          data: [{ value: 0, name: '' }],
        },
      ],
    };
  }, [data, totalCost, lcoe, t, themeColors, isDark, isPartialYear, simulationDays]);

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
