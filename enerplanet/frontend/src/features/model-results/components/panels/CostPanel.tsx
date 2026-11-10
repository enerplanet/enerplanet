import { useMemo, useState } from 'react';
import { TrendingUp, Layers, Gauge, PieChart, Clock, PlugZap } from 'lucide-react';
import { PanelEmptyState, CHART_CARD_CLASS } from '../ui/PanelStates';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  CostAnalysisChart,
  LCOEComparisonChart,
  InvestmentBreakdownChart,
  SystemCostSummaryChart,
} from '@/features/simulation-charts/model-results';
import { useTranslation } from '@spatialhub/i18n';
import type { StructuredModelResults } from '@/features/model-results/types';
import { feedInIncome, netCost, transformStructuredCostBreakdown } from '@/features/configurator/utils/costUtils';
import { getTechGroup } from '@/features/configurator/utils/transformUtils';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import { ViewTabs, type ChartView } from '../ui/ViewTabs';
import { energyKwhFromCost } from '../../lcoeUnits';
import { splitGridPurchase } from '../../costSplit';


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
  grid_trafo_import: 'results.techNames.gridElectricity',
  power_transmission: 'results.techNames.powerLines',
  water_supply: 'results.techNames.hydroPower',
  households_supply: 'results.techNames.householdSupply',
  non_households_supply: 'results.techNames.nonHouseholdSupply',
};

function getTechLabel(tech: string, t: (key: string) => string): string {
  const normalized = getTechGroup(tech);
  const i18nKey = COST_TECH_I18N_KEYS[normalized];
  return i18nKey
    ? t(i18nKey)
    : normalized.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());
}

interface CostPanelProps {
  structuredResults: StructuredModelResults | null | undefined;
  summary?: {
    total_cost_eur: number;
    /** Stored levelised cost, EUR/MWh (see lcoeUnits). */
    lcoe_eur_mwh: number;
  } | null;
  simulationPeriod?: {
    from_date: string;
    to_date: string;
    timestep_count: number;
  } | null;
  /** Run mode; LCOE is shown for plan runs only. */
  mode?: 'plan' | 'operate';
}

type CostView = 'distribution' | 'summary' | 'lcoe' | 'investment';

