import { describe, expect, it } from 'vitest';
import { fromLonLat } from 'ol/proj';
import { countryAt, gridCentre } from './regionCountry';

const koeln = { country: 'Germany', bbox: { west: 6.87, south: 50.88, east: 6.99, north: 50.95 } };
const wien = { country: 'Austria', bbox: { west: 16.17, south: 48.10, east: 16.60, north: 48.34 } };

describe('countryAt', () => {
  it('finds the region whose box holds the point', () => expect(countryAt([wien, koeln], [6.94, 50.91])).toBe('Germany'));
  it('is undefined outside every box', () => expect(countryAt([wien, koeln], [11.5, 48.1])).toBeUndefined());
  it('is undefined where boxes of two countries overlap', () =>
    expect(countryAt([koeln, { country: 'Netherlands', bbox: koeln.bbox }], [6.94, 50.91])).toBeUndefined());
});

describe('gridCentre', () => {
  const building = (coordinates: number[][]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  it('averages buildings in lon/lat', () => {
    const centre = gridCentre({ type: 'FeatureCollection', features: [building([[6.90, 50.90]]), building([[6.96, 50.92]])] } as never);
    expect(centre?.[0]).toBeCloseTo(6.93);
    expect(centre?.[1]).toBeCloseTo(50.91);
  });
  it('converts Web Mercator buildings to lon/lat', () => {
    const centre = gridCentre({ type: 'FeatureCollection', features: [building([fromLonLat([6.94, 50.91])])] } as never);
    expect(centre?.[0]).toBeCloseTo(6.94);
    expect(centre?.[1]).toBeCloseTo(50.91);
  });
  it('is undefined without buildings', () => expect(gridCentre(undefined)).toBeUndefined());
});
