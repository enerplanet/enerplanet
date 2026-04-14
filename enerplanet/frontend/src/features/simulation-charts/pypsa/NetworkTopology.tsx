import { useMemo, useRef, useEffect, useState, type FC } from 'react';
import ReactECharts from 'echarts-for-react';
import { Info } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { useThemeColors } from './chartUtils';

// Line connection from config.lines GeoJSON features
interface LineConnection {
  bus0: string; // Source location (usually transformer)
  bus1: string; // Target location (usually building)
}

interface NetworkTopologyProps {
  locations: string[];
  voltageData?: Record<string, number>; // location -> avg voltage
  powerData?: Record<string, number>; // location -> avg power
  lineConnections?: LineConnection[]; // Actual grid topology connections
  clusterColors?: Record<string, string>; // location -> cluster color hex (matches map colors)
  height?: number;
  onTransformerHover?: (connectedBuildings: string[] | null) => void; // Callback when hovering transformer
  highlightedBuildings?: string[] | null; // Buildings to highlight
}

// Helper to determine if a location is a transformer
const isTransformer = (loc: string) => {
  const lower = loc.toLowerCase();
  return lower.includes('trafo') || lower.includes('transformer') || lower.includes('grid');
};

// Helper to get voltage status
const getVoltageStatus = (voltage: number): { color: string; status: string; glow: string } => {
  if (voltage < 0.9 || voltage > 1.1) return {
    color: '#ef4444',
    status: 'critical',
    glow: 'rgba(239, 68, 68, 0.4)'
  };
  if (voltage < 0.95 || voltage > 1.05) return {
    color: '#f59e0b',
    status: 'warning',
    glow: 'rgba(245, 158, 11, 0.4)'
  };
  return {
    color: '#22c55e',
    status: 'normal',
    glow: 'rgba(34, 197, 94, 0.3)'
  };
};

// Layout strategy based on network size
type LayoutMode = 'simple' | 'clustered' | 'force';

const getLayoutMode = (transformerCount: number, buildingCount: number): LayoutMode => {
  const total = transformerCount + buildingCount;
  if (transformerCount <= 3 && total <= 30) return 'simple';
  if (transformerCount <= 10 && total <= 60) return 'clustered';
  return 'force';
};

// Helper to build transformer -> buildings mapping from line connections
const buildTrafoMapping = (
  lineConnections: LineConnection[],
  transformers: string[],
  buildings: string[]
): { buildingToTrafo: Record<string, string>; trafoToBuildingsMap: Record<string, string[]> } => {
  const buildingToTrafo: Record<string, string> = {};
  const trafoToBuildingsMap: Record<string, string[]> = {};

  lineConnections.forEach((conn: LineConnection) => {
    const bus0IsTrafo = isTransformer(conn.bus0);
    const bus1IsTrafo = isTransformer(conn.bus1);

    if (bus0IsTrafo && !bus1IsTrafo) {
      buildingToTrafo[conn.bus1] = conn.bus0;
    } else if (bus1IsTrafo && !bus0IsTrafo) {
      buildingToTrafo[conn.bus0] = conn.bus1;
    }
  });

  transformers.forEach(t => { trafoToBuildingsMap[t] = []; });
  buildings.forEach(b => {
    const trafo = buildingToTrafo[b];
    if (trafo && trafoToBuildingsMap[trafo]) {
      trafoToBuildingsMap[trafo].push(b);
    }
  });

  return { buildingToTrafo, trafoToBuildingsMap };
};

// Icons
const TRANSFORMER_ICON = 'image:///images/transformer-icon-black.svg';
const BUILDING_ICON = 'image:///images/tech-icons/building-2.svg';

// Helper to get short label from location name
const getShortLabel = (loc: string, maxLen = 8): string => {
  let label = loc;
  if (loc.includes('_')) {
    const parts = loc.split('_');
    label = parts.at(-1) ?? loc;
  }
  if (label.length > maxLen) {
    label = label.substring(0, maxLen - 2) + '..';
  }
  return label;
};

