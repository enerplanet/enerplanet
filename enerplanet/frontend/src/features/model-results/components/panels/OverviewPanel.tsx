import { useState, useMemo } from 'react';
import {
  Activity,
  BarChart3,
  Network,
  PieChart,
  Info,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EnergyFlowSankey } from '@/features/simulation-charts/common';
import {
  TechnologyCapacityBar,
  CostAnalysisChart,
  PerformanceGauges,
} from '@/features/simulation-charts/model-results';
import {
  transformToCapacityData,
  transformToCostBreakdown,
  transformToEnergyFlow,
} from '@/features/configurator/utils/transformUtils';
import { useTranslation } from '@spatialhub/i18n';


const SystemPerformanceTooltip = () => {
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
        aria-label={t('results.charts.systemPerformance')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.charts.systemPerformance')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.charts.systemPerformanceDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.metrics.selfSufficiency')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.selfSufficiencyDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.gridDependency')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.gridDependencyDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.capacityUtilization')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.capacityUtilizationDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const TechnologyCapacityTooltip = () => {
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
        aria-label={t('results.charts.technologyCapacity')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.charts.technologyCapacity')}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mt-1">
                {t('results.charts.technologyCapacityDesc', 'Overview of the energy system size and its utilization efficiency.')}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <div className="w-3 h-3 rounded-[3px] bg-gray-400 dark:bg-gray-500 flex-shrink-0 mt-0.5"></div>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.installedCapacity', 'Installed Capacity (Bars)')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {t('results.charts.installedCapacityDesc', 'The maximum potential power output of the hardware, measured in kW or MW. Represented by the height of the bars on the left axis.')}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-3 border-t-2 border-dashed border-[#8b5cf6] mt-1.5 flex-shrink-0"></div>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.capacityFactor', 'Capacity Factor')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {t('results.charts.capacityFactorTooltipDesc', 'The percentage of the installed capacity that is actually utilized on average over the year. For example, a 15% capacity factor means the technology produced 15% of its theoretical maximum potential output. Represented by the purple line on the right axis.')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


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


const EnergyFlowTooltip = () => {
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
        aria-label={t('results.charts.energyFlow')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] bottom-full left-0 -translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.charts.energyFlowAggregated')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.charts.energyFlowDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.sources')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.sourcesDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.energySystem')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.energySystemDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.charts.demand')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.charts.demandDesc')}</p>
                </div>
              </div>
            </div>

            <div className="text-[10px] text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
              {t('results.charts.energyFlowNote')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface SummaryData {
  self_sufficiency_rate: number;
  grid_dependency_rate: number;
  total_cost_eur: number;
  lcoe_eur_kwh: number;
}

interface OverviewPanelProps {
  summary: SummaryData | null;
  capacityData: ReturnType<typeof transformToCapacityData>;
  costBreakdown: ReturnType<typeof transformToCostBreakdown>;
  energyFlow: ReturnType<typeof transformToEnergyFlow>;
  avgCapacityFactor: number;
  simulationPeriod?: {
    from_date: string;
    to_date: string;
  } | null;
}

const OverviewPanel = ({ summary, capacityData, costBreakdown, energyFlow, avgCapacityFactor, simulationPeriod }: OverviewPanelProps) => {
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
    <div className="p-4 space-y-4">
      {/* Performance Gauges */}
      {summary && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            {t('results.charts.systemPerformance')}
            <SystemPerformanceTooltip />
          </h3>
          <PerformanceGauges
            selfConsumption={summary.self_sufficiency_rate}
            gridDependency={summary.grid_dependency_rate}
            capacityUtilization={avgCapacityFactor}
            co2Reduction={Math.min(100, summary.self_sufficiency_rate * 100)}
            height={150}
          />
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {capacityData.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              {t('results.charts.technologyCapacity')}
              <TechnologyCapacityTooltip />
            </h3>
            <ErrorBoundary label="Technology Capacity">
              <TechnologyCapacityBar data={capacityData} height={320} />
            </ErrorBoundary>
          </div>
        )}

        {costBreakdown.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4 lg:col-span-1">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" />
              {t('results.charts.costDistribution')}
              <CostDistributionTooltip />
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
      </div>

      {/* Energy Flow */}
      {energyFlow.nodes.length > 2 && energyFlow.links.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            {t('results.charts.energyFlow')}
            <EnergyFlowTooltip />
          </h3>
          <ErrorBoundary label="Energy Flow">
            <EnergyFlowSankey data={energyFlow} height={280} title="" />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default OverviewPanel;
