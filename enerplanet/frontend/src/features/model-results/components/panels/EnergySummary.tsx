import { useLayoutEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { formatCurrency, formatNumber } from '@/utils/formatNumber';
import { CHART_CARD_CLASS } from '../ui/PanelStates';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import { carrierDisplay, formatCarrierEnergy } from '../../carrierUnits';
import { selfSufficiency, systemFlowLabel, type BuildingFlow } from '../../buildingFlows';

type TileData = { label: string; value: string; sub: string; info: string };

/** One headline figure in the energy summary. */
const Tile = ({ label, value, sub, info }: TileData) => (
  <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2.5">
    <div className="flex items-center text-xs text-muted-foreground">
      <span className="truncate">{label}</span>
      <ChartInfoTooltip title={label} description={info} />
    </div>
    <div className="whitespace-nowrap text-xl font-semibold tabular-nums text-foreground">{value}</div>
    <div className="truncate text-xs text-muted-foreground">{sub}</div>
  </div>
);

/** Dark text on light fills, white on dark ones. */
const textOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? 'text-gray-900' : 'text-white';
};

const SHORT_LABELS: Record<string, [string, string]> = {
  pv_supply: ['results.energy.short.pv', 'Solar PV'],
  batteryOut: ['results.energy.short.batteryOut', 'Battery out'],
  lineIn: ['results.energy.short.gridImport', 'Grid import'],
  air_source_heat_pump: ['results.energy.short.heatPump', 'Heat pump'],
  demand: ['results.energy.short.appliances', 'Appliances'],
  batteryIn: ['results.energy.short.batteryIn', 'Battery in'],
  lineOut: ['results.energy.short.export', 'Export'],
};

/** Power with one decimal, switching to MW from 1,000 kW. */
const formatPower1 = (kw: number, unit: string) =>
  kw >= 1_000 ? `${formatNumber(kw / 1_000, 1)} MW` : `${formatNumber(kw, 1)} ${unit}`;

