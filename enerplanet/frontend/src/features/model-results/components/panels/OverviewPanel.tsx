import { useState, useMemo } from 'react';
import { CHART_CARD_CLASS } from '../ui/PanelStates';
import { PieChart, Info } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CostAnalysisChart } from '@/features/simulation-charts/model-results';
import { transformToCostBreakdown } from '@/features/configurator/utils/transformUtils';
import { useTranslation } from '@spatialhub/i18n';

const CostDistributionTooltip = () => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
        aria-label={t('results.charts.costDistribution')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.charts.costDistribution')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.charts.costDistributionDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.capitalCosts')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.capitalCostsDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.lcoe')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.lcoeDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface SummaryData {
  total_cost_eur: number;
  /** Stored levelised cost, EUR/MWh (see lcoeUnits). */
  lcoe_eur_mwh: number;
}

interface OverviewPanelProps {
  summary: SummaryData | null;
  costBreakdown: ReturnType<typeof transformToCostBreakdown>;
  /** Feed-in revenue, already subtracted from summary.total_cost_eur. */
  feedInIncome?: number;
  simulationPeriod?: {
    from_date: string;
    to_date: string;
  } | null;
}

const OverviewPanel = ({ summary, costBreakdown, feedInIncome, simulationPeriod }: OverviewPanelProps) => {
  const { t } = useTranslation();

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
    return { days, isPartialYear };
  }, [simulationPeriod]);

  return (
    <div className="md-stagger p-4 space-y-4">
      {costBreakdown.length > 0 && (
        <div className={CHART_CARD_CLASS}>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" />
            {t('results.charts.costDistribution')}
            <CostDistributionTooltip />
          </h3>
          <ErrorBoundary label="Cost Analysis">
            <CostAnalysisChart
              data={costBreakdown}
              totalCost={summary?.total_cost_eur}
              lcoe={summary?.lcoe_eur_mwh}
              income={feedInIncome}
              height={320}
              isPartialYear={periodInfo.isPartialYear}
              simulationDays={periodInfo.days}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default OverviewPanel;
