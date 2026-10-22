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
      n1: { x: 53.099527, y: 8.805834 },
      n2: { x: 53.099509, y: 8.804846 },
      ntrafo_82: { x: 53.100875, y: 8.803872 },
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

  it('falls back to the demand tech label when no f_class resolves', () => {
    const coords = { n1: { x: 53.099527, y: 8.805834 }, ntrafo_82: { x: 53.100875, y: 8.803872 } };
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
      n1: { x: 53.099527, y: 8.805834 },
      n2: { x: 53.099509, y: 8.804846 },
      ntrafo_82: { x: 53.100875, y: 8.803872 },
    };
    const flow = transformToEnergyFlow(baseResults(coords), undefined, buildings as never);

    const names = flow.nodes.map((n) => n.name);
    expect(names).toContain('School');
    // No per-building-id demand nodes.
    expect(names).not.toContain('N1 Demand');
    expect(names).not.toContain('N2 Demand');
  });

  it('falls back to demand tech nodes when no f_class resolves', () => {
    const coords = { n1: { x: 53.099527, y: 8.805834 }, ntrafo_82: { x: 53.100875, y: 8.803872 } };
    const flow = transformToEnergyFlow(baseResults(coords), undefined, { features: [] } as never);
    const names = flow.nodes.map((n) => n.name);
    expect(names).toContain('N1 Demand');
    expect(names).toContain('N2 Demand');
  });
});