/** Bar segment showing its share when the text fits, blank when it does not. */
const Segment = ({ text, label, share, color, active, onActivate, onRelease, onToggle }: {
  text: string; label: string; share: number; color: string; active: boolean;
  onActivate: () => void; onRelease: () => void; onToggle: () => void;
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = el.querySelector<HTMLElement>('[data-measure]')!;
    // 16 px is the segment's horizontal padding (px-2).
    const fit = () => setFits(measure.offsetWidth + 16 <= el.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onMouseEnter={onActivate}
      onMouseLeave={onRelease}
      onBlur={onRelease}
      onClick={onToggle}
      style={{ width: `${share * 100}%`, backgroundColor: color }}
      className={`relative flex items-center overflow-hidden whitespace-nowrap px-2 text-xs tabular-nums ${textOn(color)} ${active ? 'brightness-110' : ''}`}
    >
      <span data-measure className="invisible absolute">{text}</span>
      {fits ? text : ''}
    </button>
  );
};

/**
 * One stacked bar with its own legend; segment widths are shares of the balanced total.
 * The legend uses short names and one decimal; hovering or tapping shows the full name, two decimals and the peak.
 */
const FlowBar = ({ title, flows, total, carrier, label, shortLabel }: {
  title: string; flows: BuildingFlow[]; total: number; carrier: string;
  label: (key: string) => string; shortLabel: (key: string) => string;
}) => {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const { powerUnit } = carrierDisplay(carrier);
  const share = (f: BuildingFlow) => f.totalKwh / total;
  const percent = (f: BuildingFlow) => `${formatNumber(share(f) * 100, 1)}%`;
  const energy = (f: BuildingFlow) => formatCarrierEnergy(f.totalKwh, carrier);

  const index = flows.findIndex((f) => f.key === active);
  const selected = flows[index];
  const start = flows.slice(0, index).reduce((sum, f) => sum + share(f), 0);
  const centre = selected ? (start + share(selected) / 2) * 100 : 0;
  const shift = centre < 20 ? '0%' : centre > 80 ? '-100%' : '-50%';

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-16 shrink-0 items-center text-xs text-muted-foreground">{title}</div>
      <div className="min-w-0 flex-1">
        <div className="relative">
          <div className="flex h-8 overflow-hidden rounded-md">
            {flows.map((f) => (
              <Segment
                key={f.key}
                text={percent(f)}
                label={`${label(f.key)} ${energy(f)} · ${percent(f)}`}
                share={share(f)}
                color={f.color}
                active={f.key === active}
                onActivate={() => setActive(f.key)}
                onRelease={() => setActive(null)}
                onToggle={() => setActive((k) => (k === f.key ? null : f.key))}
              />
            ))}
          </div>
          {selected && (
            <div
              role="tooltip"
              style={{ left: `${centre}%`, transform: `translateX(${shift})` }}
              className="pointer-events-none absolute bottom-full z-50 mb-1.5 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
            >
              <div className="font-medium">{label(selected.key)}</div>
              <div className="tabular-nums text-muted-foreground">{energy(selected)} · {percent(selected)}</div>
              <div className="tabular-nums text-muted-foreground">{t('results.energy.peak', 'peak')} {formatPower1(selected.peakKw, powerUnit)}</div>
            </div>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {flows.map((f) => (
            <span key={f.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: f.color }} />
              {shortLabel(f.key)}
              <span className="tabular-nums text-foreground">{formatCarrierEnergy(f.totalKwh, carrier, 1)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

interface EnergySummaryProps {
  flows: BuildingFlow[];
  carrier: string;
  /** Hours in the run, to scale the net energy cost to a year. */
  hours: number;
  gridPrices?: { import_ct_per_kwh: number; export_ct_per_kwh: number };
  /** Equipment and fuel cost over the run (plan runs); when set, the cost tile shows the total annualised cost. */
  equipmentCost?: number;
}

/** Totals of every supply and use over the run, summed over all buildings. */
const EnergySummary = ({ flows, carrier, hours, gridPrices, equipmentCost }: EnergySummaryProps) => {
  const { t } = useTranslation();
  if (flows.length === 0) return null;
  const label = (key: string) => systemFlowLabel(key, carrier || 'power', t);
  const shortLabel = (key: string) => (SHORT_LABELS[key] ? t(...SHORT_LABELS[key]) : label(key));

  const find = (key: string) => flows.find((f) => f.key === key);
  const total = (key: string) => find(key)?.totalKwh ?? 0;
  const energy = (kwh: number) => formatCarrierEnergy(kwh, carrier, 1);
  const { powerUnit } = carrierDisplay(carrier);
  const supplies = flows.filter((f) => f.side === 'supply');
  // Technologies (heat pump) before appliances, so the bar reads converters, demand, battery, grid.
  const usesLast = ['demand', 'batteryIn', 'lineOut'];
  const uses = [
    ...flows.filter((f) => f.side === 'use' && !usesLast.includes(f.key)),
    ...usesLast.map(find).filter((f): f is BuildingFlow => f?.side === 'use'),
  ];
  const balanced = supplies.reduce((sum, f) => sum + f.totalKwh, 0);
  const onSite = uses.filter((f) => f.key !== 'lineOut' && f.key !== 'batteryIn').reduce((sum, f) => sum + f.totalKwh, 0);
  const pv = total('pv_supply');
  const sufficiency = selfSufficiency(flows);
  const gridIn = find('lineIn');

  const tiles: TileData[] = [];
  if (pv > 0 && sufficiency !== null) tiles.push({
    label: t('results.energy.selfSufficiencyLabel', 'Self-sufficiency'),
    value: `${formatNumber(sufficiency * 100, 1)}%`,
    sub: t('results.energy.ofUsed', 'of {{energy}} used', { energy: energy(onSite) }),
    info: t('results.metrics.selfSufficiencyDesc', 'PV generation minus grid export, divided by local consumption (Luthander et al., 2015)'),
  });
  if (pv > 0) tiles.push({
    label: t('results.energy.pvOnSite', 'PV used on site'),
    value: `${formatNumber(Math.max(0, 1 - total('lineOut') / pv) * 100, 1)}%`,
    sub: t('results.energy.exported', '{{energy}} exported', { energy: energy(total('lineOut')) }),
    info: t('results.energy.pvOnSiteInfo', 'Share of PV generation that is not exported to the grid.'),
  });
  if (gridIn) tiles.push({
    label: t('results.energy.peakGridImport', 'Peak grid import'),
    value: formatPower1(gridIn.peakKw, powerUnit),
    sub: t('results.energy.imported', '{{energy}} imported', { energy: energy(gridIn.totalKwh) }),
    info: t('results.energy.peakGridImportInfo', 'Highest hourly power drawn from the grid at the transformer over the run.'),
  });
  if (gridIn && gridPrices && hours > 0) {
    const perYear = 8760 / hours;
    const bought = (gridIn.totalKwh * gridPrices.import_ct_per_kwh / 100) * perYear;
    const sold = (total('lineOut') * gridPrices.export_ct_per_kwh / 100) * perYear;
    const values = {
      bought: formatCurrency(bought, 0), sold: formatCurrency(sold, 0),
      imp: formatNumber(gridPrices.import_ct_per_kwh, 1), exp: formatNumber(gridPrices.export_ct_per_kwh, 1),
    };
    const perYearText = t('results.energy.perYear', 'per year');
    if (equipmentCost == null) tiles.push({
      label: t('results.energy.netEnergyCost', 'Net energy cost'),
      value: formatCurrency(bought - sold, 0),
      sub: perYearText,
      info: t('results.energy.netEnergyCostInfo', '{{bought}} of grid electricity bought at {{imp}} ct/kWh, minus {{sold}} earned on export at {{exp}} ct/kWh, scaled to one year. Equipment cost is on the Cost tab.', values),
    });
    else {
      const equipment = equipmentCost * perYear;
      tiles.push({
        label: t('results.energy.totalAnnualisedCost', 'Total annualised cost'),
        value: formatCurrency(equipment + bought - sold, 0),
        sub: perYearText,
        info: t('results.energy.totalAnnualisedCostInfo', '{{investment}} annualised investment in the installed equipment, including its fixed upkeep and any gas bought, plus {{bought}} of grid electricity bought at {{imp}} ct/kWh, minus {{sold}} earned on export at {{exp}} ct/kWh, scaled to one year.',
          { ...values, investment: formatCurrency(equipment, 0) }),
      });
    }
  }

  return (
    <div className={CHART_CARD_CLASS}>
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Gauge className="h-4 w-4 text-primary" />
        {t('results.energy.electricitySummary', 'Electricity over the run')}
        <span className="text-xs font-normal text-muted-foreground">
          {t('results.energy.allBuildingsBalanced', 'all buildings · {{energy}} balanced', { energy: energy(balanced) })}
        </span>
        <ChartInfoTooltip
          title={t('results.energy.electricitySummary', 'Electricity over the run')}
          description={t('results.energy.summaryInfo', 'Totals over the whole run period, summed over all buildings. Flows on the lines between buildings are left out; grid import and export are at the transformer.')}
        />
      </h3>
      {tiles.length > 0 && <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">{tiles.map((tile) => <Tile key={tile.label} {...tile} />)}</div>}
      <div className="space-y-3">
        <FlowBar title={t('results.energy.supplied', 'Supplied')} flows={supplies} total={balanced} carrier={carrier} label={label} shortLabel={shortLabel} />
        <FlowBar title={t('results.energy.used', 'Used')} flows={uses} total={balanced} carrier={carrier} label={label} shortLabel={shortLabel} />
      </div>
    </div>
  );
};

export default EnergySummary;
