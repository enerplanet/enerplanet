import { FC } from 'react';
import { ArrowDown, ArrowUp, Minus, Zap, TrendingUp, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@spatialhub/i18n';
import { carrierDisplay, isGenerationCarrier } from '@/features/model-results/carrierUnits';
import { formatNumber } from '@/utils/formatNumber';

interface SummaryData {
  total_generation_kwh: number;
  total_demand_kwh: number;
  renewable_production_kwh: number;
  grid_import_kwh: number;
  self_sufficiency_rate: number;
  grid_dependency_rate: number;
  peak_demand_kw: number;
  average_demand_kw: number;
  total_cost_eur: number;
  /** Stored levelised cost, EUR/MWh (see lcoeUnits). */
  lcoe_eur_mwh: number;
}

interface ComparisonSummaryProps {
  data1: SummaryData;
  data2: SummaryData;
  /** Carrier both sides were fetched for — drives units and the metric set. */
  carrier?: string;
  /** Grid electricity prices each run used, ct/kWh; absent for older runs. */
  gridPrices?: [GridPrices | undefined, GridPrices | undefined];
}

type GridPrices = { import_ct_per_kwh: number; export_ct_per_kwh: number };

const FLOATING_POINT_EPSILON = 1e-6;

function normalizeDisplayValue(value: number, precision: number = 3): number {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
}

// Icon config per metric
const CARD_STYLES: Record<string, {
  icon: React.ElementType;
}> = {
  demand: { icon: Zap },
  sufficiency: { icon: TrendingUp },
  cost: { icon: DollarSign },
};

const MetricCard: FC<{
  label: string;
  value1: number;
  value2: number;
  unit: string;
  baselineLabel: string;
  comparisonLabel: string;
  inverse?: boolean;
  format?: (v: number) => string;
  styleKey: string;
}> = ({ label, value1, value2, unit, baselineLabel, comparisonLabel, inverse = false, format = (v) => formatNumber(v, 3, 0), styleKey }) => {
  const safeValue1 = normalizeDisplayValue(value1);
  const safeValue2 = normalizeDisplayValue(value2);
  const diff = normalizeDisplayValue(safeValue2 - safeValue1);
  const percentChange = safeValue1 === 0 ? 0 : normalizeDisplayValue((diff / safeValue1) * 100, 2);
  const style = CARD_STYLES[styleKey] || CARD_STYLES.demand;
  const Icon = style.icon;

  let isGood = inverse ? diff < 0 : diff > 0;
  if (Math.abs(diff) < 0.001) isGood = true;

  const pillClasses = (() => {
    if (Math.abs(diff) < 0.001) return 'bg-muted text-muted-foreground';
    if (isGood) return 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400';
    return 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400';
  })();

  const ChangeIcon = (() => {
    if (Math.abs(diff) < 0.001) return Minus;
    if (diff > 0) return ArrowUp;
    return ArrowDown;
  })();

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-md">
      {/* Header row: icon badge + label + change pill */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
        </div>
        <div className={cn('flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full', pillClasses)}>
          <ChangeIcon className="w-3 h-3" />
          {formatNumber(Math.abs(percentChange), 1)}%
        </div>
      </div>

      {/* Values side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Baseline */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{baselineLabel}</p>
          <p className="text-sm font-bold text-foreground">
            {format(safeValue1)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
        {/* Comparison */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{comparisonLabel}</p>
          <p className="text-lg font-bold text-foreground">
            {format(safeValue2)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export const ComparisonSummary: FC<ComparisonSummaryProps> = ({ data1, data2, carrier, gridPrices }) => {
  const { t } = useTranslation();

  const baselineLabel = t('simulationComparison.summary.baseline');
  const comparisonLabel = t('simulationComparison.comparison');
  const generation = isGenerationCarrier(carrier);
  const { energyUnit, powerUnit } = carrierDisplay(carrier);

  // Self-sufficiency only exists for a generating carrier. A heat comparison shows peak demand instead.
  const generationCards = generation ? (
    <MetricCard
      label={t('simulationComparison.metrics.selfSufficiency')}
      value1={data1.self_sufficiency_rate * 100}
      value2={data2.self_sufficiency_rate * 100}
      unit="%"
      baselineLabel={baselineLabel}
      comparisonLabel={comparisonLabel}
      styleKey="sufficiency"
      format={(v) => formatNumber(v, 1)}
    />
  ) : (
    <MetricCard
      label={t('simulationComparison.metrics.peakDemand')}
      value1={data1.peak_demand_kw}
      value2={data2.peak_demand_kw}
      unit={powerUnit}
      baselineLabel={baselineLabel}
      comparisonLabel={comparisonLabel}
      inverse
      styleKey="demand"
      format={(v) => {
        if (v >= 1000) return `${formatNumber(v / 1000, 1)}k`;
        return formatNumber(v, 1);
      }}
    />
  );

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('simulationComparison.performanceComparison')}
      </div>

      <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2', generation ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <MetricCard
          label={t('simulationComparison.metrics.totalDemand')}
          value1={data1.total_demand_kwh}
          value2={data2.total_demand_kwh}
          unit={energyUnit}
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          styleKey="demand"
          format={(v) => {
            if (v >= 1000000) return `${formatNumber(v / 1000000, 2)}M`;
            if (v >= 1000) return `${formatNumber(v / 1000, 1)}k`;
            return formatNumber(v, 0);
          }}
        />
        {generationCards}
        <MetricCard
          label={t('simulationComparison.metrics.totalCost')}
          value1={data1.total_cost_eur}
          value2={data2.total_cost_eur}
          unit="€"
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          inverse
          styleKey="cost"
          format={(v) => {
            if (v >= 1000000) return `${formatNumber(v / 1000000, 2)}M`;
            if (v >= 1000) return `${formatNumber(v / 1000, 0)}k`;
            return formatNumber(v, 0);
          }}
        />
      </div>
      {gridPrices && (gridPrices[0] || gridPrices[1]) && (
        <p className="text-xs text-muted-foreground">
          {t('gridPrices.compared', {
            baseline: gridPrices[0] ? t('gridPrices.pair', { import: gridPrices[0].import_ct_per_kwh, export: gridPrices[0].export_ct_per_kwh }) : t('gridPrices.notRecorded'),
            comparison: gridPrices[1] ? t('gridPrices.pair', { import: gridPrices[1].import_ct_per_kwh, export: gridPrices[1].export_ct_per_kwh }) : t('gridPrices.notRecorded'),
          })}
        </p>
      )}
    </div>
  );
};
