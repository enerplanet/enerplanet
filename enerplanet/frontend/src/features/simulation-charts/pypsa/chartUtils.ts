import { useMemo, useSyncExternalStore } from 'react';
import type { GridComponentOption, XAXisComponentOption, DataZoomComponentOption, TooltipComponentOption } from 'echarts';

// Theme detection for ECharts (which uses canvas, not CSS)
function subscribeToTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot() {
  return document.documentElement.classList.contains('dark');
}

export function useIsDarkMode() {
  return useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => false);
}

interface ThemeColors {
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  background: string;
  tooltipBg: string;
  tooltipBorder: string;
  gridLine: string;
}

export function useThemeColors(): ThemeColors {
  const isDark = useIsDarkMode();

  return useMemo(() => ({
    text: isDark ? '#ffffff' : '#111827',           // white : gray-900 (100% vs 10% lightness)
    textMuted: isDark ? '#f3f4f6' : '#6b7280',      // gray-100 : gray-500 (96% vs 45% lightness)
    textSubtle: isDark ? '#e5e7eb' : '#9ca3af',     // gray-200 : gray-400 (91% vs 64% lightness)
    border: isDark ? '#4b5563' : '#e5e7eb',         // gray-600 : gray-200
    background: isDark ? '#1f2937' : '#ffffff',     // gray-800 : white
    tooltipBg: isDark ? 'rgba(17, 24, 39, 0.98)' : 'rgba(255, 255, 255, 0.98)', // gray-900 : white
    tooltipBorder: isDark ? '#4b5563' : '#e5e7eb',  // gray-600 : gray-200
    gridLine: isDark ? '#4b5563' : '#f3f4f6',       // gray-600 : gray-100
  }), [isDark]);
}

export function createChartGrid(topPercent: number = 20): GridComponentOption {
  return {
    left: '12%',
    right: '5%',
    bottom: '22%',
    top: `${topPercent}%`,
  };
}

export function createCompactGrid(): GridComponentOption {
  return { left: 50, right: 20, top: 20, bottom: 60 };
}

function formatTimestampForAxis(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function createTimeXAxis(timestamps: string[]): XAXisComponentOption {
  return {
    type: 'category',
    data: timestamps.map(formatTimestampForAxis),
    axisLabel: { 
      rotate: 0, 
      fontSize: 10,
      hideOverlap: true,
      interval: 'auto',
      formatter: (value: string) => value,
    },
    axisTick: { alignWithLabel: true },
  };
}

export function createDataZoom(): DataZoomComponentOption[] {
  return [
    { type: 'inside', start: 0, end: 100 },
    { type: 'slider', start: 0, end: 100, height: 20, bottom: 0 },
  ];
}

export function createDataZoomWithStyle(): DataZoomComponentOption[] {
  return [
    { type: 'inside', start: 0, end: 100 },
    {
      type: 'slider',
      start: 0,
      end: 100,
      height: 20,
      bottom: 8,
      borderColor: '#e5e7eb',
      fillerColor: 'rgba(59, 130, 246, 0.1)',
      handleStyle: { color: '#3b82f6', borderColor: '#3b82f6' },
      textStyle: { fontSize: 9, color: '#9ca3af' },
    },
  ];
}

export function createSplitLineStyle() {
  return { lineStyle: { type: 'dashed' as const } };
}

export function createBaseTooltip(): TooltipComponentOption {
  return {
    trigger: 'axis',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    padding: [12, 16],
    textStyle: { color: '#374151', fontSize: 12 },
  };
}

export const axisStyles = {
  line: { lineStyle: { color: '#e5e7eb' } },
  label: { fontSize: 10, color: '#9ca3af' },
  splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' as const } },
  hiddenLine: { show: false },
  hiddenTick: { show: false },
};

function createGradient(startColor: string, endColor: string) {
  return {
    type: 'linear',
    x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: startColor },
      { offset: 1, color: endColor },
    ],
  };
}

export const gradients = {
  blue: createGradient('#3b82f6', '#60a5fa'),
  red: createGradient('#f87171', '#ef4444'),
  amber: createGradient('#fbbf24', '#f59e0b'),
  green: createGradient('#34d399', '#10b981'),
  purple: createGradient('#a78bfa', '#8b5cf6'),
};