const formatPower = (valueKw: number): string => {
  if (!Number.isFinite(valueKw)) return '0';
  const abs = Math.abs(valueKw);
  if (abs >= 1000) return `${(valueKw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${valueKw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(valueKw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(valueKw * 1_000_000).toFixed(1)} mW`;
};

// Layout context interface
interface LayoutContext {
  transformers: string[];
  buildings: string[];
  voltageData: Record<string, number>;
  powerData: Record<string, number>;
  trafoToBuildingsMap: Record<string, string[]>;
  buildingToTrafo: Record<string, string>;
  clusterColors: Record<string, string>;
  chartWidth: number;
  chartHeight: number;
}

// Create nodes and links for clustered layout
function createClusteredLayout(ctx: LayoutContext): { nodes: any[]; links: any[] } {
  const { transformers, voltageData, powerData, trafoToBuildingsMap, clusterColors, chartWidth, chartHeight } = ctx;
  const nodes: any[] = [];
  const links: any[] = [];

  const trafoCount = transformers.length;
  const trafoCols = Math.ceil(Math.sqrt(trafoCount));
  const trafoRows = Math.ceil(trafoCount / trafoCols);
  const cellWidth = chartWidth / trafoCols;
  const cellHeight = chartHeight / trafoRows;

  transformers.forEach((trafo, idx) => {
    const voltage = voltageData[trafo] ?? 1;
    const power = powerData[trafo] ?? 0;
    const { color: voltageColor, glow } = getVoltageStatus(voltage);
    const nodeColor = clusterColors[trafo] || voltageColor;

    const col = idx % trafoCols;
    const row = Math.floor(idx / trafoCols);
    const centerX = cellWidth / 2 + col * cellWidth;
    const centerY = cellHeight / 2 + row * cellHeight;
    const connectedCount = trafoToBuildingsMap[trafo]?.length || 0;
    const trafoSize = Math.min(48, 32 + connectedCount * 0.5);

    nodes.push({
      name: trafo,
      x: centerX,
      y: centerY,
      symbolSize: trafoSize,
      symbol: TRANSFORMER_ICON,
      itemStyle: { color: nodeColor, borderColor: voltageColor, borderWidth: 3, shadowColor: glow, shadowBlur: 12 },
      value: [voltage, power, 'transformer'],
      category: 0,
      label: {
        show: trafoCount <= 12,
        position: 'bottom',
        distance: 8,
        fontSize: 9,
        fontWeight: 500,
        color: '#374151',
        backgroundColor: 'rgba(255,255,255,0.9)',
        padding: [2, 4],
        borderRadius: 3,
        formatter: getShortLabel(trafo),
      },
    });

    // Position connected buildings around transformer
    const connectedBuildings = trafoToBuildingsMap[trafo] || [];
    const buildingCount = connectedBuildings.length;
    const radius = Math.min(cellWidth, cellHeight) * 0.35;
    const trafoClusterColor = clusterColors[trafo];

    connectedBuildings.forEach((building, bIdx) => {
      const bVoltage = voltageData[building] ?? 1;
      const bPower = powerData[building] ?? 0;
      const { color: bVoltageColor, glow: bGlow } = getVoltageStatus(bVoltage);
      const bNodeColor = clusterColors[building] || bVoltageColor;

      const angle = (2 * Math.PI * bIdx) / buildingCount - Math.PI / 2;
      const bx = centerX + radius * Math.cos(angle);
      const by = centerY + radius * Math.sin(angle);

      nodes.push({
        name: building,
        x: bx,
        y: by,
        symbolSize: 20,
        symbol: BUILDING_ICON,
        itemStyle: { color: bNodeColor, borderColor: bVoltageColor, borderWidth: 1.5, shadowColor: bGlow, shadowBlur: 6 },
        value: [bVoltage, bPower, 'building'],
        category: 1,
        label: {
          show: buildingCount <= 8 && trafoCount <= 6,
          position: 'right',
          distance: 4,
          fontSize: 7,
          color: '#6b7280',
          formatter: getShortLabel(building, 6),
        },
      });

      links.push({
        source: trafo,
        target: building,
        lineStyle: { color: trafoClusterColor || bVoltageColor, width: 1, opacity: 0.5 },
      });
    });
  });

  // Connect adjacent transformers
  for (let i = 0; i < transformers.length - 1; i++) {
    const row1 = Math.floor(i / trafoCols);
    const col2 = (i + 1) % trafoCols;
    const row2 = Math.floor((i + 1) / trafoCols);

    if (row1 === row2 || (row2 === row1 + 1 && col2 === 0)) {
      links.push({
        source: transformers[i],
        target: transformers[i + 1],
        lineStyle: { color: '#6366f1', width: 2.5, type: 'solid', opacity: 0.7 },
      });
    }
  }

  return { nodes, links };
}