const CostPanel = ({ structuredResults, summary, simulationPeriod, mode }: CostPanelProps) => {
  const { t } = useTranslation();
  const [view, setView] = useState<CostView>('distribution');
  const plan = mode !== 'operate';

  // Calculate simulation period details — always derived from model from_date / to_date
  const periodInfo = useMemo(() => {
    const hoursInYear = 8760;
    const fromDateObj = simulationPeriod?.from_date ? new Date(simulationPeriod.from_date) : null;
    const toDateObj = simulationPeriod?.to_date ? new Date(simulationPeriod.to_date) : null;

    let timesteps = hoursInYear;
    if (fromDateObj && toDateObj && !isNaN(fromDateObj.getTime()) && !isNaN(toDateObj.getTime())) {
      // to_date is the run's last day at midnight, and the run includes that day.
      const diffMs = toDateObj.getTime() - fromDateObj.getTime();
      timesteps = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)) + 24);
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
      const tech = getTechGroup(r.techs);
      if (LCOE_EXCLUDED_TECHS.has(tech)) return;
      if (!byTech[tech]) byTech[tech] = { sum: 0, count: 0 };
      byTech[tech].sum += r.value;
      byTech[tech].count += 1;
    });

    // Cross-reference with cost data for richer tooltips
    const costByTech: Record<string, number> = {};
    const investByTech: Record<string, number> = {};
    structuredResults.cost?.forEach((c: any) => {
      const tech = getTechGroup(c.techs || '');
      costByTech[tech] = (costByTech[tech] || 0) + Math.abs(c.value);
    });
    structuredResults.cost_investment?.forEach((c: any) => {
      const tech = getTechGroup(c.techs || '');
      investByTech[tech] = (investByTech[tech] || 0) + Math.abs(c.value);
    });

    return Object.entries(byTech)
      .filter(([_, v]) => v.sum > 0)
      .map(([tech, v]) => {
        const lcoe = v.sum / v.count;
        const totalCost = costByTech[tech] || 0;
        const investCost = investByTech[tech] || 0;
        const variableCost = Math.max(0, totalCost - investCost);
        const energyProduced = energyKwhFromCost(totalCost, lcoe); // kWh
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
      const tech = getTechGroup(c.techs);
      totalByTech[tech] = (totalByTech[tech] || 0) + c.value;
    });
    structuredResults.cost_investment?.forEach(c => {
      const tech = getTechGroup(c.techs);
      investByTech[tech] = (investByTech[tech] || 0) + Math.abs(c.value);
    });

    const rows = Object.entries(totalByTech)
      .filter(([_, total]) => total > 0.01)
      .map(([tech, total]) => ({
        tech,
        label: getTechLabel(tech, t),
        investment: investByTech[tech] || 0,
        variable: Math.max(0, total - (investByTech[tech] || 0)),
      }));
    return splitGridPurchase(rows, structuredResults.con_aggregates, t);
  }, [structuredResults?.cost, structuredResults?.cost_investment, structuredResults?.con_aggregates, t]);

  // System cost summary
  const systemCostSummary = useMemo(() => {
    if (!structuredResults?.cost?.length) return null;
    const totalCost = netCost(structuredResults.cost);
    let investmentCost = 0;
    structuredResults.cost_investment?.forEach(c => { investmentCost += Math.abs(c.value); });
    return {
      totalCost,
      investmentCost,
      variableCost: Math.max(0, totalCost - investmentCost),
      annualizedProduction: structuredResults.sum_production || 0,
    };
  }, [structuredResults?.cost, structuredResults?.cost_investment, structuredResults?.sum_production]);

  const hasData = costBreakdown.length > 0 || lcoeData.length > 0 || investmentData.length > 0;

  const icon = 'h-4 w-4 text-primary';
  const views: ChartView<CostView>[] = [
    ...(costBreakdown.length > 0 ? [{ id: 'distribution' as const, icon: <PieChart className={icon} />, name: t('results.charts.costDistribution'), kind: t('results.costInfo.distributionKind', 'Donut chart, cost by technology') }] : []),
    ...(systemCostSummary && systemCostSummary.totalCost > 0 ? [{ id: 'summary' as const, icon: <Gauge className={icon} />, name: t('results.charts.systemCostSummary'), kind: t('results.costInfo.summaryKind', 'Donut chart, investment and operating') }] : []),
    ...(plan && lcoeData.length > 0 ? [{ id: 'lcoe' as const, icon: <TrendingUp className={icon} />, name: t('results.charts.lcoeComparison'), kind: t('results.costInfo.lcoeKind', 'Bar chart, cost per MWh by technology') }] : []),
    ...(investmentData.length > 0 ? [{ id: 'investment' as const, icon: <Layers className={icon} />, name: t('results.charts.investmentVsOperating'), kind: t('results.costInfo.investmentKind', 'Stacked bars, cost by technology') }] : []),
  ];
  const active = views.some((v) => v.id === view) ? view : views[0]?.id;


  if (!hasData) {
    return <PanelEmptyState icon={PieChart} title={t('results.chartLabels.noCostData')} />;
  }

  return (
    <div className="md-stagger p-4 space-y-4">
      {periodInfo.isPartialYear && (
        <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {periodInfo.fromDate && periodInfo.toDate
            ? t('results.costInfo.partialYearRange', 'Costs cover {{days}} days ({{from}} to {{to}}), not a full year.', { days: periodInfo.days, from: periodInfo.fromDate, to: periodInfo.toDate })
            : t('results.costInfo.partialYear', 'Costs cover {{days}} days, not a full year.', { days: periodInfo.days })}
        </p>
      )}

      {structuredResults?.grid_prices && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <PlugZap className="w-3.5 h-3.5" />
          {t('gridPrices.usedInRun', {
            import: structuredResults.grid_prices.import_ct_per_kwh,
            export: structuredResults.grid_prices.export_ct_per_kwh,
          })}
        </p>
      )}

      <div className={CHART_CARD_CLASS}>
        <ViewTabs views={views} value={active} onChange={setView} />
        {active === 'distribution' && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ChartInfoTooltip
                title={t('results.charts.costDistribution')}
                description={t('results.costInfo.costBreakdownTooltip')}
              />
            </h3>
            <ErrorBoundary label="Cost Analysis">
              <CostAnalysisChart
                data={costBreakdown}
                totalCost={summary?.total_cost_eur}
                lcoe={plan ? summary?.lcoe_eur_mwh : undefined}
                income={structuredResults ? feedInIncome(structuredResults) : undefined}
                height={320}
                isPartialYear={periodInfo.isPartialYear}
                simulationDays={periodInfo.days}
              />
            </ErrorBoundary>
          </div>
        )}

        {active === 'summary' && systemCostSummary && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
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
                systemLCOE={plan ? systemLCOE : undefined}
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

        {active === 'lcoe' && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
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

        {active === 'investment' && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
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
