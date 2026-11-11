import { useState, useEffect, useMemo, useCallback } from 'react';
import { LineChart, Info, Flame, Clock, Snowflake, GitMerge } from 'lucide-react';
import { PanelEmptyState, PanelLoadingState, CHART_CARD_CLASS } from '../ui/PanelStates';
import { StructuredModelResults, CarrierProdRecord, CarrierConRecord } from '../../types';
import { carrierDisplay, carrierLabelKey, isGenerationCarrier, sameCarrier } from '../../carrierUnits';
import { fetchCarrierTimeSeries } from '../../api';
import { EnergyBalanceChart } from '@/features/simulation-charts/model-results';
import { combineCarriers, systemFlowLabel, systemFlows } from '../../buildingFlows';
import { BuildingProfileChart, firstSeason, type Season } from './BuildingProfileChart';
import { BuildingSankey, Toggle } from './BuildingDetailPanel';
import { useSystemFlows } from '../../hooks/useSystemFlows';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import { ViewTabs } from '../ui/ViewTabs';
import { useTranslation } from '@spatialhub/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { resultFill } from '@/constants/tech-colors';
import { useIsDarkMode } from '@/features/simulation-charts/pypsa/chartUtils';

interface InfoTipItem {
  color: string;
  labelKey: string;
  descKey: string;
}

