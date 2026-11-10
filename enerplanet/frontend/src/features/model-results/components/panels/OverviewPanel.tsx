import { Sun } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { formatNumber } from '@/utils/formatNumber';
import { PanelLoadingState, CHART_CARD_CLASS } from '../ui/PanelStates';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import EnergySummary from './EnergySummary';
import ThermalSummary from './ThermalSummary';
import { formatCarrierEnergy, HEATING_COOLING } from '../../carrierUnits';
import { useSystemFlows } from '../../hooks/useSystemFlows';
import { flowLabel, installedCapacities, type CarrierResult } from '../../buildingFlows';
import { getTechColor } from '@/constants/tech-colors';
import { useIsDarkMode } from '@/features/simulation-charts/pypsa/chartUtils';
import type { EnergyCapRecord } from '../../types';

type Translate = ReturnType<typeof useTranslation>['t'];
type InstalledRow = ReturnType<typeof installedCapacities>[number];

/** Energy one technology moved over the run on one side, summed over carriers and buildings. */
function flowTotal(results: CarrierResult[], key: string, side: 'supply' | 'use'): number {
  return results.flatMap((r) => r.flows).filter((f) => f.key === key && f.side === side).reduce((sum, f) => sum + f.totalKwh, 0);
}

/** One installed-capacity card: the capacity, then the same two rows for every technology. */
interface CapacitySpec {
  main: string;
  caption: string;
  energyLabel: string;
  energy: string;
  useLabel: string;
  use: string;
  info: string;
}

/**
 * Capacity unit, caption and energy row label by technology. Conversion capacities are on
 * the output side, as Calliope sizes them: heat for heat pumps and boilers, cooling for air conditioners.
 */
function outputKind(family: string, t: Translate) {
  if (family.includes('pv')) return { unit: 'kWp', caption: t('results.overview.peakPower', 'peak power'), energyLabel: t('results.overview.generated', 'Generated') };
  if (/heat_pump|boiler/.test(family)) return { unit: 'kW', caption: t('results.overview.heatOutput', 'heat output'), energyLabel: t('results.overview.heatDelivered', 'Heat delivered') };
  if (family.includes('air_conditioner')) return { unit: 'kW', caption: t('results.overview.coolingOutput', 'cooling output'), energyLabel: t('results.overview.coolingDelivered', 'Cooling delivered') };
  return { unit: 'kW', caption: t('results.overview.ratedPower', 'rated power'), energyLabel: t('results.overview.generated', 'Generated') };
}

/** Converters and generators: energy given out, and full-load hours, that energy over the capacity. */
function capacitySpec(r: InstalledRow, results: CarrierResult[], t: Translate): CapacitySpec {
  if (r.kwh > 0) return batterySpec(r, results, t);
  const { unit, caption, energyLabel } = outputKind(r.family, t);
  const main = `${formatNumber(r.kw, 1)} ${unit}`;
  const delivered = flowTotal(results, r.family, 'supply');
  const values = { label: energyLabel, energy: formatCarrierEnergy(delivered, 'power', 1), capacity: main, hours: formatNumber(delivered / r.kw, 0) };
  return {
    main, caption, energyLabel, energy: values.energy,
    useLabel: t('results.overview.fullLoadHours', 'Full-load hours'),
    use: `${values.hours} h`,
    info: t('results.overview.fullLoadInfo', 'Values cover the run period, summed over all buildings.\n{{label}}: energy this equipment gave out over the run, {{energy}}.\nFull-load hours = {{label}} ÷ capacity = {{energy}} ÷ {{capacity}} = {{hours}} h.', values),
  };
}

