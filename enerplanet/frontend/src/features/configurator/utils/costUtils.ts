import { StructuredModelResults } from '@/features/model-results/types';
import { i18n } from '@spatialhub/i18n';
import { getTechColor } from '@/constants/tech-colors';

const COST_TECH_I18N_KEYS: Record<string, string> = {
  pv_supply: 'results.techNames.solarPv',
  wind_supply: 'results.techNames.wind',
  wind_onshore: 'results.techNames.windOnshore',
  'wind-turbine_supply': 'results.techNames.windTurbine',
  wind_turbine_supply: 'results.techNames.windTurbine',
  biomass_supply: 'results.techNames.biomass',
  battery_storage: 'results.techNames.batteryStorage',
  geothermal_supply: 'results.techNames.geothermal',
  transformer_supply: 'results.techNames.gridElectricity',
  power_transmission: 'results.techNames.powerLines',
  water_supply: 'results.techNames.hydroPower',
  households_supply: 'results.techNames.householdSupply',
  non_households_supply: 'results.techNames.nonHouseholdSupply',
};

/**
 * Normalize tech key: strip location suffixes like "power_transmission:Trafo_300" → "power_transmission"
 * This aggregates all line segments into one "Power Lines" entry.
 */
function normalizeTechKey(tech: string): string {
  // Techs with `:` suffix are location-specific variants (e.g. power_transmission:ID_1)
  const colonIdx = tech.indexOf(':');
  if (colonIdx > 0) {
    return tech.substring(0, colonIdx);
  }
  return tech;
}

export interface CostBreakdownItem {
  category: string;
  value: number;
  color: string;
  locationCount?: number;
  investmentCost?: number;
  variableCost?: number;
}

/**
 * Net cost of a set of cost rows. Feed-in revenue is stored as a negative
 * cost, so it lowers the total.
 */
export function netCost(rows: { value: number }[] | undefined): number {
  return rows?.reduce((sum, row) => sum + row.value, 0) ?? 0;
}

/** Signed cost per normalized technology. */
function costByTech(structured: StructuredModelResults): Record<string, number> {
  const totals: Record<string, number> = {};
  structured.cost?.forEach((c: any) => {
    const tech = normalizeTechKey(c.techs || 'Other');
    totals[tech] = (totals[tech] || 0) + c.value;
  });
  return totals;
}

/** Revenue from technologies whose net cost is negative, such as grid export. */
export function feedInIncome(structured: StructuredModelResults): number {
  return Object.values(costByTech(structured)).reduce((sum, value) => sum + Math.max(0, -value), 0);
}

/**
 * Transform structured cost data into detailed breakdown by technology.
 * Aggregates location-specific variants (e.g. power_transmission:Trafo_300)
 * into a single entry per base technology.
 */
export function transformStructuredCostBreakdown(structured: StructuredModelResults): CostBreakdownItem[] {
  const locationsByTech: Record<string, Set<string>> = {};
  const investByTech: Record<string, number> = {};

  structured.cost?.forEach((c: any) => {
    const tech = normalizeTechKey(c.techs || 'Other');
    locationsByTech[tech] ??= new Set();
    if (c.from_location) {
      locationsByTech[tech].add(c.from_location);
    }
  });

  // Track investment costs separately (also normalized)
  structured.cost_investment?.forEach((c: any) => {
    const tech = normalizeTechKey(c.techs || 'Other');
    if (!investByTech[tech]) {
      investByTech[tech] = 0;
    }
    investByTech[tech] += Math.abs(c.value);
  });

  let colorIdx = 0;

  // Revenue (negative net cost) is not a share of cost; see feedInIncome.
  return Object.entries(costByTech(structured))
    .filter(([_, value]) => value > 0.01)
    .map(([tech, value]) => {
      const i18nKey = COST_TECH_I18N_KEYS[tech];
      const category = i18nKey
        ? i18n.t(i18nKey)
        : tech.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());
      const invest = investByTech[tech] || 0;
      return {
        category,
        value,
        color: getTechColor(tech, colorIdx++),
        locationCount: locationsByTech[tech]?.size || 1,
        investmentCost: invest,
        variableCost: Math.max(0, value - invest),
      };
    })
    .sort((a, b) => b.value - a.value);
}