// Create nodes and links for force layout
function createForceLayout(ctx: LayoutContext): { nodes: any[]; links: any[] } {
  const { transformers, buildings, voltageData, powerData, trafoToBuildingsMap, buildingToTrafo, clusterColors } = ctx;
  const nodes: any[] = [];
  const links: any[] = [];

  transformers.forEach((trafo) => {
    const voltage = voltageData[trafo] ?? 1;
    const power = powerData[trafo] ?? 0;
    const { color: voltageColor, glow } = getVoltageStatus(voltage);
    const nodeColor = clusterColors[trafo] || voltageColor;
    const connectedCount = trafoToBuildingsMap[trafo]?.length || 0;
    const trafoSize = Math.min(40, 28 + connectedCount * 0.3);

    nodes.push({
      name: trafo,
      symbolSize: trafoSize,
      symbol: TRANSFORMER_ICON,
      itemStyle: { color: nodeColor, borderColor: voltageColor, borderWidth: 2, shadowColor: glow, shadowBlur: 8 },
      value: [voltage, power, 'transformer'],
      category: 0,
      label: { show: false },
    });
  });

  buildings.forEach((building) => {
    const voltage = voltageData[building] ?? 1;
    const power = powerData[building] ?? 0;
    const { color: voltageColor, glow } = getVoltageStatus(voltage);
    const nodeColor = clusterColors[building] || voltageColor;

    nodes.push({
      name: building,
      symbolSize: 14,
      symbol: BUILDING_ICON,
      itemStyle: { color: nodeColor, borderColor: voltageColor, borderWidth: 1, shadowColor: glow, shadowBlur: 4 },
      value: [voltage, power, 'building'],
      category: 1,
      label: { show: false },
    });

    const trafo = buildingToTrafo[building];
    if (trafo && transformers.includes(trafo)) {
      links.push({
        source: trafo,
        target: building,
        lineStyle: { color: clusterColors[trafo] || voltageColor, width: 0.8, opacity: 0.4 },
      });
    }
  });

  // Connect transformers
  for (let i = 0; i < transformers.length - 1; i++) {
    links.push({
      source: transformers[i],
      target: transformers[i + 1],
      lineStyle: { color: '#6366f1', width: 2, opacity: 0.6 },
    });
  }

  return { nodes, links };
}

