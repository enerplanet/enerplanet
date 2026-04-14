import { FC } from 'react';
import { ArrowDown, ArrowUp, Minus, Zap, TrendingUp, DollarSign, Leaf } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@spatialhub/i18n';

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
  lcoe_eur_kwh: number;
  co2_savings_kg: number;
}

interface ComparisonSummaryProps {
  data1: SummaryData;
  data2: SummaryData;
}

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
  co2: { icon: Leaf },
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
}> = ({ label, value1, value2, unit, baselineLabel, comparisonLabel, inverse = false, format = (v) => v.toLocaleString(), styleKey }) => {
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
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
      {/* Header row: icon badge + label + change pill */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-muted rounded-lg">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
        </div>
        <div className={cn('flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full', pillClasses)}>
          <ChangeIcon className="w-3 h-3" />
          {Math.abs(percentChange).toFixed(1)}%
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

export const ComparisonSummary: FC<ComparisonSummaryProps> = ({ data1, data2 }) => {
  const { t } = useTranslation();

  const baselineLabel = t('simulationComparison.summary.baseline');
  const comparisonLabel = t('simulationComparison.comparison');

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="bg-muted rounded-lg px-4 py-2 text-center text-xs font-semibold text-foreground sm:text-sm border border-border">
        {t('simulationComparison.performanceComparison')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={t('simulationComparison.metrics.totalDemand')}
          value1={data1.total_demand_kwh}
          value2={data2.total_demand_kwh}
          unit="kWh"
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          styleKey="demand"
          format={(v) => {
            if (v >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
            if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
            return v.toFixed(0);
          }}
        />
        <MetricCard
          label={t('simulationComparison.metrics.selfSufficiency')}
          value1={data1.self_sufficiency_rate * 100}
          value2={data2.self_sufficiency_rate * 100}
          unit="%"
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          styleKey="sufficiency"
          format={(v) => v.toFixed(1)}
        />
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
            if (v >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
            if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
            return v.toFixed(0);
          }}
        />
        <MetricCard
          label={t('simulationComparison.metrics.co2Savings')}
          value1={data1.co2_savings_kg}
          value2={data2.co2_savings_kg}
          unit="kg"
          baselineLabel={baselineLabel}
          comparisonLabel={comparisonLabel}
          styleKey="co2"
          format={(v) => {
            if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
            return v.toFixed(0);
          }}
        />
      </div>
    </div>
  );
};
