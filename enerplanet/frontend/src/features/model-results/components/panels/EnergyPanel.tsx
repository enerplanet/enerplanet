import { useState, useEffect } from 'react';
import { LineChart, TrendingUp, Zap, Sun, Info, Loader2 } from 'lucide-react';
import { StructuredModelResults, CarrierProdRecord, CarrierConRecord } from '../../types';
import { fetchCarrierTimeSeries } from '../../api';
import {
  DailyLoadProfile,
  EnergyBalanceChart,
  HourlyRenewableGenerationChart,
  LoadDurationCurve,
} from '@/features/simulation-charts/model-results';
import { useTranslation } from '@spatialhub/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';


const DailyEnergyBalanceTooltip = () => {
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
        aria-label={t('results.energy.dailyEnergyBalance')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.energy.dailyEnergyBalance')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.energy.dailyEnergyBalanceDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.production')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.productionDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.consumption')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.consumptionDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const HourlyRenewableGenerationTooltip = () => {
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
        aria-label={t('results.energy.hourlyRenewableGeneration', 'Hourly renewable generation')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('results.energy.hourlyRenewableGeneration', 'Hourly renewable generation')}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t(
                'results.energy.hourlyRenewableGenerationDesc',
                'Stacked hourly output for PV, wind, biomass, and geothermal so you can compare both total generation and technology mix over time.'
              )}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {t('results.energy.techContribution', 'Technology contribution')}
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {t(
                      'results.energy.techContributionDesc',
                      'Each colored band shows how much each renewable technology contributes during every hour.'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {t('results.energy.zoomAndInspect', 'Zoom and inspect')}
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {t(
                      'results.energy.zoomAndInspectDesc',
                      'Use the slider to inspect specific days or hours and compare renewable output at the same timestamp.'
                    )}
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

const GenerationDurationTooltip = () => {
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
        aria-label={t('results.energy.generationDurationCurve', 'Generation duration curve')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('results.energy.generationDurationCurve', 'Generation duration curve')}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t(
                'results.energy.generationDurationCurveDesc',
                'Ranks hourly renewable output from highest to lowest so you can see peak generation and how output falls off across the year.'
              )}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.peakHours')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.peakHoursDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.loadDuration')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.loadDurationDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const DailyLoadProfileTooltip = () => {
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
        aria-label={t('results.energy.dailyLoadProfile')}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('results.energy.dailyLoadProfile')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('results.energy.dailyLoadProfileDesc')}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.peakPeriods')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.peakPeriodsDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.offPeak')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.offPeakDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0 mt-1"></span>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('results.energy.averageLine')}</span>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t('results.energy.averageLineDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface EnergyPanelProps {
  structuredResults: StructuredModelResults | null;
  modelId: number | null;
}

const EnergyPanel = ({ structuredResults, modelId }: EnergyPanelProps) => {
  const { t } = useTranslation();
  const [carrierProd, setCarrierProd] = useState<CarrierProdRecord[]>([]);
  const [carrierCon, setCarrierCon] = useState<CarrierConRecord[]>([]);
  const [dailyProd, setDailyProd] = useState<CarrierProdRecord[]>([]);
  const [dailyCon, setDailyCon] = useState<CarrierConRecord[]>([]);
  const [carrierLoading, setCarrierLoading] = useState(false);
  const [carrierLoaded, setCarrierLoaded] = useState(false);

  // Lazy-load carrier time-series data when this panel is first rendered
  useEffect(() => {
    if (!modelId || carrierLoaded) return;

    // If carrier data was already included in structuredResults (small models), use it directly
    if (structuredResults?.carrier_prod?.length || structuredResults?.carrier_con?.length) {
      setCarrierProd(structuredResults.carrier_prod || []);
      setCarrierCon(structuredResults.carrier_con || []);
      setDailyProd(structuredResults.carrier_prod || []); // Fallback
      setDailyCon(structuredResults.carrier_con || []);   // Fallback
      setCarrierLoaded(true);
      return;
    }

    const loadCarrierData = async () => {
      setCarrierLoading(true);
      try {
        // Fetch hourly and daily data in parallel
        const [hourlyData, dailyData] = await Promise.all([
          fetchCarrierTimeSeries(modelId, { aggregate: 'hourly' }),
          fetchCarrierTimeSeries(modelId, { aggregate: 'daily' })
        ]);

        if (hourlyData) {
          setCarrierProd(hourlyData.carrier_prod || []);
          setCarrierCon(hourlyData.carrier_con || []);
        }
        
        if (dailyData) {
          setDailyProd(dailyData.carrier_prod || []);
          setDailyCon(dailyData.carrier_con || []);
        } else if (hourlyData) {
          // Fallback if daily endpoint fails
          setDailyProd(hourlyData.carrier_prod || []);
          setDailyCon(hourlyData.carrier_con || []);
        }
      } catch (err) {
        console.error('Failed to load carrier time series:', err);
      } finally {
        setCarrierLoading(false);
        setCarrierLoaded(true);
      }
    };

    loadCarrierData();
  }, [modelId, carrierLoaded, structuredResults]);
  
  if (!structuredResults) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <LineChart className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t('results.energy.noData')}</p>
        </div>
      </div>
    );
  }

  if (carrierLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">{t('results.energy.loadingTimeSeries', 'Loading energy time series...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <LineChart className="w-4 h-4 text-primary" />
          {t('results.energy.dailyEnergyBalance')}
          <DailyEnergyBalanceTooltip />
        </h3>
        <ErrorBoundary label="Energy Balance Chart">
          <EnergyBalanceChart
            production={dailyProd}
            consumption={dailyCon}
            height={320}
          />
        </ErrorBoundary>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Sun className="w-4 h-4 text-primary" />
          {t('results.energy.hourlyRenewableGeneration', 'Hourly renewable generation')}
          <HourlyRenewableGenerationTooltip />
        </h3>
        <ErrorBoundary label="Renewable Generation Chart">
          <HourlyRenewableGenerationChart
            production={carrierProd}
            height={340}
          />
        </ErrorBoundary>
      </div>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            {t('results.energy.dailyLoadProfile')}
            <DailyLoadProfileTooltip />
          </h3>
          <ErrorBoundary label="Daily Load Profile">
            <DailyLoadProfile
              consumption={carrierCon}
              height={280}
              title=""
            />
          </ErrorBoundary>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            {t('results.energy.generationDurationCurve', 'Generation duration curve')}
            <GenerationDurationTooltip />
          </h3>
          <ErrorBoundary label="Generation Duration Curve">
            <LoadDurationCurve
              production={carrierProd}
              height={280}
              title=""
            />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default EnergyPanel;
