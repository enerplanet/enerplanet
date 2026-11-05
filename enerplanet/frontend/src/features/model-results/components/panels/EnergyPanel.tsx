import { useState, useEffect, useMemo } from 'react';
import { LineChart, Info, Flame } from 'lucide-react';
import { PanelEmptyState, PanelLoadingState, CHART_CARD_CLASS } from '../ui/PanelStates';
import { StructuredModelResults, CarrierProdRecord, CarrierConRecord } from '../../types';
import {
  carrierDisplay,
  carrierLabelKey,
  isGenerationCarrier,
  sameCarrier,
} from '../../carrierUnits';
import { fetchCarrierTimeSeries } from '../../api';
import {
  EnergyBalanceChart,
} from '@/features/simulation-charts/model-results';
import { useTranslation } from '@spatialhub/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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
    <div className="relative inline-block ml-1">
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
                  <span className={`w-2 h-2 rounded-full ${item.color} flex-shrink-0 mt-1`} />
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

const ENERGY_BALANCE_ITEMS: InfoTipItem[] = [
  { color: 'bg-green-500', labelKey: 'results.energy.production', descKey: 'results.energy.productionDesc' },
  { color: 'bg-red-500', labelKey: 'results.energy.consumption', descKey: 'results.energy.consumptionDesc' },
];

interface EnergyPanelProps {
  structuredResults: StructuredModelResults | null;
  modelId: number | null;
  carrier?: string;
}

const EnergyPanel = ({ structuredResults, modelId, carrier = '' }: EnergyPanelProps) => {
  const { t } = useTranslation();
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
  const { energyUnit } = carrierDisplay(carrier);

  // Lazy-load carrier time-series data when this panel is first rendered.
  // Re-fetches when the active carrier changes ('' = backend default "power").
  useEffect(() => {
    if (!modelId) return;
    if (carrierLoaded && loadedCarrier === carrier) return;

    // Small models embed the series in the structured response. Only reuse it
    // when it actually holds records for the ACTIVE carrier — reusing it across
    // a carrier switch would relabel electricity as heat.
    const embeddedProd = structuredResults?.carrier_prod ?? [];
    const embeddedCon = structuredResults?.carrier_con ?? [];
    const embeddedMatches = [...embeddedProd, ...embeddedCon].some((record) =>
      sameCarrier(record.carrier, carrier),
    );

    if (embeddedMatches) {
      setDailyProd(embeddedProd);
      setDailyCon(embeddedCon);
      setCarrierLoaded(true);
      setLoadedCarrier(carrier);
      return;
    }

    const loadCarrierData = async () => {
      setCarrierLoading(true);
      try {
        const dailyData = await fetchCarrierTimeSeries(modelId, { aggregate: 'daily', carrier });
        if (dailyData) {
          setDailyProd(dailyData.carrier_prod || []);
          setDailyCon(dailyData.carrier_con || []);
        }

        setCarrierLoaded(true);
        setLoadedCarrier(carrier);
      } catch (err) {
        console.error('Failed to load carrier time series:', err);
        setCarrierLoaded(true);
        setLoadedCarrier(carrier);
      } finally {
        setCarrierLoading(false);
      }
    };

    loadCarrierData();
  }, [modelId, carrierLoaded, loadedCarrier, carrier, structuredResults]);

  if (!structuredResults) {
    return <PanelEmptyState icon={LineChart} title={t('results.energy.noData')} />;
  }

  if (carrierLoading) {
    return <PanelLoadingState label={t('results.energy.loadingTimeSeries', 'Loading energy time series...')} />;
  }

  return (
    <div className="md-stagger p-4 space-y-4">
      <div className={CHART_CARD_CLASS}>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          {generation ? (
            <LineChart className="w-4 h-4 text-primary" />
          ) : (
            <Flame className="w-4 h-4 text-orange-500" />
          )}
          {t('results.energy.dailyEnergyBalance')}
          <span className="text-xs font-normal text-muted-foreground">{carrierLabel} · {energyUnit}</span>
          <InfoTip
            titleKey="results.energy.dailyEnergyBalance"
            descKey={generation ? 'results.energy.dailyEnergyBalanceDesc' : 'results.energy.dailyEnergyBalanceDescHeat'}
            items={ENERGY_BALANCE_ITEMS}
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
    </div>
  );
};

export default EnergyPanel;
