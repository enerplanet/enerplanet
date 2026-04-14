import { ModelResults } from '@/features/model-results/types';
import {
  CostBreakdown,
  CapacityData,
  EnergyFlowData
} from '@/features/simulation-charts/types';

// Technology display names
const TECH_NAMES: Record<string, string> = {
  pv_supply: 'Solar PV',
  wind_supply: 'Wind',
  wind_onshore: 'Wind (Onshore)',
  wind_offshore: 'Wind (Offshore)',
  biomass_supply: 'Biomass',
  battery_storage: 'Battery Storage',
  geothermal_supply: 'Geothermal',
  water_supply: 'Hydro Power',
  transformer_supply: 'Grid Import',
  power_grid_supply: 'Grid Import',
  power_transmission: 'Power Transmission',
  sfh_demand: 'Single Family House',
  th_demand: 'Townhouse',
  mfh_demand: 'Multi Family House',
  ab_demand: 'Apartment Block',
  commercial_demand: 'Commercial',
  public_demand: 'Public Building',
  industrial_demand: 'Industrial',
  agricultural_demand: 'Agricultural',
};

// Tech name to translation key mapping
const TECH_TRANSLATION_KEYS: Record<string, string> = {
  pv_supply: 'results.techNames.solarPv',
  wind_supply: 'results.techNames.wind',
  wind_onshore: 'results.techNames.windOnshore',
  wind_offshore: 'results.techNames.windOffshore',
  biomass_supply: 'results.techNames.biomass',
  battery_storage: 'results.techNames.batteryStorage',
  geothermal_supply: 'results.techNames.geothermal',
  water_supply: 'results.techNames.hydroPower',
  transformer_supply: 'results.techNames.gridImport',
  power_grid_supply: 'results.techNames.gridImport',
  power_transmission: 'results.techNames.powerTransmission',
  sfh_demand: 'results.techNames.sfhDemand',
  th_demand: 'results.techNames.thDemand',
  mfh_demand: 'results.techNames.mfhDemand',
  ab_demand: 'results.techNames.abDemand',
  commercial_demand: 'results.techNames.commercialDemand',
  public_demand: 'results.techNames.publicDemand',
  industrial_demand: 'results.techNames.industrialDemand',
  agricultural_demand: 'results.techNames.agriculturalDemand',
};

// Technology colors


type TranslateFunction = (key: string) => string;

const EXCLUDED_CAPACITY_TECHS = new Set([
  'power_transmission',
  'transformer_supply',
]);

function getBaseTech(tech: string): string {
  if (!tech) return '';
  return tech.split(':', 1)[0].trim();
}

function isCapacityChartTech(tech: string): boolean {
  const baseTech = getBaseTech(tech).toLowerCase();
  return Boolean(baseTech) && !EXCLUDED_CAPACITY_TECHS.has(baseTech);
}

function getTechDisplayName(tech: string, t?: TranslateFunction): string {
  if (t && TECH_TRANSLATION_KEYS[tech]) {
    return t(TECH_TRANSLATION_KEYS[tech]);
  }
  return TECH_NAMES[tech] || tech.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());
}

function getTechType(tech: string): 'supply' | 'demand' {
  const lower = tech.toLowerCase();
  if (lower.includes('demand') || lower.includes('load') || lower.includes('consumption')) {
    return 'demand';
  }
  // Residential f-class types often don't have 'demand' in the raw key but are loads
  const demandKeywords = ['sfh', 'mfh', 'th', 'ab', 'commercial', 'public', 'industrial', 'agricultural'];
  if (demandKeywords.some(k => lower.includes(k))) {
    return 'demand';
  }
  return 'supply';
}

/**
 * Transform energy capacity data for the capacity chart
 */
export function transformToCapacityData(results: ModelResults, t?: TranslateFunction): CapacityData[] {
  if (!results.energy_cap || results.energy_cap.length === 0) {
    return [];
  }

  // Group by technology
  const techCapacity: Record<string, number> = {};

  results.energy_cap.forEach(cap => {
    const tech = getBaseTech(cap.tech || '');
    if (!isCapacityChartTech(tech)) return;
    if (!techCapacity[tech]) {
      techCapacity[tech] = 0;
    }
    techCapacity[tech] += cap.value;
  });

  // Get capacity factors for each tech.
  // Some payloads store factors as "tech:location", while energy_cap uses base tech names.
  const capacityFactorsExact: Record<string, number> = {};
  const capacityFactorsByBaseMax: Record<string, number> = {};
  if (results.systemwide_capacity_factor) {
    results.systemwide_capacity_factor.forEach(cf => {
      if (!Number.isFinite(cf.value)) return;
      const clamped = Math.max(0, Math.min(1, cf.value));
      capacityFactorsExact[cf.techs] = clamped;

      const baseTech = getBaseTech(cf.techs);
      const prev = capacityFactorsByBaseMax[baseTech];
      capacityFactorsByBaseMax[baseTech] = prev === undefined ? clamped : Math.max(prev, clamped);
    });
  }

  return Object.entries(techCapacity)
    .filter(([_, value]) => value > 0)
    .map(([tech, value]) => {
      const type = getTechType(tech);
      const capacityFactor = capacityFactorsExact[tech] ?? capacityFactorsByBaseMax[tech] ?? 0;

      return {
        technology: getTechDisplayName(tech, t),
        installed_capacity_kw: value,
        utilized_capacity_kw: value * capacityFactor,
        capacity_factor: capacityFactor,
        type,
      };
    })
    .sort((a, b) => b.installed_capacity_kw - a.installed_capacity_kw);
}

