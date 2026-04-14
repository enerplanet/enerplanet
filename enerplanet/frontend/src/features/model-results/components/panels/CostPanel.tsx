import { useMemo } from 'react';
import { TrendingUp, Layers, Gauge, PieChart, Clock, AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  CostAnalysisChart,
  LCOEComparisonChart,
  InvestmentBreakdownChart,
  SystemCostSummaryChart,
} from '@/features/simulation-charts/model-results';
import { useTranslation } from '@spatialhub/i18n';
import type { StructuredModelResults } from '@/features/model-results/types';
import { transformStructuredCostBreakdown } from '@/features/configurator/utils/costUtils';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';


const COST_TECH_I18N_KEYS: Record<string, string> = {
  pv_supply: 'results.techNames.solarPv',
  wind_supply: 'results.techNames.wind',
  wind_onshore: 'results.techNames.windOnshore',
  'wind-turbine_supply': 'results.techNames.windTurbine',
  wind_turbine_supply: 'results.techNames.windTurbine',
  biomass_supply: 'results.techNames.biomass',
  battery_storage: 'results.techNames.batteryStorage',
  geothermal_supply: 'results.techNames.geothermal',
  transformer_supply: 'results.techNames.gridElectricity',
  power_transmission: 'results.techNames.powerLines',
  water_supply: 'results.techNames.hydroPower',
  households_supply: 'results.techNames.householdSupply',
  non_households_supply: 'results.techNames.nonHouseholdSupply',
};

/**
 * Normalize tech key: strip location suffixes like "power_transmission:Trafo_300" → "power_transmission"
 */
function normalizeTechKey(tech: string): string {
  const colonIdx = tech.indexOf(':');
  if (colonIdx > 0) {
    return tech.substring(0, colonIdx);
  }
  return tech;
}

function getTechLabel(tech: string, t: (key: string) => string): string {
  const normalized = normalizeTechKey(tech);
  const i18nKey = COST_TECH_I18N_KEYS[normalized];
  return i18nKey
    ? t(i18nKey)
    : normalized.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());
}

interface CostPanelProps {
  structuredResults: StructuredModelResults | null | undefined;
  summary?: {
    total_cost_eur: number;
    lcoe_eur_kwh: number;
  } | null;
  simulationPeriod?: {
    from_date: string;
    to_date: string;
    timestep_count: number;
  } | null;
}

