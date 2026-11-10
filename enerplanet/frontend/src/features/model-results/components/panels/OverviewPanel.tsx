import { GitMerge, Sun } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { formatNumber } from '@/utils/formatNumber';
import { PanelLoadingState, CHART_CARD_CLASS } from '../ui/PanelStates';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import EnergySummary from './EnergySummary';
import ThermalSummary from './ThermalSummary';
import { HEATING_COOLING } from '../../carrierUnits';
import { BuildingSankey } from './BuildingDetailPanel';
import { useSystemFlows } from '../../hooks/useSystemFlows';
import { flowLabel, installedCapacities, systemFlowLabel } from '../../buildingFlows';
import type { EnergyCapRecord } from '../../types';

/**
 * Installed capacities of the run, one light tile per technology: as configured in
 * operate mode, as chosen by the optimiser in plan mode.
 */
function InstalledCard({ energyCap, mode, roundTrip }: { energyCap: EnergyCapRecord[]; mode?: 'plan' | 'operate'; roundTrip?: number }) {
  const { t } = useTranslation();
  const rows = installedCapacities(energyCap);
  const value = (r: ReturnType<typeof installedCapacities>[number]) =>
    r.family.includes('pv') ? `${formatNumber(r.kw, 1)} kWp`
      : r.kwh > 0 ? `${formatNumber(r.kw, 1)} kW · ${formatNumber(r.kwh, 1)} kWh`
        : `${formatNumber(r.kw, 1)} kW`;
  const buildings = (n: number) => n === 1 ? t('results.overview.oneBuilding', '1 building') : t('results.overview.buildingCount', '{{count}} buildings', { count: n });
  return (
    <div className={CHART_CARD_CLASS}>
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Sun className="h-4 w-4 text-primary" />
        {t('results.overview.installed', 'Installed capacities')}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {mode === 'operate' ? t('results.overview.configured', 'Configured') : t('results.overview.optimised', 'Optimised')}
        </span>
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        {rows.map((r) => (
          <div key={r.family} className="min-w-0 rounded-lg border border-border/60 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{flowLabel(r.family, 'power', t)}</span>
              <span className="whitespace-nowrap text-muted-foreground">{buildings(r.units)}</span>
            </div>
            <div className="whitespace-nowrap text-sm font-medium tabular-nums text-foreground">
              {value(r)} <span className="text-xs font-normal text-muted-foreground">{t('results.overview.total', 'total')}</span>
            </div>
            {r.kwh > 0 && roundTrip != null && (
              <div className="text-xs text-muted-foreground">{t('results.overview.roundTripLine', '{{value}} round trip', { value: `${formatNumber(roundTrip * 100, 1)}%` })}</div>
            )}
          </div>
        ))}
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">{t('results.overview.nothingInstalled', 'No equipment installed.')}</p>}
    </div>
  );
}

interface OverviewPanelProps {
  modelId: number | null;
  carriers: string[];
  /** Carrier picked in the results toggle; '' is electricity. */
  carrier: string;
  gridPrices?: { import_ct_per_kwh: number; export_ct_per_kwh: number };
  energyCap: EnergyCapRecord[];
  mode?: 'plan' | 'operate';
}

/** The selected carrier over the run, what is installed, and the model-wide energy flow, stacked full width. */
const OverviewPanel = ({ modelId, carriers, carrier, gridPrices, energyCap, mode }: OverviewPanelProps) => {
  const { t } = useTranslation();
  const { results, loading } = useSystemFlows(modelId, carriers);
  const summary = results.find((r) => r.carrier === (carrier || 'power'));
  const power = results.find((r) => r.carrier === 'power');
  const battery = (key: string) => power?.flows.find((f) => f.key === key)?.totalKwh ?? 0;
  const heatPumpElectricity = power?.flows.filter((f) => f.side === 'use' && f.key.includes('heat_pump')).reduce((sum, f) => sum + f.totalKwh, 0);
  const roundTrip = battery('batteryIn') > 0 ? battery('batteryOut') / battery('batteryIn') : undefined;

  if (loading) {
    return <PanelLoadingState label={t('results.energy.loadingTimeSeries', 'Loading energy time series...')} />;
  }

  return (
    <div className="md-stagger space-y-4 p-4">
      {carrier === HEATING_COOLING
        ? <ThermalSummary results={results} />
        : summary && <EnergySummary flows={summary.flows} carrier={summary.carrier} hours={summary.timesteps.length} gridPrices={gridPrices}
          heatPumpElectricityKwh={heatPumpElectricity} />}

      <InstalledCard energyCap={energyCap} mode={mode} roundTrip={roundTrip} />

      {results.length > 0 && (
        <div className={CHART_CARD_CLASS}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitMerge className="h-4 w-4 text-primary" />
            {t('results.charts.energyFlow')}
            <span className="text-xs font-normal text-muted-foreground">{t('results.energy.allBuildings', 'all buildings')}</span>
            <ChartInfoTooltip
              title={t('results.charts.energyFlow')}
              description={t('results.overview.sankeyInfo', "Each hour, the energy supplied is shared over that hour's uses in proportion to their size, then summed over the run and over all buildings. The run reports totals per technology, so the split between sources is an estimate. Ambient heat is what the heat pumps take from the air or ground: their heat output minus their electricity input. Conversion losses are what the boilers lose: their fuel input minus their heat output.")}
            />
          </h3>
          <div className="h-[520px]">
            <BuildingSankey results={results} t={t} label={systemFlowLabel} compact />
          </div>
        </div>
      )}
    </div>
  );
};

export default OverviewPanel;
