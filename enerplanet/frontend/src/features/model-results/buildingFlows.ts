import { getTechColor } from '@/constants/tech-colors';
import type { CarrierProdRecord, CarrierConRecord, EnergyCapRecord, StructuredModelResults } from './types';

/** Supply flows into the building's node, or uses out of it. */
export type FlowSide = 'supply' | 'use';

/** One category of flow at a building node, summed over the run. */
export interface BuildingFlow {
  /** Stable key: 'demand', 'lineIn', 'lineOut', 'batteryIn', 'batteryOut', or a technology family. */
  key: string;
  side: FlowSide;
  color: string;
  totalKwh: number;
  peakKw: number;
  /** Value per timestep, aligned with the timesteps returned next to it. */
  hourly: number[];
}

/** Colour of each carrier's end-use demand, so electricity and heat demand differ in one Sankey. */
const DEMAND_COLORS: Record<string, string> = {
  power: '#f2876f',
  heat: '#e11d48',
  cooling: '#06b6d4',
  gas: '#a16207',
};

const FIXED_COLORS: Record<string, string> = {
  lineIn: '#94a3b8',
  lineOut: '#0d9488',
  batteryIn: '#c4b5fd',
  batteryOut: '#8b5cf6',
};

const IS_STORAGE = /battery|storage/;
const IS_LINE = /transmission|transformer_supply|grid_trafo_import|export/;

/** Own uses and generation first, then battery, then the street line. */
function rank(key: string): number {
  if (key === 'demand') return 0;
  if (key.startsWith('battery')) return 2;
  if (key.startsWith('line')) return 3;
  return 1;
}

/** Strips the per-node suffix: pv_supply_1_0 -> pv_supply, air_source_heat_pump_5 -> air_source_heat_pump. */
export function techFamily(tech: string): string {
  return tech.split(':')[0].replace(/(_\d+)+$/, '');
}

/** Maps one result row to the category the building panel shows. */
export function classifyFlow(tech: string, side: 'prod' | 'con'): { key: string; side: FlowSide } {
  const t = tech.toLowerCase();
  if (side === 'con' && t.endsWith('_demand')) return { key: 'demand', side: 'use' };
  if (IS_STORAGE.test(t)) return side === 'prod' ? { key: 'batteryOut', side: 'supply' } : { key: 'batteryIn', side: 'use' };
  if (IS_LINE.test(t)) return side === 'prod' ? { key: 'lineIn', side: 'supply' } : { key: 'lineOut', side: 'use' };
  return { key: techFamily(t), side: side === 'prod' ? 'supply' : 'use' };
}

/**
 * Sums a location's production and consumption rows per category.
 * Values are kW per timestep; energy assumes hourly timesteps, which is what
 * every run in this platform uses.
 */
export function summariseFlows(
  production: CarrierProdRecord[],
  consumption: CarrierConRecord[],
  carrier = 'power',
): { timesteps: string[]; flows: BuildingFlow[] } {
  const timesteps = [...new Set([...production, ...consumption].map((r) => r.timestep))].sort();
  const index = new Map(timesteps.map((ts, i) => [ts, i]));
  const byKey = new Map<string, BuildingFlow>();

  const add = (rows: { techs: string; timestep: string; value: number }[], side: 'prod' | 'con') => {
    for (const r of rows) {
      const kind = classifyFlow(r.techs, side);
      let flow = byKey.get(kind.key);
      if (!flow) {
        const color = kind.key === 'demand' ? DEMAND_COLORS[carrier] ?? DEMAND_COLORS.power : FIXED_COLORS[kind.key] ?? getTechColor(kind.key);
        flow = { ...kind, color, totalKwh: 0, peakKw: 0, hourly: new Array(timesteps.length).fill(0) };
        byKey.set(kind.key, flow);
      }
      flow.hourly[index.get(r.timestep)!] += Math.abs(r.value);
    }
  };
  add(production, 'prod');
  add(consumption, 'con');

  const flows = [...byKey.values()]
    .map((f) => ({ ...f, totalKwh: f.hourly.reduce((a, b) => a + b, 0), peakKw: Math.max(0, ...f.hourly) }))
    .filter((f) => f.totalKwh >= 0.05)
    .sort((a, b) => rank(a.key) - rank(b.key));
  return { timesteps, flows };
}

