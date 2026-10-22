import { describe, expect, it } from 'vitest';
import { transformToCapacityData, transformToEnergyFlow } from './transformUtils';
import { ModelResults } from '@/features/model-results/types';

const SCHOOL_A = [8.805833970833334, 53.09952718091963];
const SCHOOL_B = [8.8048458, 53.09950910869739];

const buildings = {
  features: [
    { geometry: { type: 'Polygon', coordinates: [[SCHOOL_A]] as unknown as number[][][] }, properties: { osm_id: '181873717', f_class: 'school' } },
    { geometry: { type: 'Polygon', coordinates: [[SCHOOL_B]] as unknown as number[][][] }, properties: { osm_id: '181873715', f_class: 'school', parsed_class: 'school' } },
  ],
};

// The same two buildings with OSM building=yes: usage unknown.
const unknownUsage = {
  features: buildings.features.map((f) => ({ ...f, properties: { osm_id: f.properties.osm_id, f_class: 'yes' } })),
};

const baseResults = (coordinates: Record<string, { x: number; y: number }>) =>
  ({
    coordinates,
    loc_techs: {},
    systemwide_capacity_factor: [],
    systemwide_levelised_cost: [],
    total_levelised_cost: [],
    energy_cap: [
      { location: 'n1', tech: 'n1_demand', value: 5.29 },
      { location: 'n2', tech: 'n2_demand', value: 1.07 },
      { location: 'ntrafo_82', tech: 'transformer_supply', value: 250 },
      { location: 'n1', tech: 'pv_supply', value: 12 },
    ],
    sum_production: 0,
    sum_consumption: 0,
  }) as unknown as ModelResults;

describe('transformToCapacityData', () => {
  it('groups demand nodes of the same f_class into one sector bar', () => {
    const coords = {
      n1: { x: 8.805834, y: 53.099527 },
      n2: { x: 8.804846, y: 53.099509 },
      ntrafo_82: { x: 8.803872, y: 53.100875 },
    };
    const out = transformToCapacityData(baseResults(coords), undefined, buildings as never);

    const school = out.find((d) => d.technology === 'School');
    expect(school).toBeDefined();
    expect(school!.type).toBe('demand');
    expect(school!.installed_capacity_kw).toBeCloseTo(6.36, 1);

    // No per-node-id bars.
    expect(out.some((d) => d.technology === 'N1 Demand')).toBe(false);
    expect(out.some((d) => d.technology === 'N2 Demand')).toBe(false);

    // Supply tech stays grouped by tech.
    const grid = out.find((d) => d.technology === 'Solar PV');
    expect(grid?.installed_capacity_kw).toBe(12);
  });

  it('groups buildings of unknown usage into one Other buildings bar', () => {
    const coords = { n1: { x: 8.805834, y: 53.099527 }, n2: { x: 8.804846, y: 53.099509 } };
    const out = transformToCapacityData(baseResults(coords), undefined, unknownUsage as never);

    const demand = out.filter((d) => d.type === 'demand');
    expect(demand.map((d) => d.technology)).toEqual(['Other buildings']);
    expect(demand[0].installed_capacity_kw).toBeCloseTo(6.36, 2);
  });

  it('adds up a technology across buildings and roofs into one bar', () => {
    const results = baseResults({});
    results.energy_cap = [
      { location: 'n1', tech: 'pv_supply_1_0', value: 4 },
      { location: 'n1', tech: 'pv_supply_1_2', value: 6 },
      { location: 'n2', tech: 'air_source_heat_pump_2', value: 3 },
      { location: 'n3', tech: 'air_source_heat_pump_3', value: 5 },
    ] as never;
    const supply = transformToCapacityData(results, undefined, unknownUsage as never).filter((d) => d.type === 'supply');

    expect(supply.map((d) => [d.technology, d.installed_capacity_kw])).toEqual([['Solar PV', 10], ['Air Source Heat Pump', 8]]);
  });

  it('weights a bar\'s capacity factor by capacity and reads each tech\'s producing carrier', () => {
    const results = baseResults({});
    results.energy_cap = [
      { location: 'n1', tech: 'pv_supply_1_0', value: 4 },
      { location: 'n1', tech: 'pv_supply_1_2', value: 6 },
    ] as never;
    results.systemwide_capacity_factor = [
      { techs: 'pv_supply_1_0', carrier: 'power', value: 0.1 },
      { techs: 'pv_supply_1_0', carrier: 'heat', value: 0 },
      { techs: 'pv_supply_1_2', carrier: 'power', value: 0.05 },
      { techs: 'pv_supply_1_2', carrier: 'heat', value: 0 },
    ] as never;
    const pv = transformToCapacityData(results, undefined, unknownUsage as never).find((d) => d.technology === 'Solar PV');

    // (4 x 0.1 + 6 x 0.05) / 10, not the maximum 0.1 and not the heat rows' 0.
    expect(pv?.capacity_factor).toBeCloseTo(0.07, 6);
  });

  it('falls back to the demand tech label when no f_class resolves', () => {
    const coords = { n1: { x: 8.805834, y: 53.099527 }, ntrafo_82: { x: 8.803872, y: 53.100875 } };
    const out = transformToCapacityData(baseResults(coords), undefined, {
      features: [],
    } as never);

    // No building matched -> fall back to raw tech labels for demand.
    const fallback = out.filter((d) => d.type === 'demand');
    expect(fallback.length).toBe(2);
  });
});

describe('transformToEnergyFlow', () => {
  it('groups demand nodes of the same f_class into one sector node', () => {
    const coords = {
      n1: { x: 8.805834, y: 53.099527 },
      n2: { x: 8.804846, y: 53.099509 },
      ntrafo_82: { x: 8.803872, y: 53.100875 },
    };
    const flow = transformToEnergyFlow(baseResults(coords), undefined, buildings as never);

    const names = flow.nodes.map((n) => n.name);
    expect(names).toContain('School');
    // No per-building-id demand nodes.
    expect(names).not.toContain('N1 Demand');
    expect(names).not.toContain('N2 Demand');
  });

  it('groups buildings of unknown usage into one Other buildings node', () => {
    const coords = { n1: { x: 8.805834, y: 53.099527 }, n2: { x: 8.804846, y: 53.099509 } };
    const names = transformToEnergyFlow(baseResults(coords), undefined, unknownUsage as never).nodes.map((n) => n.name);
    expect(names).toContain('Other buildings');
    expect(names).not.toContain('N1 Demand');
  });

  it('adds up a technology across buildings and roofs into one node', () => {
    const results = baseResults({});
    results.energy_cap = [
      { location: 'n1', tech: 'pv_supply_1_0', value: 4 },
      { location: 'n2', tech: 'pv_supply_2_3', value: 6 },
    ] as never;
    const names = transformToEnergyFlow(results, undefined, unknownUsage as never).nodes.map((n) => n.name);
    expect(names.filter((n) => n === 'Solar PV')).toHaveLength(1);
    expect(names.some((n) => n.startsWith('Pv Supply'))).toBe(false);
  });

  it('falls back to demand tech nodes when no f_class resolves', () => {
    const coords = { n1: { x: 8.805834, y: 53.099527 }, ntrafo_82: { x: 8.803872, y: 53.100875 } };
    const flow = transformToEnergyFlow(baseResults(coords), undefined, { features: [] } as never);
    const names = flow.nodes.map((n) => n.name);
    expect(names).toContain('N1 Demand');
    expect(names).toContain('N2 Demand');
  });
});