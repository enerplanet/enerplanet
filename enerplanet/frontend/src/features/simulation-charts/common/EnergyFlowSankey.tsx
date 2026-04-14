import { FC, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { EnergyFlowData } from '../types';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from '../pypsa/chartUtils';

interface EnergyFlowSankeyProps {
  data: EnergyFlowData;
  height?: number;
  title?: string;
}

export const EnergyFlowSankey: FC<EnergyFlowSankeyProps> = ({
  data,
  height = 350,
  title
}) => {
  const { t } = useTranslation();
  const themeColors = useThemeColors();
  const displayTitle = title || t('results.charts.energyFlow');

  const option: EChartsOption = useMemo(() => ({
    title: {
      text: displayTitle,
      left: 'center',
      textStyle: {
        fontSize: 14,
        fontWeight: 500,
        color: themeColors.text,
      },
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      triggerOn: 'mousemove',
      backgroundColor: themeColors.tooltipBg,
      borderColor: themeColors.tooltipBorder,
      textStyle: { color: themeColors.text },
      formatter: (params: any) => {
        if (params.dataType === 'edge') {
          return `<span style="color: ${themeColors.text}">${params.data.source} → ${params.data.target}<br/>${t('results.chartLabels.value')}: ${formatEnergyFlowValue(params.data.value)}</span>`;
        }
        return `<span style="color: ${themeColors.text}">${params.name}</span>`;
      },
    },
    series: [
      {
        type: 'sankey',
        left: '5%',
        right: '15%',
        top: '10%',
        bottom: '10%',
        nodeWidth: 20,
        nodeGap: 12,
        emphasis: {
          focus: 'adjacency',
        },
        nodeAlign: 'justify',
        orient: 'horizontal',
        layoutIterations: 32,
        draggable: false,
        data: data.nodes.map(node => ({
          name: node.name,
          itemStyle: {
            color: getNodeColor(node.name),
            borderColor: getNodeColor(node.name),
          },
        })),
        links: data.links,
        lineStyle: {
          color: 'gradient',
          curveness: 0.5,
          opacity: 0.6,
        },
        label: {
          fontSize: 11,
          color: themeColors.text,
          position: 'right',
        },
      },
    ],
  }), [data, displayTitle, t, themeColors]);

  if (!data.nodes.length || !data.links.length) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.chartLabels.noEnergyFlowData')}
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

function getNodeColor(name: string): string {
  const lowerName = name.toLowerCase();

  // Source technologies
  if (lowerName.includes('solar') || lowerName.includes('pv')) return '#fbbf24';
  if (lowerName.includes('wind')) return '#22c55e';
  if (lowerName.includes('grid import') || lowerName.includes('transmission') || lowerName.includes('netzimport') || lowerName.includes('übertragung')) return '#64748b';
  if (lowerName.includes('battery') || lowerName.includes('batterie')) return '#8b5cf6';
  if (lowerName.includes('biomass') || lowerName.includes('biomasse')) return '#84cc16';
  if (lowerName.includes('hydro') || lowerName.includes('water') || lowerName.includes('wasser')) return '#06b6d4';
  if (lowerName.includes('geothermal') || lowerName.includes('geothermie')) return '#ef4444';

  // Central node
  if (lowerName.includes('energy system') || lowerName.includes('energiesystem')) return '#8b5cf6';

  // Demand nodes
  if (lowerName.includes('household') || lowerName.includes('haushalt')) return '#f97316';
  if (lowerName.includes('industry') || lowerName.includes('industrie')) return '#ec4899';
  if (lowerName.includes('demand') || lowerName.includes('bedarf')) return '#ef4444';

  // Exports/losses
  if (lowerName.includes('export')) return '#4ade80';
  if (lowerName.includes('loss') || lowerName.includes('verlust')) return '#94a3b8';

  return '#cbd5e1'; // Default fallback
}

function formatEnergyFlowValue(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return '0';
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} GWh`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)} MWh`;
  if (abs >= 1) return `${value.toFixed(1)} kWh`;
  return `${(value * 1000).toFixed(1)} Wh`;
}
