import { describe, expect, it } from 'vitest';
import Feature from 'ol/Feature';

import { applyNotHeated, expectedFitTech, resolveHeatTechForBuilding } from './heatResolution';

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

describe('applyNotHeated', () => {
  const building = (osmId: string) =>
    new Feature({ osm_id: osmId, techs: { gas_boiler: { alias: 'Gas boiler' }, pv_supply: { alias: 'PV' } } });

  it('removes the heat technology of a building that is not heated and keeps its other technologies', () => {
    const house = building('1');
    const garage = building('2');
    garage.set('heat_supplier', '1');

    expect(applyNotHeated([house, garage], new Set(['2']))).toBe(1);

    expect(Object.keys(garage.get('techs'))).toEqual(['pv_supply']);
    expect(garage.get('heat_supplier')).toBeUndefined();
    expect(garage.get('heated')).toBe(false);
    expect(Object.keys(house.get('techs'))).toEqual(['gas_boiler', 'pv_supply']);
    expect(house.get('heated')).toBeUndefined();
  });

  it('clears the mark of a building that is heated again', () => {
    const workshop = building('3');
    workshop.set('heated', false);

    expect(applyNotHeated([workshop], new Set())).toBe(0);
    expect(workshop.get('heated')).toBeUndefined();
  });
});