/**
 * Self-sufficiency after Luthander et al. (2015): PV generation used on site
 * (generation minus export) over local consumption, 0..1; null without consumption.
 */
export function luthanderSelfSufficiency(pvKwh: number, exportKwh: number, consumptionKwh: number): number | null {
  if (consumptionKwh <= 0) return null;
  return Math.min(1, Math.max(0, (pvKwh - exportKwh) / consumptionKwh));
}

/** Model-wide Luthander self-sufficiency from the stored aggregates, 0..1; 0 without consumption. */
export function modelSelfSufficiency(results: StructuredModelResults): number {
  const total = (rows: { techs: string; total: number }[] | undefined, match: RegExp) =>
    (rows ?? []).filter((r) => match.test(r.techs.split(':')[0])).reduce((sum, r) => sum + Math.abs(r.total), 0);
  return luthanderSelfSufficiency(
    total(results.prod_aggregates, /^pv_supply/),
    total(results.con_aggregates, /_export$/),
    Math.abs(results.sum_consumption || 0),
  ) ?? 0;
}

/** Self-sufficiency of one node; local consumption excludes battery charging and export. */
export function selfSufficiency(flows: BuildingFlow[]): number | null {
  const total = (key: string) => flows.find((f) => f.key === key)?.totalKwh ?? 0;
  const consumption = flows
    .filter((f) => f.side === 'use' && f.key !== 'lineOut' && f.key !== 'batteryIn')
    .reduce((s, f) => s + f.totalKwh, 0);
  return luthanderSelfSufficiency(total('pv_supply'), total('lineOut'), consumption);
}

/** Energy from one supply to one use over the run. */
export interface FlowLink {
  from: string;
  to: string;
  kwh: number;
}

/**
 * Splits each hour's supplies over that hour's uses in proportion to the uses,
 * then sums over the run. Results hold totals per technology only, so which
 * kWh went where within an hour is an assumption, not a model output.
 */
export function allocateFlows(flows: BuildingFlow[]): FlowLink[] {
  const supplies = flows.filter((f) => f.side === 'supply');
  const uses = flows.filter((f) => f.side === 'use');
  const totals = new Map<string, FlowLink>();
  const hours = flows[0]?.hourly.length ?? 0;
  for (let h = 0; h < hours; h++) {
    const useSum = uses.reduce((sum, u) => sum + u.hourly[h], 0);
    if (useSum <= 0) continue;
    for (const s of supplies) {
      if (s.hourly[h] <= 0) continue;
      for (const u of uses) {
        if (u.hourly[h] <= 0) continue;
        const key = `${s.key}>${u.key}`;
        const link = totals.get(key) ?? { from: s.key, to: u.key, kwh: 0 };
        link.kwh += (s.hourly[h] * u.hourly[h]) / useSum;
        totals.set(key, link);
      }
    }
  }
  return [...totals.values()];
}

/**
 * Heat each heat pump takes from the air or ground: its heat output minus its
 * electricity input, from flows of all carriers at one node.
 */
export function ambientHeat(flows: BuildingFlow[]): { key: string; kwh: number }[] {
  const pumps = (side: FlowSide) => flows.filter((f) => f.side === side && f.key.includes('heat_pump'));
  const input = new Map(pumps('use').map((f) => [f.key, f.totalKwh]));
  return pumps('supply')
    .filter((f) => input.has(f.key))
    .map((f) => ({ key: f.key, kwh: f.totalKwh - input.get(f.key)! }))
    .filter((a) => a.kwh > 0.5);
}

