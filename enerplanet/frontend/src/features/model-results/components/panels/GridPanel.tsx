import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Gauge, Network, Info, Zap } from 'lucide-react';
import { PyPSAModelResults } from '../../api';
import {
  PyPSAVoltageChart,
  PyPSAPowerChart,
  NetworkTopology,
  PyPSAVoltageViolationChart,
  PyPSALineLoadingChart,
  PyPSATransformerLoadingChart,
  PyPSALossesChart,
  PyPSACurtailmentChart,
} from '@/features/simulation-charts/pypsa';
import { useTranslation } from '@spatialhub/i18n';
import { CLUSTER_COLORS } from '@/components/map-controls/maplibre/maplibre-styles';
import { DARK_CLUSTER_COLORS } from '@/features/interactive-map/utils/mapStyleUtils';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { ErrorBoundary } from '@/components/ErrorBoundary';


const BusDetailsTooltip = () => {
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
        aria-label={t('results.grid.busDetails')}
      >
        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.grid.busDetails')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.grid.busDetailsDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t('results.grid.totalBuses')}</span>
                <span className="text-gray-700 dark:text-gray-300">{t('results.grid.totalBusesDesc')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t('results.grid.avgVoltage')}</span>
                <span className="text-gray-700 dark:text-gray-300">{t('results.grid.avgVoltageDesc')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t('results.grid.avgPower')}</span>
                <span className="text-gray-700 dark:text-gray-300">{t('results.grid.avgPowerDesc')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const VoltageProfileTooltip = () => {
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
        aria-label={t('results.grid.voltageProfile')}
      >
        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.grid.voltageProfile')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.grid.voltageProfileDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.grid.perUnit')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.perUnitDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.grid.normalRange')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.normalRangeDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const PowerFlowTooltip = () => {
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
        aria-label={t('results.grid.powerFlow')}
      >
        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.grid.powerFlow')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.grid.powerFlowDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.grid.activePower')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.activePowerDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.grid.reactivePower')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.grid.reactivePowerDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface LineConnection {
  bus0: string;
  bus1: string;
}

interface GridPanelProps {
  pypsaData: PyPSAModelResults | null;
  selectedBus: string | null;
  setSelectedBus: (bus: string) => void;
  selectedVoltage: { timestep: string; v_mag_pu: number }[];
  selectedPower: { timestep: string; p: number; q?: number }[];
  onTransformerHover?: (connectedBuildings: string[] | null) => void;
  lineConnections?: LineConnection[];
  highlightedBuildings?: string[] | null;
}

const formatPowerValue = (valueKw: number): string => {
  if (!Number.isFinite(valueKw)) return '-';
  const abs = Math.abs(valueKw);
  if (abs >= 1000) return `${(valueKw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${valueKw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(valueKw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(valueKw * 1_000_000).toFixed(1)} mW`;
};

const formatApparentPowerValue = (valueKva: number): string => {
  if (!Number.isFinite(valueKva)) return '-';
  const abs = Math.abs(valueKva);
  if (abs >= 1000) return `${(valueKva / 1000).toFixed(2)} MVA`;
  if (abs >= 1) return `${valueKva.toFixed(1)} kVA`;
  if (abs >= 0.001) return `${(valueKva * 1000).toFixed(1)} VA`;
  if (abs === 0) return '0.0 kVA';
  return `${(valueKva * 1_000_000).toFixed(1)} mVA`;
};

const computeApparentPower = (pKw: number, qKvar = 0): number => {
  if (!Number.isFinite(pKw) || !Number.isFinite(qKvar)) return 0;
  return Math.sqrt((pKw ** 2) + (qKvar ** 2));
};

const computeLoss = (p0Kw: number, p1Kw?: number): number => {
  if (!Number.isFinite(p0Kw)) return 0;
  if (p1Kw === undefined || !Number.isFinite(p1Kw)) return 0;
  return Math.abs(Math.abs(p0Kw) - Math.abs(p1Kw));
};