const CostPanel = ({ structuredResults, summary, simulationPeriod }: CostPanelProps) => {
  const { t } = useTranslation();

  // Calculate simulation period details — always derived from model from_date / to_date
  const periodInfo = useMemo(() => {
    const hoursInYear = 8760;
    const fromDateObj = simulationPeriod?.from_date ? new Date(simulationPeriod.from_date) : null;
    const toDateObj = simulationPeriod?.to_date ? new Date(simulationPeriod.to_date) : null;

    let timesteps = hoursInYear;
    if (fromDateObj && toDateObj && !isNaN(fromDateObj.getTime()) && !isNaN(toDateObj.getTime())) {
      const diffMs = toDateObj.getTime() - fromDateObj.getTime();
      timesteps = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
    }

    const days = Math.round((timesteps / 24) * 10) / 10;
    const isPartialYear = timesteps < hoursInYear * 0.95;
    const fromDate = fromDateObj ? fromDateObj.toLocaleDateString() : undefined;
    const toDate = toDateObj ? toDateObj.toLocaleDateString() : undefined;
    return { timesteps, days, isPartialYear, fromDate, toDate };
  }, [simulationPeriod]);

  // Cost distribution donut data
  const costBreakdown = useMemo(() => {
    if (structuredResults?.cost?.length) {
      return transformStructuredCostBreakdown(structuredResults);
    }
    return [];
  }, [structuredResults]);

  // LCOE comparison data — exclude infrastructure techs (power_transmission has no meaningful LCOE)
  const LCOE_EXCLUDED_TECHS = new Set(['power_transmission']);
  const lcoeData = useMemo(() => {
    if (!structuredResults?.model_levelised_cost?.length) return [];
    const byTech: Record<string, { sum: number; count: number }> = {};
    structuredResults.model_levelised_cost.forEach(r => {
      const tech = normalizeTechKey(r.techs);
      if (LCOE_EXCLUDED_TECHS.has(tech)) return;
      if (!byTech[tech]) byTech[tech] = { sum: 0, count: 0 };
      byTech[tech].sum += r.value;
      byTech[tech].count += 1;
    });

    // Cross-reference with cost data for richer tooltips
    const costByTech: Record<string, number> = {};
    const investByTech: Record<string, number> = {};
    structuredResults.cost?.forEach((c: any) => {
      const tech = normalizeTechKey(c.techs || '');
      costByTech[tech] = (costByTech[tech] || 0) + Math.abs(c.value);
    });
    structuredResults.cost_investment?.forEach((c: any) => {
      const tech = normalizeTechKey(c.techs || '');
      investByTech[tech] = (investByTech[tech] || 0) + Math.abs(c.value);
    });

    return Object.entries(byTech)
      .filter(([_, v]) => v.sum > 0)
      .map(([tech, v]) => {
        const lcoe = v.sum / v.count;
        const totalCost = costByTech[tech] || 0;
        const investCost = investByTech[tech] || 0;
        const variableCost = Math.max(0, totalCost - investCost);
        const energyProduced = lcoe > 0 ? totalCost / lcoe : 0; // kWh
        return {
          tech,
          label: getTechLabel(tech, t),
          lcoe,
          totalCost,
          investCost,
          variableCost,
          energyProduced,
        };
      });
  }, [structuredResults?.model_levelised_cost, structuredResults?.cost, structuredResults?.cost_investment, t]);

  // System LCOE
  const systemLCOE = useMemo(() => {
    if (!structuredResults?.model_total_levelised_cost?.length) return undefined;
    const totalRow = structuredResults.model_total_levelised_cost.find(
      r => r.costs === 'monetary' || r.costs === 'total'
    );
    return totalRow?.value ?? structuredResults.model_total_levelised_cost[0]?.value;
  }, [structuredResults?.model_total_levelised_cost]);

  // Investment vs Operating breakdown
  const investmentData = useMemo(() => {
    if (!structuredResults?.cost?.length) return [];
    const totalByTech: Record<string, number> = {};
    const investByTech: Record<string, number> = {};

    structuredResults.cost.forEach(c => {
      const tech = normalizeTechKey(c.techs);
      totalByTech[tech] = (totalByTech[tech] || 0) + Math.abs(c.value);
    });
    structuredResults.cost_investment?.forEach(c => {
      const tech = normalizeTechKey(c.techs);
      investByTech[tech] = (investByTech[tech] || 0) + Math.abs(c.value);
    });

    return Object.entries(totalByTech)
      .filter(([_, total]) => total > 0.01)
      .map(([tech, total]) => ({
        tech,
        label: getTechLabel(tech, t),
        investment: investByTech[tech] || 0,
        variable: Math.max(0, total - (investByTech[tech] || 0)),
      }));
  }, [structuredResults?.cost, structuredResults?.cost_investment, t]);

  // System cost summary
  const systemCostSummary = useMemo(() => {
    if (!structuredResults?.cost?.length) return null;
    let totalCost = 0;
    let investmentCost = 0;
    structuredResults.cost.forEach(c => { totalCost += Math.abs(c.value); });
    structuredResults.cost_investment?.forEach(c => { investmentCost += Math.abs(c.value); });
    return {
      totalCost,
      investmentCost,
      variableCost: Math.max(0, totalCost - investmentCost),
      annualizedProduction: structuredResults.sum_production || 0,
    };
  }, [structuredResults?.cost, structuredResults?.cost_investment, structuredResults?.sum_production]);

  const hasData = costBreakdown.length > 0 || lcoeData.length > 0 || investmentData.length > 0;

  if (!hasData) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <PieChart className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('results.chartLabels.noCostData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Simulation period info banner */}
      {periodInfo.isPartialYear && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
            <p className="font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('results.chartLabels.simulationPeriod')}: {periodInfo.days} {t('results.chartLabels.days')} ({periodInfo.timesteps} {t('results.chartLabels.hours')})
              {periodInfo.fromDate && periodInfo.toDate && (
                <span className="text-amber-600 dark:text-amber-400 font-normal">
                  ({periodInfo.fromDate} — {periodInfo.toDate})
                </span>
              )}
            </p>
            <p>{t('results.costInfo.simulationPeriodNote', { days: periodInfo.days.toString(), hours: periodInfo.timesteps.toString() })}</p>
          </div>
        </div>
      )}

      {/* Top row: Cost Distribution + System Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {costBreakdown.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" />
              {t('results.charts.costDistribution')}
              {periodInfo.isPartialYear && (
                <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
                  {t('results.costInfo.simulationPeriodShort', { days: periodInfo.days.toString() })}
                </span>
              )}
              <ChartInfoTooltip
                title={t('results.charts.costDistribution')}
                description={t('results.costInfo.costBreakdownTooltip')}
                items={[
                  { color: '#6b7280', label: t('results.chartLabels.opex'), description: t('results.costInfo.runningCostDesc') },
                  { color: '#f59e0b', label: t('results.chartLabels.capex'), description: t('results.costInfo.equipmentCostDesc') },
                ]}
              />
            </h3>
            <ErrorBoundary label="Cost Analysis">
              <CostAnalysisChart
                data={costBreakdown}
                totalCost={summary?.total_cost_eur}
                lcoe={summary?.lcoe_eur_kwh}
                height={320}
                isPartialYear={periodInfo.isPartialYear}
                simulationDays={periodInfo.days}
              />
            </ErrorBoundary>
          </div>
        )}

        {systemCostSummary && systemCostSummary.totalCost > 0 && (
          <div className="bg-card rounded-xl border border-border p-4 lg:col-span-1">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" />
              {t('results.charts.systemCostSummary')}
              <ChartInfoTooltip
                title={t('results.charts.systemCostSummary')}
                description={t('results.costInfo.systemCostSummaryDesc')}
                items={[
                  { color: '#3b82f6', label: t('results.chartLabels.investmentCost'), description: t('results.costInfo.equipmentCostDesc') },
                  { color: '#f59e0b', label: t('results.chartLabels.operatingCost'), description: t('results.costInfo.runningCostDesc') },
                ]}
              />
            </h3>
            <ErrorBoundary label="System Cost Summary">
              <SystemCostSummaryChart
                systemLCOE={systemLCOE}
                totalCost={systemCostSummary.totalCost}
                investmentCost={systemCostSummary.investmentCost}
                variableCost={systemCostSummary.variableCost}
                annualizedProduction={systemCostSummary.annualizedProduction}
                height={320}
                simulationDays={periodInfo.days}
                isPartialYear={periodInfo.isPartialYear}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {/* Bottom row: LCOE Comparison + Investment Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {lcoeData.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              {t('results.charts.lcoeComparison')}
              <ChartInfoTooltip
                title={t('results.charts.lcoeComparison')}
                description={t('results.costInfo.lcoeComparisonDesc')}
              />
            </h3>
            <ErrorBoundary label="LCOE Comparison">
              <LCOEComparisonChart data={lcoeData} systemLCOE={systemLCOE} height={300} />
            </ErrorBoundary>
          </div>
        )}

        {investmentData.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              {t('results.charts.investmentVsOperating')}
              <ChartInfoTooltip
                title={t('results.charts.investmentVsOperating')}
                description={t('results.costInfo.investmentBreakdownDesc')}
                items={[
                  { color: '#3b82f6', label: t('results.chartLabels.investmentCost'), description: t('results.costInfo.equipmentCostDesc') },
                  { color: '#f59e0b', label: t('results.chartLabels.operatingCost'), description: t('results.costInfo.runningCostDesc') },
                ]}
              />
            </h3>
            <ErrorBoundary label="Investment Breakdown">
              <InvestmentBreakdownChart data={investmentData} height={300} simulationDays={periodInfo.days} isPartialYear={periodInfo.isPartialYear} systemTotalCost={systemCostSummary?.totalCost} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostPanel;