/**
 * Transform levelised cost data for the cost breakdown chart
 */
export function transformToCostBreakdown(results: ModelResults): CostBreakdown[] {
  if (!results.total_levelised_cost || results.total_levelised_cost.length === 0) {
    return [];
  }

  // Group costs by category
  const costsByCategory: Record<string, number> = {};

  results.total_levelised_cost.forEach(cost => {
    const category = cost.costs || 'Other';
    if (!costsByCategory[category]) {
      costsByCategory[category] = 0;
    }
    costsByCategory[category] += cost.value;
  });

  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  return Object.entries(costsByCategory)
    .filter(([_, value]) => Math.abs(value) > 0.001)
    .map(([category, value], index) => ({
      category: category.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase()),
      value: value * 1000, // Convert to EUR
      color: colors[index % colors.length],
    }))
    .sort((a, b) => b.value - a.value);
}



/**
 * Transform data for energy flow sankey diagram
 */
export function transformToEnergyFlow(results: ModelResults, t?: TranslateFunction): EnergyFlowData {
  const nodes: { name: string }[] = [];
  const links: { source: string; target: string; value: number }[] = [];
  const nodeSet = new Set<string>();

  const toBaseTech = (tech: string): string => tech ? tech.split(':', 1)[0].trim() : '';
  const isDemandTech = (tech: string): boolean => toBaseTech(tech).toLowerCase().endsWith('_demand');
  const excludedSourceTechs = new Set(['power_transmission']);

  const addValue = (target: Record<string, number>, key: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    target[key] = (target[key] || 0) + value;
  };

  const sourceEnergyByTech: Record<string, number> = {};
  const demandEnergyByTech: Record<string, number> = {};

  // Use energy_cap data for the energy flow diagram
  if (results.energy_cap) {
    results.energy_cap.forEach(cap => {
      const tech = toBaseTech(cap.tech || '');
      if (!tech) return;
      if (isDemandTech(tech)) {
        addValue(demandEnergyByTech, getTechDisplayName(tech, t), Math.abs(cap.value));
      } else if (!excludedSourceTechs.has(tech)) {
        addValue(sourceEnergyByTech, getTechDisplayName(tech, t), Math.abs(cap.value));
      }
    });
  }

  const sourceEntries = Object.entries(sourceEnergyByTech).filter(([, value]) => value > 0);
  const demandEntries = Object.entries(demandEnergyByTech).filter(([, value]) => value > 0);

  // If we still have no weighted demand values, derive demand categories from loc_techs.
  if (demandEntries.length === 0 && results.loc_techs) {
    Object.values(results.loc_techs).forEach(techs => {
      techs.forEach(tech => {
        if (!isDemandTech(tech)) return;
        const nodeName = getTechDisplayName(toBaseTech(tech), t);
        if (!(nodeName in demandEnergyByTech)) {
          demandEnergyByTech[nodeName] = 0;
        }
      });
    });
  }

  const finalDemandEntries = Object.entries(demandEnergyByTech);

  sourceEntries.forEach(([nodeName]) => {
    if (!nodeSet.has(nodeName)) {
      nodeSet.add(nodeName);
      nodes.push({ name: nodeName });
    }
  });

  const energySystemName = t ? t('results.chartLabels.energySystem') : 'Energy System';
  if (!nodeSet.has(energySystemName)) {
    nodeSet.add(energySystemName);
    nodes.push({ name: energySystemName });
  }

  finalDemandEntries.forEach(([nodeName]) => {
    if (!nodeSet.has(nodeName)) {
      nodeSet.add(nodeName);
      nodes.push({ name: nodeName });
    }
  });

  sourceEntries.forEach(([nodeName, value]) => {
    links.push({
      source: nodeName,
      target: energySystemName,
      value,
    });
  });

  const totalSourceEnergy = sourceEntries.reduce((sum, [, value]) => sum + value, 0);
  const totalDemandEnergy = finalDemandEntries.reduce((sum, [, value]) => sum + value, 0);

  if (totalSourceEnergy > 0 && finalDemandEntries.length > 0) {
    if (totalDemandEnergy > 0) {
      // Preserve Sankey conservation while keeping the observed demand proportions.
      const scale = totalSourceEnergy / totalDemandEnergy;
      finalDemandEntries.forEach(([nodeName, value]) => {
        links.push({
          source: energySystemName,
          target: nodeName,
          value: value * scale,
        });
      });
    } else {
      const share = totalSourceEnergy / finalDemandEntries.length;
      finalDemandEntries.forEach(([nodeName]) => {
        links.push({
          source: energySystemName,
          target: nodeName,
          value: share,
        });
      });
    }
  }

  return { nodes, links };
}
