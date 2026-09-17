import { useMemo, useRef, type ElementType } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useThemeColors } from '@/features/simulation-charts/pypsa/chartUtils';
import { Download, Upload, Zap, Flame, Snowflake, Layers3, Droplets, CookingPot } from 'lucide-react';
import { T, SegmentedControl } from '../shared/ui';
import {
  formatEnergyValue,
  type EnergyTotals,
  formatTickLabel,
  type EnergyType,
  type LoadDataPoint,
  type Resolution,
} from '@/features/configurator/building-config/panel/lib/loadProfile';
import { useLoadProfileState } from './useLoadProfileState';

interface LoadProfileViewerProps {
  buildingId?: string;
  onTotalsChange?: (totals: EnergyTotals) => void;
  /** Pre-seeds the hourly dataset from model output. Replaces any user-uploaded data. */
  initialTimeseries?: LoadDataPoint[];
  /** Controls UI complexity. Basic hides expert controls; defaults to basic. */
  mode?: 'basic' | 'expert';
  /** Fired when the user uploads a file — the uploaded rows become ground truth for the annual totals elsewhere in the app. */
  onGroundTruthChange?: (rows: LoadDataPoint[] | null, label: string | null) => void;
}

/** One plotted series: the LoadDataPoint key, its legend name and its colour. */
const SERIES: Record<Exclude<EnergyType, 'combined'>, { name: string; colour: string }> = {
  electricity: { name: 'Electricity', colour: '#f59e0b' },
  heating: { name: 'Heating', colour: '#ef4444' },
  hotwater: { name: 'Cooling', colour: '#3b82f6' },
  dhw: { name: 'Hot Water', colour: '#0ea5e9' },
  kitchen: { name: 'Kitchen (gas)', colour: '#e11d48' },
};

/** Kitchen is gas (kWh_gas), so it never joins the others on one axis. */
const COMBINED_KEYS = ['electricity', 'heating', 'hotwater', 'dhw'] as const;

