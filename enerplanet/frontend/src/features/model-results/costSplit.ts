import { getTechGroup } from '@/features/configurator/utils/transformUtils';

export type InvestmentRow = { tech: string; label: string; investment: number; variable: number };

const GRID_PURCHASE = new Set(['transformer_supply', 'grid_trafo_import']);
const HEATING_COOLING = /heat_pump|boiler|air_conditioner/;
const END_USE = /_demand$/;

/**
 * Splits the grid purchase row by each use's share of the electricity used:
 * heating and cooling devices versus the buildings' other demand. Battery
 * charging, export and lines are not end uses and are left out of the shares.
 */
export function splitGridPurchase(
  rows: InvestmentRow[],
  consumption: Array<{ techs: string; total: number }> | undefined,
  t: (key: string) => string,
): InvestmentRow[] {
  let heating = 0;
  let other = 0;
  consumption?.forEach(c => {
    if (HEATING_COOLING.test(c.techs)) heating += c.total;
    else if (END_USE.test(c.techs)) other += c.total;
  });
  const share = heating + other > 0 ? heating / (heating + other) : 0;
  if (share === 0) return rows;

  return rows.flatMap(row => {
    if (!GRID_PURCHASE.has(getTechGroup(row.tech))) return [row];
    return [
      { ...row, tech: `${row.tech}:heating`, label: t('results.chartLabels.gridForHeating'), variable: row.variable * share },
      { ...row, tech: `${row.tech}:other`, label: t('results.chartLabels.gridForOtherUse'), investment: 0, variable: row.variable * (1 - share) },
    ];
  });
}