/** One carrier's flows at a node or for the whole model. */
export interface CarrierResult {
  carrier: string;
  timesteps: string[];
  flows: BuildingFlow[];
}

/** Flows of the whole model: line flows between buildings cancel out, so they are left out. */
export function systemFlows(
  production: CarrierProdRecord[],
  consumption: CarrierConRecord[],
  carrier = 'power',
): { timesteps: string[]; flows: BuildingFlow[] } {
  const own = <T extends { techs: string }>(rows: T[]) => rows.filter((r) => !r.techs.includes('transmission'));
  return summariseFlows(own(production), own(consumption), carrier);
}

type Translate = (key: string, fallback: string) => string;

const DEMAND_LABELS: Record<string, [string, string]> = {
  power: ['results.buildingDetail.flow.appliances', 'Appliances and lighting'],
  heat: ['results.buildingDetail.flow.heatDemand', 'Space heating and hot water'],
  cooling: ['results.buildingDetail.flow.coolingDemand', 'Cooling'],
  gas: ['results.buildingDetail.flow.gasDemand', 'Gas use'],
};

const FLOW_LABELS: Record<string, [string, string]> = {
  lineIn: ['results.buildingDetail.flow.lineIn', 'From the street line'],
  lineOut: ['results.buildingDetail.flow.lineOut', 'To the street line'],
  batteryIn: ['results.buildingDetail.flow.batteryIn', 'Battery charging'],
  batteryOut: ['results.buildingDetail.flow.batteryOut', 'Battery discharging'],
  pv_supply: ['results.buildingDetail.flow.pv', 'Solar PV'],
  air_source_heat_pump: ['results.buildingDetail.flow.heatPump', 'Heat pump'],
  boiler: ['results.buildingDetail.flow.boiler', 'Boiler'],
};

/** Human label for a flow category on a given carrier. */
export function flowLabel(key: string, carrier: string, t: Translate): string {
  const entry = key === 'demand' ? DEMAND_LABELS[carrier] : FLOW_LABELS[key];
  if (entry) return t(entry[0], entry[1]);
  const text = key.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Label for model-wide flows, where the line flows are the grid connection at the transformer. */
export function systemFlowLabel(key: string, carrier: string, t: Translate): string {
  if (key === 'lineIn') return t('results.energy.flow.gridImport', 'Grid import');
  if (key === 'lineOut') return t('results.energy.flow.gridExport', 'Grid export');
  return flowLabel(key, carrier, t);
}

const IS_BATTERY_TECH = /battery|storage/;
const NOT_EQUIPMENT = /_demand$|transmission|transformer|_import$|_export$/;

/**
 * Installed capacity per technology, summed over all buildings; `units` counts
 * buildings, so PV on several roof surfaces of one building counts once.
 * Batteries have two rows per building, power first, then storage.
 * Grid and gas imports are connections, not equipment.
 */
export function installedCapacities(rows: EnergyCapRecord[]) {
  const byNode = new Map<string, number[]>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (r.to_location || NOT_EQUIPMENT.test(r.tech)) continue;
    const key = `${r.tech}|${r.from_location}`;
    byNode.set(key, [...(byNode.get(key) ?? []), r.value]);
  }
  const totals = new Map<string, { kw: number; kwh: number; nodes: Set<string> }>();
  for (const [key, [power, storage]] of byNode) {
    if (power <= 0) continue;
    const [tech, node] = key.split('|');
    const family = techFamily(tech);
    const total = totals.get(family) ?? { kw: 0, kwh: 0, nodes: new Set<string>() };
    total.kw += power;
    total.nodes.add(node);
    // Ingest writes battery storage in MWh as the second row; convert here until ingest stores kWh.
    if (IS_BATTERY_TECH.test(family) && storage != null) total.kwh += storage * 1000;
    totals.set(family, total);
  }
  return [...totals].map(([family, { kw, kwh, nodes }]) => ({ family, kw, kwh, units: nodes.size }));
}