export function LoadProfileViewer({ buildingId = 'Building 3', onTotalsChange, initialTimeseries, mode = 'basic', onGroundTruthChange }: LoadProfileViewerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeColours = useThemeColors();
  const {
    data,
    energyType,
    handleDownload,
    handleFileUpload,
    hasData,
    resolution,
    setEnergyType,
    setResolution,
    sourceCaption,
    unit,
    uploadError,
  } = useLoadProfileState({ buildingId, initialTimeseries, mode, onTotalsChange, onGroundTruthChange });

  // Mean of electricity + heating + cooling + hot water per visible point —
  // only meaningful once plotted together, so it's Combined-only. Kitchen is
  // excluded: it's a gas total (kWh_gas), not the same unit as the rest.
  const combinedAverage = energyType === 'combined' && data.length > 0
    ? data.reduce((sum, point) => sum + point.electricity + point.heating + point.hotwater + point.dhw, 0) / data.length
    : null;

  // Shorter labels that communicate "what time period each data point covers"
  const resolutionOptions = [
    { value: 'hourly',  label: 'Hour'  },
    { value: 'daily',   label: 'Day'   },
    { value: 'weekly',  label: 'Week'  },
    { value: 'monthly', label: 'Month' },
  ];
  // Colours and labels for the vertical energy type tab strip.
  const ENERGY_META: Record<EnergyType, { label: string; Icon: ElementType }> = {
    electricity: { label: 'Electricity', Icon: Zap },
    heating:     { label: 'Heating', Icon: Flame },
    hotwater:    { label: 'Cooling', Icon: Snowflake },
    dhw:         { label: 'Hot Water', Icon: Droplets },
    kitchen:     { label: 'Kitchen (gas)', Icon: CookingPot },
    combined:    { label: 'Combined', Icon: Layers3 },
  };

  const chartOption: EChartsOption = useMemo(() => {
    const keys = energyType === 'combined' ? [...COMBINED_KEYS] : [energyType];
    return {
      animation: false,
      grid: { left: 52, right: 12, top: 12, bottom: 44 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: themeColours.tooltipBg,
        borderColor: themeColours.tooltipBorder,
        textStyle: { color: themeColours.text, fontSize: 11 },
        valueFormatter: (value) => formatEnergyValue(Number(value), 6),
      },
      legend: {
        bottom: 0,
        itemWidth: 14,
        itemHeight: 2,
        textStyle: { color: themeColours.textMuted, fontSize: 9 },
      },
      xAxis: {
        type: 'category',
        data: data.map((point) => point.timestamp),
        axisLabel: {
          color: themeColours.textMuted,
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: string) => formatTickLabel(value, resolution),
        },
        axisLine: { lineStyle: { color: themeColours.border } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          color: themeColours.textMuted,
          fontSize: 10,
          formatter: (value: number) => formatEnergyValue(value, 4),
        },
        splitLine: { lineStyle: { color: themeColours.gridLine, type: 'dashed' } },
      },
      series: keys.map((key) => ({
        type: 'line',
        name: SERIES[key].name,
        data: data.map((point) => point[key]),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: SERIES[key].colour },
        itemStyle: { color: SERIES[key].colour },
        // The average is a property of the combined view, so it rides on the
        // first series rather than being a chart-level line.
        ...(combinedAverage !== null && key === COMBINED_KEYS[0]
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#64748b', type: 'dashed', width: 1.5 },
                label: {
                  formatter: `Avg ${formatEnergyValue(combinedAverage, 4)} ${unit}`,
                  position: 'insideEndTop',
                  fontSize: 10,
                  color: '#64748b',
                },
                data: [{ yAxis: combinedAverage }],
              },
            }
          : {}),
      })),
    };
  }, [data, energyType, resolution, combinedAverage, unit, themeColours]);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'white', borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgba(226,232,240,0.7)',
      boxShadow: '0 1px 3px rgba(15,23,42,0.07), 0 4px 16px rgba(15,23,42,0.08)',
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{
          width: 22, height: 22, background: '#10b981', borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Zap size={13} color="#ffffff" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: T.foreground, lineHeight: 1.2 }}>
            Energy Usage
          </span>
          <span style={{ display: 'block', fontSize: 10, color: T.mutedFg, lineHeight: 1.2 }}>
            {buildingId} · {sourceCaption}
          </span>
        </div>
        {/* Resolution — labelled as the time period each point covers */}
        <SegmentedControl options={resolutionOptions} value={resolution} onChange={(v) => setResolution(v as Resolution)} />
        {/* Graph-data import / export — plain CSV in a zip, safe for any user to open in Excel */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 26, padding: '0 9px', borderRadius: 5,
            border: `1px solid ${T.border}`, background: 'transparent',
            color: T.foreground, cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}
        >
          <Upload size={12} /> Upload load profile
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!hasData}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 26, padding: '0 9px', borderRadius: 5,
            border: `1px solid ${T.border}`, background: 'transparent',
            color: hasData ? T.foreground : T.mutedFg,
            cursor: hasData ? 'pointer' : 'not-allowed',
            fontSize: 11, fontWeight: 600, flexShrink: 0, opacity: hasData ? 1 : 0.5,
          }}
        >
          <Download size={12} /> Download profiles (.zip)
        </button>
        <input ref={fileInputRef} type="file" accept=".json,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
      </div>

      {uploadError && (
        <div style={{ margin: '6px 14px 0', border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 6, padding: '4px 8px', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: '#b91c1c' }}>{uploadError}</span>
        </div>
      )}

      {/* ── Chart ── */}
      <div style={{ flex: 1, minHeight: 0, padding: '8px 12px 4px' }}>
        {hasData ? (
          <ReactECharts
            option={chartOption}
            style={{ width: '100%', height: '100%' }}
            notMerge
            opts={{ renderer: 'svg' }}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${T.border}`, borderRadius: 6, background: T.inputBg, padding: '0 24px', textAlign: 'center' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: T.foreground, margin: '0 0 4px' }}>No usage data loaded</p>
              <p style={{ fontSize: 11, color: T.mutedFg, lineHeight: 1.6, margin: 0 }}>
                Use "Import Data" to load an energy profile, or generate demand profiles by clicking "Run Simulation" button at bottom.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Energy type selector — bottom pill strip ── */}
      <div style={{ padding: '6px 12px 10px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 4, flexShrink: 0 }}>
        {(Object.keys(ENERGY_META) as EnergyType[]).map((type) => {
          const { label, Icon } = ENERGY_META[type];
          const active = energyType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setEnergyType(type)}
              style={{
                flex: 1, padding: '5px 6px', borderRadius: 6,
                border: `1px solid ${active ? 'rgba(100,116,139,0.45)' : 'rgba(226,232,240,0.9)'}`,
                background: active ? 'rgba(241,245,249,0.95)' : 'rgba(248,250,252,0.7)',
                color: active ? T.foreground : T.mutedFg,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              aria-pressed={active}
            >
              <Icon size={13} strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}