const GridPanel = ({ pypsaData, selectedBus, setSelectedBus, selectedVoltage, selectedPower, onTransformerHover, lineConnections = [], highlightedBuildings }: GridPanelProps) => {
  const { t } = useTranslation();
  const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');
  const activeClusterPalette = isMapLibre3D ? CLUSTER_COLORS : DARK_CLUSTER_COLORS;
  const voltageArr = pypsaData?.voltage || pypsaData?.buses_t_v_mag_pu || [];
  const powerArr = pypsaData?.power || pypsaData?.buses_t_p || [];
  const lineLoadingArr = pypsaData?.line_loading || [];
  const lineRatings = pypsaData?.line_ratings || {};
  const transformerLoadingArr = pypsaData?.transformer_loading || [];
  const curtailmentArr = pypsaData?.curtailment || [];
  const convergence = pypsaData?.convergence;

  const { avgVoltageByBus, avgPowerByBus } = useMemo(() => {
    const voltageByLoc: Record<string, { sum: number; count: number }> = {};
    const powerByLoc: Record<string, { sum: number; count: number }> = {};

    voltageArr.forEach(v => {
      const loc = v.location;
      if (!voltageByLoc[loc]) {
        voltageByLoc[loc] = { sum: 0, count: 0 };
      }
      voltageByLoc[loc].sum += v.v_mag_pu;
      voltageByLoc[loc].count += 1;
    });

    powerArr.forEach(p => {
      if (!Number.isFinite(p.p) || Math.abs(p.p) > 1_000_000) return;
      const loc = p.location;
      if (!powerByLoc[loc]) {
        powerByLoc[loc] = { sum: 0, count: 0 };
      }
      powerByLoc[loc].sum += p.p;
      powerByLoc[loc].count += 1;
    });

    const voltageSummary: Record<string, number> = {};
    const powerSummary: Record<string, number> = {};

    Object.entries(voltageByLoc).forEach(([loc, data]) => {
      voltageSummary[loc] = data.count > 0 ? data.sum / data.count : 1;
    });

    Object.entries(powerByLoc).forEach(([loc, data]) => {
      powerSummary[loc] = data.count > 0 ? data.sum / data.count : 0;
    });

    return {
      avgVoltageByBus: voltageSummary,
      avgPowerByBus: powerSummary,
    };
  }, [powerArr, voltageArr]);

  const clusterColors = useMemo(() => {
    const colors: Record<string, string> = {};
    if (!pypsaData?.locations) return colors;

    const isTrafo = (loc: string) => {
      const lower = loc.toLowerCase();
      return lower.includes('trafo') || lower.includes('transformer') || lower.includes('grid');
    };

    const transformerLocs = pypsaData.locations.filter(isTrafo);

    // Assign cluster colors to transformers by index (palette matches active map layer)
    transformerLocs.forEach((trafo, idx) => {
      colors[trafo] = activeClusterPalette[idx % activeClusterPalette.length];
    });

    // Map buildings to their transformer's cluster color
    lineConnections.forEach(conn => {
      const bus0IsTrafo = isTrafo(conn.bus0);
      const bus1IsTrafo = isTrafo(conn.bus1);

      if (bus0IsTrafo && !bus1IsTrafo && colors[conn.bus0]) {
        colors[conn.bus1] = colors[conn.bus0];
      } else if (bus1IsTrafo && !bus0IsTrafo && colors[conn.bus1]) {
        colors[conn.bus0] = colors[conn.bus1];
      }
    });

    return colors;
  }, [pypsaData?.locations, lineConnections, activeClusterPalette]);

  const voltageViolationItems = useMemo(() => {
    const byLocation = new Map<string, { hoursOutside: number; maxDeviationPu: number }>();

    voltageArr.forEach(entry => {
      const current = byLocation.get(entry.location) || { hoursOutside: 0, maxDeviationPu: 0 };
      const deviation = entry.v_mag_pu < 0.95
        ? 0.95 - entry.v_mag_pu
        : entry.v_mag_pu > 1.05
          ? entry.v_mag_pu - 1.05
          : 0;

      if (deviation > 0) {
        current.hoursOutside += 1;
        current.maxDeviationPu = Math.max(current.maxDeviationPu, deviation);
      }

      byLocation.set(entry.location, current);
    });

    return Array.from(byLocation.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .filter(item => item.hoursOutside > 0 || item.maxDeviationPu > 0);
  }, [voltageArr]);

  const lineLoadingItems = useMemo(() => {
    const byLine = new Map<string, { peakApparentKva: number; peakLossKw: number; peakLoadingPercent?: number }>();

    lineLoadingArr.forEach(entry => {
      const current = byLine.get(entry.line) || { peakApparentKva: 0, peakLossKw: 0 };
      const apparent = computeApparentPower(entry.p0, entry.q0 || 0);
      current.peakApparentKva = Math.max(current.peakApparentKva, apparent);
      current.peakLossKw = Math.max(current.peakLossKw, computeLoss(entry.p0, entry.p1));
      if (entry.loading_percent !== undefined) {
        current.peakLoadingPercent = Math.max(current.peakLoadingPercent || 0, entry.loading_percent);
      }
      byLine.set(entry.line, current);
    });

    return Array.from(byLine.entries()).map(([name, stats]) => {
      const rating = lineRatings[name];
      if (rating && rating > 0 && stats.peakLoadingPercent === undefined) {
        stats.peakLoadingPercent = (stats.peakApparentKva / rating) * 100;
      }
      return { name, ...stats };
    });
  }, [lineLoadingArr, lineRatings]);

  const transformerLoadingItems = useMemo(() => {
    const byTransformer = new Map<string, { peakApparentKva: number; peakLoadingPercent?: number; ratingKva?: number }>();

    transformerLoadingArr.forEach(entry => {
      const apparent0 = computeApparentPower(entry.p0, entry.q0);
      const apparent1 = computeApparentPower(entry.p1, entry.q1);
      const peak = Math.max(apparent0, apparent1);
      const current = byTransformer.get(entry.transformer) || { peakApparentKva: 0, ratingKva: entry.s_nom_kva };
      current.peakApparentKva = Math.max(current.peakApparentKva, peak);
      current.ratingKva = entry.s_nom_kva || current.ratingKva;
      if (current.ratingKva && current.ratingKva > 0) {
        current.peakLoadingPercent = Math.max(current.peakLoadingPercent || 0, (peak / current.ratingKva) * 100);
      }
      byTransformer.set(entry.transformer, current);
    });

    return Array.from(byTransformer.entries()).map(([name, stats]) => ({ name, ...stats }));
  }, [transformerLoadingArr]);

  const lossesTimeline = useMemo(() => {
    const byTimestamp = new Map<string, { lineLossesKw: number; transformerLossesKw: number }>();

    lineLoadingArr.forEach(entry => {
      const current = byTimestamp.get(entry.timestep) || { lineLossesKw: 0, transformerLossesKw: 0 };
      current.lineLossesKw += computeLoss(entry.p0, entry.p1);
      byTimestamp.set(entry.timestep, current);
    });

    transformerLoadingArr.forEach(entry => {
      const current = byTimestamp.get(entry.timestep) || { lineLossesKw: 0, transformerLossesKw: 0 };
      current.transformerLossesKw += computeLoss(entry.p0, entry.p1);
      byTimestamp.set(entry.timestep, current);
    });

    return Array.from(byTimestamp.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([timestamp, values]) => ({
        timestamp,
        lineLossesKw: values.lineLossesKw,
        transformerLossesKw: values.transformerLossesKw,
      }));
  }, [lineLoadingArr, transformerLoadingArr]);

  const curtailmentTimeline = useMemo(() => (
    [...curtailmentArr]
      .sort((a, b) => new Date(a.timestep).getTime() - new Date(b.timestep).getTime())
  ), [curtailmentArr]);

  const worstBuses = useMemo(() => (
    [...voltageViolationItems]
      .sort((a, b) => b.hoursOutside - a.hoursOutside || b.maxDeviationPu - a.maxDeviationPu)
      .slice(0, 5)
  ), [voltageViolationItems]);

  const worstLines = useMemo(() => (
    [...lineLoadingItems]
      .sort((a, b) => b.peakApparentKva - a.peakApparentKva || b.peakLossKw - a.peakLossKw)
      .slice(0, 5)
  ), [lineLoadingItems]);

  const busiestLine = useMemo(() =>
    lineLoadingItems
      .slice()
      .sort((a, b) => {
        if (a.peakLoadingPercent !== undefined && b.peakLoadingPercent !== undefined) {
          return b.peakLoadingPercent - a.peakLoadingPercent;
        }
        return b.peakApparentKva - a.peakApparentKva;
      })[0],
    [lineLoadingItems]
  );

  const busiestTransformer = useMemo(() =>
    transformerLoadingItems
      .slice()
      .sort((a, b) => (b.peakLoadingPercent || 0) - (a.peakLoadingPercent || 0))[0],
    [transformerLoadingItems]
  );

  const selectedVoltageAvg = selectedBus && avgVoltageByBus[selectedBus] !== undefined
    ? avgVoltageByBus[selectedBus]
    : null;
  const selectedPowerAvg = selectedBus && avgPowerByBus[selectedBus] !== undefined
    ? avgPowerByBus[selectedBus]
    : null;

  const sanitizedSelectedPower = useMemo(() =>
    selectedPower.filter(p =>
      Number.isFinite(p.p) &&
      Math.abs(p.p) < 1_000_000 &&
      (p.q === undefined || (Number.isFinite(p.q) && Math.abs(p.q) < 1_000_000))
    ),
    [selectedPower]
  );

  const { selectedVoltageMin, selectedVoltageMax } = useMemo(() => {
    if (selectedVoltage.length === 0) return { selectedVoltageMin: null, selectedVoltageMax: null };
    let min = Infinity;
    let max = -Infinity;
    for (const item of selectedVoltage) {
      if (item.v_mag_pu < min) min = item.v_mag_pu;
      if (item.v_mag_pu > max) max = item.v_mag_pu;
    }
    return { selectedVoltageMin: min, selectedVoltageMax: max };
  }, [selectedVoltage]);

  const validationIssues = convergence?.validation_issues || [];
  const isFullyConverged = convergence
    ? convergence.converged_snapshots === convergence.total_snapshots
    : pypsaData?.settings?.converged;

  if (!pypsaData?.locations?.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Network className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t('results.grid.noData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            {t('results.grid.networkTopology')}
          </h3>
          <ErrorBoundary label="Network Topology">
            <NetworkTopology
              locations={pypsaData.locations}
              voltageData={avgVoltageByBus}
              powerData={avgPowerByBus}
              lineConnections={lineConnections}
              clusterColors={clusterColors}
              height={420}
              onTransformerHover={onTransformerHover}
              highlightedBuildings={highlightedBuildings}
            />
          </ErrorBoundary>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-primary" />
                PyPSA Run Status
              </h3>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                  isFullyConverged
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-amber-500/10 text-amber-600'
                }`}
              >
                {isFullyConverged ? 'Converged' : 'Needs Review'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Snapshots</p>
                <p className="text-lg font-bold text-foreground">
                  {convergence ? `${convergence.converged_snapshots}/${convergence.total_snapshots}` : '-'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">PF mode</p>
                <p className="text-sm font-semibold text-foreground break-words">
                  {convergence?.pf_attempt || 'n/a'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Worst bus</p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {worstBuses[0]?.name || 'None'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">LPF mismatch</p>
                <p className="text-sm font-semibold text-foreground">
                  {convergence ? convergence.lpf_max_mismatch.toFixed(4) : '-'}
                </p>
              </div>
            </div>
            {validationIssues.length > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground mb-2">Validation fixes</p>
                <div className="space-y-1">
                  {validationIssues.slice(0, 3).map(issue => (
                    <p key={issue} className="text-xs text-muted-foreground">
                      {issue}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border p-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-3 gap-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                {t('results.grid.busDetails')}
                <BusDetailsTooltip />
              </h3>
              <select
                value={selectedBus || ''}
                onChange={e => setSelectedBus(e.target.value)}
                className="px-2 py-1 text-xs border border-border rounded-lg bg-background text-foreground"
              >
                {pypsaData.locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 content-start">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('results.grid.totalBuses')}</p>
                <p className="text-xl font-bold text-foreground">{pypsaData.locations.length}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('results.grid.selected')}</p>
                <p className="text-xl font-bold text-foreground truncate">{selectedBus || '-'}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('results.grid.avgVoltage')}</p>
                <p className="text-xl font-bold text-foreground">
                  {selectedVoltageAvg !== null ? selectedVoltageAvg.toFixed(3) : '-'} <span className="text-sm font-normal">pu</span>
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('results.grid.avgPower')}</p>
                <p className="text-xl font-bold text-foreground">
                  {selectedPowerAvg !== null ? formatPowerValue(selectedPowerAvg) : '-'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Voltage span</p>
                <p className="text-sm font-semibold text-foreground">
                  {selectedVoltageMin !== null && selectedVoltageMax !== null
                    ? `${selectedVoltageMin.toFixed(3)} - ${selectedVoltageMax.toFixed(3)} pu`
                    : '-'}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Most loaded transformer</p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {busiestTransformer
                    ? `${busiestTransformer.name} (${(busiestTransformer.peakLoadingPercent || 0).toFixed(1)}%)`
                    : 'n/a'}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Gauge className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium text-foreground">Bottlenecks</p>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Busiest line</span>
                  <span className="text-right font-medium text-foreground">
                    {busiestLine
                      ? `${busiestLine.name} • ${busiestLine.peakLoadingPercent !== undefined ? `${busiestLine.peakLoadingPercent.toFixed(1)}%` : formatApparentPowerValue(busiestLine.peakApparentKva)}`
                      : 'n/a'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Top transformer</span>
                  <span className="text-right font-medium text-foreground">
                    {busiestTransformer
                      ? `${busiestTransformer.name} • ${(busiestTransformer.peakLoadingPercent || 0).toFixed(1)}%`
                      : 'n/a'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center">
            {t('results.grid.voltageProfile')} - {selectedBus}
            <VoltageProfileTooltip />
          </h4>
          <ErrorBoundary label="Voltage Profile">
            {selectedVoltage.length > 0 ? (
              <PyPSAVoltageChart
                timestamps={selectedVoltage.map(v => v.timestep)}
                voltage={selectedVoltage.map(v => v.v_mag_pu)}
                height={220}
                title=""
              />
            ) : (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm bg-muted/30 rounded-lg">
                {t('results.grid.noVoltageData')}
              </div>
            )}
          </ErrorBoundary>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center">
            {t('results.grid.powerFlow')} - {selectedBus}
            <PowerFlowTooltip />
          </h4>
          <ErrorBoundary label="Power Flow">
            {sanitizedSelectedPower.length > 0 ? (
              <PyPSAPowerChart
                timestamps={sanitizedSelectedPower.map(p => p.timestep)}
                activePower={sanitizedSelectedPower.map(p => p.p)}
                reactivePower={sanitizedSelectedPower.map(p => p.q || 0)}
                height={220}
                showReactive={true}
              />
            ) : (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm bg-muted/30 rounded-lg">
                {t('results.grid.noPowerData')}
              </div>
            )}
          </ErrorBoundary>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <ErrorBoundary label="Voltage Violations">
            <PyPSAVoltageViolationChart items={voltageViolationItems} height={240} />
          </ErrorBoundary>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <ErrorBoundary label="Line Loading">
            <PyPSALineLoadingChart items={lineLoadingItems} height={240} />
          </ErrorBoundary>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <ErrorBoundary label="Transformer Loading">
            <PyPSATransformerLoadingChart items={transformerLoadingItems} height={240} />
          </ErrorBoundary>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Zap className="w-4 h-4 text-primary" />
            Renewable Curtailment
          </div>
          <ErrorBoundary label="Curtailment Chart">
            <PyPSACurtailmentChart
              timestamps={curtailmentTimeline.map(item => item.timestep)}
              availableKw={curtailmentTimeline.map(item => item.available_kw)}
              actualKw={curtailmentTimeline.map(item => item.actual_kw)}
              curtailedKw={curtailmentTimeline.map(item => item.curtailed_kw)}
              height={220}
              title=""
            />
          </ErrorBoundary>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <ErrorBoundary label="Losses Chart">
            <PyPSALossesChart
              timestamps={lossesTimeline.map(item => item.timestamp)}
              lineLossesKw={lossesTimeline.map(item => item.lineLossesKw)}
              transformerLossesKw={lossesTimeline.map(item => item.transformerLossesKw)}
              height={240}
            />
          </ErrorBoundary>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground mb-4">Critical Assets</h4>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground mb-3">Worst Buses</p>
              <div className="space-y-2">
                {worstBuses.length > 0 ? worstBuses.map(item => (
                  <div key={item.name} className="flex items-start justify-between gap-3 text-xs">
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <span className="text-right font-medium text-foreground">
                      {item.hoursOutside.toFixed(1)} h • {item.maxDeviationPu.toFixed(4)} pu
                    </span>
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground">No voltage violations.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground mb-3">Worst Lines</p>
              <div className="space-y-2">
                {worstLines.length > 0 ? worstLines.map(item => (
                  <div key={item.name} className="flex items-start justify-between gap-3 text-xs">
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <span className="text-right font-medium text-foreground">
                      {item.peakLoadingPercent !== undefined
                        ? `${item.peakLoadingPercent.toFixed(1)}% • ${item.peakLossKw.toFixed(2)} kW`
                        : `${formatApparentPowerValue(item.peakApparentKva)} • ${item.peakLossKw.toFixed(2)} kW`}
                    </span>
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground">No line loading data.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GridPanel;
