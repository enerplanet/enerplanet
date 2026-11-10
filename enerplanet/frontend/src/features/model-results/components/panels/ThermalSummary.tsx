import { useCallback } from 'react';
import { Thermometer } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { formatNumber } from '@/utils/formatNumber';
import { CHART_CARD_CLASS } from '../ui/PanelStates';
import ChartInfoTooltip from '../ui/ChartInfoTooltip';
import { formatCarrierEnergy } from '../../carrierUnits';
import { flowLabel, thermalDemand, thermalFigures, thermalFlows, type CarrierResult } from '../../buildingFlows';
import { BuildingProfileChart } from './BuildingProfileChart';
import { FlowBar, Tile, type TileData } from './EnergySummary';

/**
 * Heating and cooling of the run as one need, keeping the indoor temperature comfortable:
 * the demand and each part's share, the electricity behind it, the demand per month,
 * and what supplied it. Heat and cooling stay separate carriers in the model; only totals are added.
 */
const ThermalSummary = ({ results }: { results: CarrierResult[] }) => {
  const { t } = useTranslation();
  const label = useCallback((key: string) => flowLabel(key, 'heat', t), [t]);
  const flows = thermalFlows(results);
  if (flows.length === 0) return null;

  const figures = thermalFigures(results);
  const energy = (kwh: number) => formatCarrierEnergy(kwh, 'heat', 1);
  const percent = (share: number | null) => (share === null ? '-' : `${formatNumber(share * 100, 1)}%`);
  const supplies = flows.filter((f) => f.side === 'supply');
  const uses = flows.filter((f) => f.side === 'use');
  const balanced = supplies.reduce((sum, f) => sum + f.totalKwh, 0);
  const demand = thermalDemand(results);

  const tiles: TileData[] = [
    {
      label: t('results.thermal.demand', 'Heating and cooling demand'),
      value: energy(figures.totalKwh),
      sub: t('results.thermal.overRun', 'over the run'),
      info: t('results.thermal.demandInfo', 'Energy needed over the run to keep the buildings at a comfortable temperature: space heating, hot water and cooling, summed over all buildings.'),
    },
    {
      label: t('results.thermal.heatingShare', 'Heating share'),
      value: percent(figures.heatShare),
      sub: t('results.thermal.heatingSub', '{{energy}} space heating and hot water', { energy: energy(figures.heatKwh) }),
      info: t('results.thermal.heatingShareInfo', 'Share of the heating and cooling demand that was space heating and hot water.'),
    },
    {
      label: t('results.thermal.coolingShare', 'Cooling share'),
      value: percent(figures.coolingShare),
      sub: t('results.thermal.coolingSub', '{{energy}} cooling', { energy: energy(figures.coolingKwh) }),
      info: t('results.thermal.coolingShareInfo', 'Share of the heating and cooling demand that was cooling.'),
    },
  ];
  if (figures.electricityKwh > 0) tiles.push({
    label: t('results.thermal.electricity', 'Electricity used'),
    value: formatCarrierEnergy(figures.electricityKwh, 'power', 1),
    sub: t('results.thermal.electricitySub', 'by heat pumps and air conditioners'),
    info: t('results.thermal.electricityInfo', 'Electricity the heating and cooling equipment drew over the run. The rest of the heat and cooling came from the outside air or ground at no cost.'),
  });

  const title = t('results.thermal.title', 'Heating and cooling over the run');
  return (
    <div className={CHART_CARD_CLASS}>
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <Thermometer className="h-4 w-4 text-primary" />
        {title}
        <span className="text-xs font-normal text-muted-foreground">
          {t('results.energy.allBuildingsBalanced', 'all buildings · {{energy}} balanced', { energy: energy(balanced) })}
        </span>
        <ChartInfoTooltip title={title} description={t('results.thermal.info', 'Heating and cooling totals over the run, summed over all buildings. Heat and cooling are separate in the model: heat cannot meet a cooling demand, so each is supplied by its own equipment.')} />
      </h3>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">{tiles.map((tile) => <Tile key={tile.label} {...tile} />)}</div>
      <div className="mb-4 h-[220px]">
        <BuildingProfileChart timesteps={demand.timesteps} flows={demand.flows} carrier="heat" label={label} resolution="monthly" season="year"
          emptyText={t('results.thermal.noDemand', 'No heating or cooling demand in this run.')} />
      </div>
      <div className="space-y-3">
        <FlowBar title={t('results.energy.supplied', 'Supplied')} flows={supplies} total={balanced} carrier="heat" label={label} shortLabel={label} />
        <FlowBar title={t('results.energy.used', 'Used')} flows={uses} total={balanced} carrier="heat" label={label} shortLabel={label} />
      </div>
    </div>
  );
};

export default ThermalSummary;
