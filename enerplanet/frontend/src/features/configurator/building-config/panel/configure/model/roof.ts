/** Shared roof model types and defaults used across configure and overview UI. */

export interface RoofSurface {
  id: string;
  name: string;
  tilt: number;
  azimuth: number;
  area: number;
  usefulArea: number;
  useForPV: boolean;
  fromCityData: boolean;
}

export type RoofType = 'flat' | 'mono-pitch' | 'gabled' | 'hipped' | 'v-shape' | 'saw-tooth' | 'custom';

export interface RoofConfig {
  type: RoofType;
  surfaces: RoofSurface[];
  from3DData: boolean;
}

export const DEFAULT_ROOF_CONFIG: RoofConfig = {
  type: 'gabled',
  from3DData: true,
  surfaces: [
    { id: 'r1', name: 'South Slope', tilt: 38.5, azimuth: 176.2, area: 54.8, usefulArea: 47.2, useForPV: true, fromCityData: true },
    { id: 'r2', name: 'North Slope', tilt: 38.5, azimuth: 356.2, area: 54.8, usefulArea: 16.4, useForPV: false, fromCityData: true },
  ],
};