/** Hover/click info button shared by the energy cards. */
const InfoTip = ({ titleKey, descKey, items }: { titleKey: string; descKey: string; items: InfoTipItem[] }) => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-flex ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
        aria-label={t(titleKey)}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t(titleKey)}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{t(descKey)}</div>

            <div className="space-y-2 text-xs">
              {items.map((item) => (
                <div key={item.labelKey} className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: item.color }} />
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{t(item.labelKey)}</span>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t(item.descKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Legend of the daily balance; consumption takes the carrier's demand colour, as in the chart. */
const energyBalanceItems = (carrier: string, dark: boolean): InfoTipItem[] => [
  { color: '#22c55e', labelKey: 'results.energy.production', descKey: 'results.energy.productionDesc' },
  { color: resultFill('demand', dark, carrier || 'power') ?? '#ef4444', labelKey: 'results.energy.consumption', descKey: 'results.energy.consumptionDesc' },
];

interface EnergyPanelProps {
  structuredResults: StructuredModelResults | null;
  modelId: number | null;
  carrier?: string;
  /** Carriers drawn together in one set of charts, such as heat and cooling; defaults to `carrier`. */
  carriers?: string[];
  /** Every carrier of the run, for the energy flow across carriers. */
  runCarriers: string[];
}

type EnergyView = 'flow' | 'balance' | 'typical';

/** Model-wide energy flow over the run, across every carrier. */
const EnergyFlowView = ({ modelId, carriers }: { modelId: number | null; carriers: string[] }) => {
  const { t } = useTranslation();
  const { results, loading } = useSystemFlows(modelId, carriers);
  if (loading) return <PanelLoadingState label={t('results.energy.loadingTimeSeries', 'Loading energy time series...')} />;
  if (results.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-xs font-normal text-muted-foreground">{t('results.energy.allBuildings', 'all buildings')}</span>
        <ChartInfoTooltip
          title={t('results.charts.energyFlow')}
          description={t('results.overview.sankeyInfo', "Energy over the run, summed over all buildings, from the model's flows. Solar PV and grid import feed the Electricity hub, which supplies every direct use of electricity. Heat pumps and air conditioners turn electricity into heat and cooling. Their output is larger than their electricity input because of their efficiency: output = electricity in × efficiency (COP for heating, EER for cooling). Each of these nodes shows its electricity input and its output ÷ input over the run. The battery stores energy rather than supplying it, so it appears only as its losses: energy charged minus energy discharged. Where a carrier has several supplies, each hour's supplies are shared over that hour's uses in proportion to their size.")}
        />
      </h3>
      <div className="h-[520px]">
        <BuildingSankey results={results} t={t} label={systemFlowLabel} compact />
      </div>
    </div>
  );
};

/** Each record with its carrier set, so carriers fetched separately stay apart once joined. */
const stamp = <T extends { carrier: string }>(rows: T[] | undefined, carrier: string): T[] =>
  (rows ?? []).map((r) => ({ ...r, carrier: r.carrier || carrier }));

const EnergyPanel = ({ structuredResults, modelId, carrier = '', carriers: carrierList, runCarriers }: EnergyPanelProps) => {
  const { t } = useTranslation();
  const dark = useIsDarkMode();
  const [carrierProd, setCarrierProd] = useState<CarrierProdRecord[]>([]);
  const [carrierCon, setCarrierCon] = useState<CarrierConRecord[]>([]);
  const [dailyProd, setDailyProd] = useState<CarrierProdRecord[]>([]);
  const [dailyCon, setDailyCon] = useState<CarrierConRecord[]>([]);
  const [carrierLoading, setCarrierLoading] = useState(false);
  const [carrierLoaded, setCarrierLoaded] = useState(false);
  const [loadedCarrier, setLoadedCarrier] = useState('');

  // Carrier label for card headings and tooltip copy. Unknown carriers fall
  // back to their raw label, never to "Electricity".
  const carrierLabel = useMemo(() => {
    const key = carrierLabelKey(carrier);
    return key ? t(key) : carrier;
  }, [carrier, t]);

  const generation = isGenerationCarrier(carrier);
  const [chosenSeason, setSeason] = useState<Season | null>(null);
  const [view, setView] = useState<EnergyView>('flow');
  // Keyed on the joined names, so a new array with the same carriers does not reload.
  const loadKey = (carrierList ?? [carrier]).join(',');
  const carriers = useMemo(() => loadKey.split(','), [loadKey]);
  const system = useMemo(() => {
    if (carriers.length === 1) return systemFlows(carrierProd, carrierCon, carrier || 'power');
    return combineCarriers(carriers.map((c) => ({
      carrier: c,
      ...systemFlows(carrierProd.filter((r) => sameCarrier(r.carrier, c)), carrierCon.filter((r) => sameCarrier(r.carrier, c)), c),
    })));
  }, [carrierProd, carrierCon, carrier, carriers]);
  const label = useCallback((key: string) => systemFlowLabel(key, carrier || 'power', t), [carrier, t]);
  const { energyUnit } = carrierDisplay(carrier);

  // Lazy-load carrier time-series data when this panel is first rendered.
  // Re-fetches when the active carrier changes ('' = backend default "power").
  useEffect(() => {
    if (!modelId) return;
    if (carrierLoaded && loadedCarrier === loadKey) return;

    // Small models embed the series in the structured response. Only reuse it
    // when it actually holds records for the ACTIVE carrier — reusing it across
    // a carrier switch would relabel electricity as heat.
    const embeddedProd = structuredResults?.carrier_prod ?? [];
    const embeddedCon = structuredResults?.carrier_con ?? [];
    const embeddedMatches = [...embeddedProd, ...embeddedCon].some((record) =>
      sameCarrier(record.carrier, carrier),
    );

    if (embeddedMatches && carriers.length === 1) {
      setCarrierProd(embeddedProd);
      setCarrierCon(embeddedCon);
      setDailyProd(embeddedProd);
      setDailyCon(embeddedCon);
      setCarrierLoaded(true);
      setLoadedCarrier(loadKey);
      return;
    }

    const loadCarrierData = async () => {
      setCarrierLoading(true);
      try {
        const series = await Promise.all(carriers.map(async (c) => {
          const [hourly, daily] = await Promise.all([
            fetchCarrierTimeSeries(modelId, { aggregate: 'hourly', carrier: c }),
            fetchCarrierTimeSeries(modelId, { aggregate: 'daily', carrier: c }),
          ]);
          // The hourly series stands in when the daily endpoint fails.
          return { c, hourly, daily: daily ?? hourly };
        }));

        setCarrierProd(series.flatMap(({ c, hourly }) => stamp(hourly?.carrier_prod, c)));
        setCarrierCon(series.flatMap(({ c, hourly }) => stamp(hourly?.carrier_con, c)));
        setDailyProd(series.flatMap(({ c, daily }) => stamp(daily?.carrier_prod, c)));
        setDailyCon(series.flatMap(({ c, daily }) => stamp(daily?.carrier_con, c)));
        setCarrierLoaded(true);
        setLoadedCarrier(loadKey);
      } catch (err) {
        console.error('Failed to load carrier time series:', err);
        setCarrierLoaded(true);
        setLoadedCarrier(loadKey);
      } finally {
        setCarrierLoading(false);
      }
    };

    loadCarrierData();
  }, [modelId, carrierLoaded, loadedCarrier, carrier, carriers, loadKey, structuredResults]);

  if (!structuredResults) {
    return <PanelEmptyState icon={LineChart} title={t('results.energy.noData')} />;
  }

  if (carrierLoading) {
    return <PanelLoadingState label={t('results.energy.loadingTimeSeries', 'Loading energy time series...')} />;
  }

  const balanceIcon = generation
    ? <LineChart className="h-4 w-4 text-primary" />
    : sameCarrier(carrier, 'cooling') ? <Snowflake className="h-4 w-4 text-cyan-500" /> : <Flame className="h-4 w-4 text-orange-500" />;
  const views = [
    { id: 'flow' as const, icon: <GitMerge className="h-4 w-4 text-primary" />, name: t('results.charts.energyFlow'), kind: t('results.energy.flowKind', 'Sankey diagram, run total') },
    { id: 'balance' as const, icon: balanceIcon, name: t('results.energy.dailyEnergyBalance'), kind: t('results.energy.balanceKind', 'Bar chart, one bar per day') },
    ...(system.flows.length > 0
      ? [{ id: 'typical' as const, icon: <Clock className="h-4 w-4 text-primary" />, name: t('results.energy.typicalDay', 'Typical day'), kind: t('results.energy.typicalKind', 'Hourly profile, average day') }]
      : []),
  ];
  const active = views.some((v) => v.id === view) ? view : 'flow';
  const season = chosenSeason ?? firstSeason(system.timesteps);

  return (
    <div className="md-stagger p-4">
      <div className={CHART_CARD_CLASS}>
        <ViewTabs views={views} value={active} onChange={setView} />
        {active === 'flow' && <EnergyFlowView modelId={modelId} carriers={runCarriers} />}
        {active === 'balance' && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="text-xs font-normal text-muted-foreground">{carrierLabel} · {energyUnit}</span>
              <InfoTip
                titleKey="results.energy.dailyEnergyBalance"
                descKey={generation ? 'results.energy.dailyEnergyBalanceDesc' : 'results.energy.dailyEnergyBalanceDescHeat'}
                items={energyBalanceItems(carrier, dark)}
              />
            </h3>
            <ErrorBoundary label="Energy Balance Chart">
              <EnergyBalanceChart
                production={dailyProd}
                consumption={dailyCon}
                carrier={carrier}
                height={320}
              />
            </ErrorBoundary>
          </div>
        )}

        {active === 'typical' && (
          <div>
            <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
              <span className="text-xs font-normal text-muted-foreground">{t('results.energy.allBuildings', 'all buildings')}</span>
              <ChartInfoTooltip
                title={t('results.energy.typicalDay', 'Typical day')}
                description={t('results.energy.typicalDayInfo', 'Average power per hour of the day over the chosen months, summed over all buildings. Supplies above zero, uses below; the tallest bar below zero is when demand peaks.')}
              />
              <div className="ml-auto">
                <Toggle
                  options={[['winter', t('results.buildingDetail.winter', 'Winter')], ['summer', t('results.buildingDetail.summer', 'Summer')], ['year', t('results.buildingDetail.wholeYear', 'Whole year')]]}
                  value={season}
                  onChange={setSeason}
                />
              </div>
            </h3>
            <div className="h-[340px]">
              <BuildingProfileChart timesteps={system.timesteps} flows={system.flows} carrier={carrier || 'power'} label={label} resolution="typical" season={season}
                emptyText={t('results.energy.noHoursInSeason', 'No hour of this run falls in these months.')} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EnergyPanel;