/** Batteries: energy discharged, and equivalent full cycles, energy charged over the energy capacity. */
function batterySpec(r: InstalledRow, results: CarrierResult[], t: Translate): CapacitySpec {
  const main = `${formatNumber(r.kwh, 1)} kWh`;
  const charged = flowTotal(results, 'batteryIn', 'use');
  const discharged = flowTotal(results, 'batteryOut', 'supply');
  const values = {
    capacity: main,
    charged: formatCarrierEnergy(charged, 'power', 1),
    discharged: formatCarrierEnergy(discharged, 'power', 1),
    cycles: formatNumber(charged / r.kwh, 0),
    roundTrip: charged > 0 ? `${formatNumber(discharged / charged * 100, 0)}%` : '-',
  };
  return {
    main,
    caption: t('results.overview.batteryPower', 'up to {{power}}', { power: `${formatNumber(r.kw, 1)} kW` }),
    energyLabel: t('results.overview.discharged', 'Discharged'),
    energy: values.discharged,
    useLabel: t('results.overview.fullCycles', 'Full cycles'),
    use: values.cycles,
    info: t('results.overview.batteryInfo', 'Values cover the run period, summed over all buildings.\nDischarged: electricity the batteries gave out over the run, {{discharged}}.\nEnergy cycled: electricity charged into the batteries over the run, {{charged}}.\nFull cycles = energy charged ÷ energy capacity = {{charged}} ÷ {{capacity}} = {{cycles}}.\nRound trip efficiency = energy discharged ÷ energy charged = {{roundTrip}}.', values),
  };
}

/** Label and value on one line of a capacity card. */
function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="whitespace-nowrap tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Installed capacities of the run, one spec card per technology: as configured in
 * operate mode, as chosen by the optimiser in plan mode.
 */
function InstalledCard({ energyCap, mode, results }: { energyCap: EnergyCapRecord[]; mode?: 'plan' | 'operate'; results: CarrierResult[] }) {
  const { t } = useTranslation();
  const dark = useIsDarkMode();
  const rows = installedCapacities(energyCap);
  const buildings = (n: number) => n === 1 ? t('results.overview.oneBuilding', '1 building') : t('results.overview.buildingCount', '{{count}} buildings', { count: n });
  return (
    <div className={CHART_CARD_CLASS}>
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Sun className="h-4 w-4 text-primary" />
        {t('results.overview.installed', 'Installed capacities')}
        <span className="text-xs font-normal text-muted-foreground">{t('results.overview.totalsAcrossBuildings', 'totals across buildings')}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {mode === 'operate' ? t('results.overview.configured', 'Configured') : t('results.overview.optimised', 'Optimised')}
        </span>
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        {rows.map((r) => {
          const spec = capacitySpec(r, results, t);
          const name = flowLabel(r.family, 'power', t);
          return (
            <div key={r.family} className="min-w-0 rounded-lg border border-border/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: getTechColor(r.family, 0, dark) }} />
                <span className="truncate text-muted-foreground">{name}</span>
                <ChartInfoTooltip title={name} description={spec.info} />
                <span className="ml-auto whitespace-nowrap text-muted-foreground">{buildings(r.units)}</span>
              </div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums text-foreground">{spec.main}</div>
              <div className="text-xs text-muted-foreground">{spec.caption}</div>
              <dl className="mt-2 divide-y divide-border/60 border-t border-border/60 text-xs">
                <SpecRow label={spec.energyLabel} value={spec.energy} />
                <SpecRow label={spec.useLabel} value={spec.use} />
              </dl>
            </div>
          );
        })}
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
  /** First and last day of the run, as ISO dates. */
  period?: { from: string; to: string };
  /** Cost the optimiser minimised over the run; shown for plan-mode runs. */
  objective?: number;
}

/** The selected carrier over the run and what is installed, stacked full width. */
const OverviewPanel = ({ modelId, carriers, carrier, gridPrices, energyCap, mode, period, objective }: OverviewPanelProps) => {
  const { t } = useTranslation();
  const { results, loading } = useSystemFlows(modelId, carriers);
  const summary = results.find((r) => r.carrier === (carrier || 'power'));
  const power = results.find((r) => r.carrier === 'power');
  const heatPumpElectricity = power?.flows.filter((f) => f.side === 'use' && f.key.includes('heat_pump')).reduce((sum, f) => sum + f.totalKwh, 0);

  if (loading) {
    return <PanelLoadingState label={t('results.energy.loadingTimeSeries', 'Loading energy time series...')} />;
  }

  return (
    <div className="md-stagger space-y-4 p-4">
      {carrier === HEATING_COOLING
        ? <ThermalSummary results={results} />
        : summary && <EnergySummary flows={summary.flows} carrier={summary.carrier} hours={summary.timesteps.length} period={period} gridPrices={gridPrices}
          objective={mode === 'operate' ? undefined : objective}
          heatPumpElectricityKwh={heatPumpElectricity} />}

      <InstalledCard energyCap={energyCap} mode={mode} results={results} />

    </div>
  );
};

export default OverviewPanel;
