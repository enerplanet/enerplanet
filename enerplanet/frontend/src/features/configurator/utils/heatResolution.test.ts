import { describe, expect, it } from 'vitest';

import { expectedFitTech, resolveHeatTechForBuilding } from './heatResolution';

describe('resolveHeatTechForBuilding', () => {
  it('assigns the table entry for a known building class', () => {
    expect(resolveHeatTechForBuilding('university', 50_000)?.techKey).toBe('gas_boiler');
    expect(resolveHeatTechForBuilding('detached', 20_000)?.techKey).toBe('air_source_heat_pump');
  });

  it('falls back to a gas boiler for a class the table does not know', () => {
    // An OSM tag such as drinking_water or an untagged "yes" carries no use;
    // the fallback must not draw on the electricity grid.
    expect(resolveHeatTechForBuilding('drinking_water', 400_000)?.techKey).toBe('gas_boiler');
    expect(resolveHeatTechForBuilding('yes', 900_000)?.techKey).toBe('gas_boiler');
    expect(expectedFitTech('hackerspace')).toBe('gas_boiler');
  });

  it('assigns nothing without heat demand', () => {
    expect(resolveHeatTechForBuilding('yes', 0)).toBeNull();
  });
});