// Create nodes and links for simple layout
function createSimpleLayout(ctx: LayoutContext): { nodes: any[]; links: any[] } {
  const { transformers, buildings, voltageData, powerData, buildingToTrafo, clusterColors, chartWidth, chartHeight } = ctx;
  const nodes: any[] = [];
  const links: any[] = [];

  const trafoAreaWidth = 80;
  const buildingAreaStart = 120;
  const buildingAreaWidth = chartWidth - buildingAreaStart - 20;

  transformers.forEach((loc, idx) => {
    const voltage = voltageData[loc] ?? 1;
    const power = powerData[loc] ?? 0;
    const { color: voltageColor, glow } = getVoltageStatus(voltage);
    const nodeColor = clusterColors[loc] || voltageColor;

    const ySpacing = transformers.length > 1 ? (chartHeight - 60) / (transformers.length - 1) : 0;
    const y = transformers.length > 1 ? 30 + idx * ySpacing : chartHeight / 2;

    nodes.push({
      name: loc,
      x: trafoAreaWidth / 2,
      y,
      symbolSize: 44,
      symbol: TRANSFORMER_ICON,
      itemStyle: { color: nodeColor, borderColor: voltageColor, borderWidth: 3, shadowColor: glow, shadowBlur: 12 },
      value: [voltage, power, 'transformer'],
      category: 0,
      label: {
        show: true,
        position: 'left',
        distance: 8,
        fontSize: 10,
        fontWeight: 500,
        color: '#374151',
        backgroundColor: 'rgba(255,255,255,0.9)',
        padding: [2, 6],
        borderRadius: 4,
        formatter: getShortLabel(loc),
      },
    });
  });

  const buildingCount = buildings.length;
  const cols = Math.min(6, Math.ceil(Math.sqrt(buildingCount * 1.5)));
  const rows = Math.ceil(buildingCount / cols);
  const cellWidth = buildingAreaWidth / cols;
  const cellHeight = (chartHeight - 40) / Math.max(rows, 1);

  buildings.forEach((loc, idx) => {
    const voltage = voltageData[loc] ?? 1;
    const power = powerData[loc] ?? 0;
    const { color: voltageColor, glow } = getVoltageStatus(voltage);
    const nodeColor = clusterColors[loc] || voltageColor;

    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = buildingAreaStart + cellWidth / 2 + col * cellWidth;
    const y = 20 + cellHeight / 2 + row * cellHeight;

    nodes.push({
      name: loc,
      x,
      y,
      symbolSize: 28,
      symbol: BUILDING_ICON,
      itemStyle: { color: nodeColor, borderColor: voltageColor, borderWidth: 2, shadowColor: glow, shadowBlur: 8 },
      value: [voltage, power, 'building'],
      category: 1,
      label: {
        show: buildingCount <= 20,
        position: 'bottom',
        distance: 4,
        fontSize: 8,
        color: '#6b7280',
        formatter: getShortLabel(loc),
      },
    });
  });

  // Build connections
  if (transformers.length > 0) {
    buildings.forEach((building) => {
      const connectedTrafo = buildingToTrafo[building];
      if (!connectedTrafo || !transformers.includes(connectedTrafo)) return;

      const buildingVoltage = voltageData[building] ?? 1;
      const { color: voltageColor } = getVoltageStatus(buildingVoltage);

      links.push({
        source: connectedTrafo,
        target: building,
        lineStyle: { color: clusterColors[connectedTrafo] || voltageColor, width: 1.5, curveness: 0.15, opacity: 0.6 },
      });
    });

    for (let i = 0; i < transformers.length - 1; i++) {
      links.push({
        source: transformers[i],
        target: transformers[i + 1],
        lineStyle: { color: '#6366f1', width: 4, type: 'solid', shadowColor: 'rgba(99, 102, 241, 0.3)', shadowBlur: 6 },
      });
    }
  }

  return { nodes, links };
}

// Custom tooltip component for voltage status with colored indicators
const VoltageStatusTooltip: FC = () => {
  const [show, setShow] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
        aria-label={t('results.grid.voltageStatusInfo')}
      >
        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
      </button>

      {show && (
        <div className="absolute z-[100] bottom-full left-1/2 -translate-x-1/2 -translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.grid.voltageStatusIndicators')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.grid.voltageStatusDesc')}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm shadow-green-500/50 flex-shrink-0 mt-1"></span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-green-700 dark:text-green-400">{t('results.grid.normal')}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">0.95 - 1.05 p.u.</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.normalVoltageDesc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50 flex-shrink-0 mt-1"></span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('results.grid.warning')}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">0.90-0.95 or 1.05-1.10 p.u.</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.warningVoltageDesc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50 flex-shrink-0 mt-1"></span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-red-700 dark:text-red-400">{t('results.grid.critical')}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">&lt;0.90 or &gt;1.10 p.u.</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.criticalVoltageDesc')}</p>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
              <strong>{t('results.grid.example')}:</strong> 0.92 p.u. = {t('results.grid.warning')} ({t('results.grid.belowThreshold')})
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const NetworkTopology: FC<NetworkTopologyProps> = ({
  locations,
  voltageData = {},
  powerData = {},
  lineConnections = [],
  clusterColors = {},
  height = 320,
  onTransformerHover,
  highlightedBuildings,
}) => {
  const chartRef = useRef<ReactECharts>(null);
  const { t } = useTranslation();
  const themeColors = useThemeColors();

  // Build transformer -> buildings mapping
  // Separate structure from data to avoid full layout resets on every voltage/power update
  const networkStructure = useMemo(() => {
    if (!locations || locations.length === 0) return { transformers: [], buildings: [], trafoToBuildingsMap: {}, buildingToTrafo: {}, layoutMode: 'simple' as LayoutMode };
    const transformers = locations.filter(isTransformer);
    const buildings = locations.filter(loc => !isTransformer(loc));
    const layoutMode = getLayoutMode(transformers.length, buildings.length);
    const { buildingToTrafo, trafoToBuildingsMap } = buildTrafoMapping(lineConnections, transformers, buildings);
    return { transformers, buildings, trafoToBuildingsMap, buildingToTrafo, layoutMode };
  }, [locations, lineConnections]);

  const { option, trafoToBuildingsMap } = useMemo(() => {
    const { transformers, buildings, trafoToBuildingsMap, buildingToTrafo, layoutMode } = networkStructure;
    if (transformers.length === 0 && buildings.length === 0) return { option: {}, trafoToBuildingsMap: {} };

    const chartWidth = 600;
    const chartHeight = height - 60;

    const ctx: LayoutContext = {
      transformers,
      buildings,
      voltageData,
      powerData,
      trafoToBuildingsMap,
      buildingToTrafo,
      clusterColors,
      chartWidth,
      chartHeight,
    };

    let nodes: any[] = [];
    let links: any[] = [];

    if (layoutMode === 'clustered') {
      ({ nodes, links } = createClusteredLayout(ctx));
    } else if (layoutMode === 'force') {
      ({ nodes, links } = createForceLayout(ctx));
    } else {
      ({ nodes, links } = createSimpleLayout(ctx));
    }

    const useForceLayout = layoutMode === 'force';

    return {
      option: {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          confine: true,
          position: 'left',
          backgroundColor: themeColors.tooltipBg,
          borderColor: themeColors.tooltipBorder,
          borderWidth: 1,
          padding: [12, 16],
          textStyle: { color: themeColors.text, fontSize: 12 },
          formatter: (params: any) => {
            if (params.dataType !== 'node') return '';
            const [voltage, power, type] = params.data.value || [1, 0, 'unknown'];
            const { status } = getVoltageStatus(voltage);
            const statusColors: Record<string, string> = {
              normal: '#22c55e',
              warning: '#f59e0b',
              critical: '#ef4444'
            };
            const statusTranslations: Record<string, string> = {
              normal: t('results.grid.normal'),
              warning: t('results.grid.warning'),
              critical: t('results.grid.critical')
            };
            const connectedCount = type === 'transformer' ? trafoToBuildingsMap[params.name]?.length || 0 : 0;

            return `
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: ${themeColors.text};">${params.name}</div>
              <div style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; margin-bottom: 8px; background: ${type === 'transformer' ? '#dbeafe' : themeColors.gridLine}; color: ${type === 'transformer' ? '#1d4ed8' : themeColors.text};">
                ${type === 'transformer' ? `⚡ ${t('results.grid.transformer')}` : `🏠 ${t('results.grid.building')}`}
              </div>
              <div style="display: grid; grid-template-columns: auto auto; gap: 4px 16px; font-size: 12px; color: ${themeColors.text};">
                <span style="color: ${themeColors.textMuted};">${t('results.grid.voltage')}:</span>
                <span style="font-weight: 600;">${voltage.toFixed(4)} pu</span>
                <span style="color: ${themeColors.textMuted};">${t('results.grid.power')}:</span>
                <span style="font-weight: 600;">${formatPower(power)}</span>
                <span style="color: ${themeColors.textMuted};">${t('results.grid.status')}:</span>
                <span style="font-weight: 600; color: ${statusColors[status]};">${statusTranslations[status]}</span>
                ${type === 'transformer' ? `
                  <span style="color: ${themeColors.textMuted};">${t('results.grid.connected')}:</span>
                  <span style="font-weight: 600; color: #3b82f6;">${connectedCount} ${t('results.grid.buildings')}</span>
                ` : ''}
              </div>
            `;
          },
        },
        series: [
          {
            type: 'graph',
            layout: useForceLayout ? 'force' : 'none',
            roam: true,
            zoom: layoutMode === 'force' ? 0.8 : 0.9,
            center: useForceLayout ? undefined : [chartWidth / 2, chartHeight / 2],
            edgeSymbol: ['none', 'none'],
            data: nodes,
            links,
            force: useForceLayout ? {
              repulsion: 120,
              gravity: 0.1,
              edgeLength: [40, 100],
              layoutAnimation: true,
            } : undefined,
            emphasis: {
              focus: 'adjacency',
              lineStyle: { width: 3, opacity: 1 },
              itemStyle: { shadowBlur: 20 },
            },
            blur: {
              itemStyle: { opacity: 0.3 },
              lineStyle: { opacity: 0.1 },
            },
          },
        ],
      },
      trafoToBuildingsMap,
    };
  }, [networkStructure, voltageData, powerData, clusterColors, height, themeColors, t]);

  // Handle chart events - highlight connected buildings when hovering transformer
  const onEvents = useMemo(() => {
    let lastHoverTime = 0;

    return {
      mouseover: (params: any) => {
        const now = Date.now();
        if (now - lastHoverTime < 50) return;
        lastHoverTime = now;

        if (params.dataType === 'node' && params.data?.value?.[2] === 'transformer') {
          const connectedBuildings = (trafoToBuildingsMap as Record<string, string[]>)[params.name] || [];
          onTransformerHover?.([...connectedBuildings, params.name]);

          // Highlight connected buildings in the chart
          const chart = chartRef.current?.getEchartsInstance();
          if (chart) {
            // Highlight the transformer and all connected buildings
            const nodesToHighlight = [params.name, ...connectedBuildings];
            chart.dispatchAction({
              type: 'highlight',
              seriesIndex: 0,
              name: nodesToHighlight,
            });
          }
        }
      },
      mouseout: (params: any) => {
        if (params.dataType === 'node' && params.data?.value?.[2] === 'transformer') {
          onTransformerHover?.(null);

          // Remove highlight
          const chart = chartRef.current?.getEchartsInstance();
          if (chart) {
            chart.dispatchAction({
              type: 'downplay',
              seriesIndex: 0,
            });
          }
        }
      },
    };
  }, [trafoToBuildingsMap, onTransformerHover]);

  // Handle external highlighting (e.g., from map transformer hover)
  useEffect(() => {
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return;

    if (highlightedBuildings && highlightedBuildings.length > 0) {
      chart.dispatchAction({
        type: 'highlight',
        seriesIndex: 0,
        name: highlightedBuildings,
      });
    } else {
      chart.dispatchAction({
        type: 'downplay',
        seriesIndex: 0,
      });
    }
  }, [highlightedBuildings]);

  if (!locations || locations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('results.grid.noNetworkData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Chart */}
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: height - 40, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={onEvents}
      />

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-2 px-4 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <img src="/images/transformer-icon-black.svg" alt={t('results.grid.transformer')} className="w-4 h-4" />
            <span>{t('results.grid.transformer')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <img src="/images/tech-icons/building-2.svg" alt={t('results.grid.building')} className="w-4 h-4" />
            <span>{t('results.grid.building')}</span>
          </span>
        </div>
        <div className="w-px h-4 bg-border" />
        {Object.keys(clusterColors).length > 0 && (
          <>
            <span className="text-[10px] text-muted-foreground italic">Fill = map cluster</span>
            <div className="w-px h-4 bg-border" />
          </>
        )}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-green-500 bg-transparent shadow-sm shadow-green-500/50"></span>
            <span className="text-muted-foreground">{t('results.grid.normal')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-amber-500 bg-transparent shadow-sm shadow-amber-500/50"></span>
            <span className="text-muted-foreground">{t('results.grid.warning')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-red-500 bg-transparent shadow-sm shadow-red-500/50"></span>
            <span className="text-muted-foreground">{t('results.grid.critical')}</span>
          </span>
          <VoltageStatusTooltip />
        </div>
      </div>
    </div>
  );
};
