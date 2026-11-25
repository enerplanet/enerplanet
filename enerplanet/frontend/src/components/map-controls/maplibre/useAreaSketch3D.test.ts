import { describe, expect, it } from 'vitest';

import { areaAt, editHandleAt } from './useAreaSketch3D';

// Corners given in pixels: the projection is the identity.
const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
const project = (c: [number, number]): [number, number] => c;

describe('editHandleAt', () => {
  it('takes a corner within reach before the edges that meet there', () => {
    expect(editHandleAt([square], [103, 4], project, 10)).toEqual({ polygon: 0, corner: 1, onEdge: false, at: [100, 0] });
  });

  it('takes the nearest point of an edge, on the edge that starts at the corner given', () => {
    expect(editHandleAt([square], [50, 6], project, 10)).toEqual({ polygon: 0, corner: 0, onEdge: true, at: [50, 0] });
    expect(editHandleAt([square], [-4, 60], project, 10)).toEqual({ polygon: 0, corner: 3, onEdge: true, at: [0, 60] });
  });

  it('finds the edge of a second area', () => {
    const other: [number, number][] = [[200, 0], [300, 0], [300, 100]];
    expect(editHandleAt([square, other], [250, 3], project, 10)).toEqual({ polygon: 1, corner: 0, onEdge: true, at: [250, 0] });
  });

  it('gives nothing out of reach or inside an area', () => {
    expect(editHandleAt([square], [50, 50], project, 10)).toBeNull();
    expect(editHandleAt([square], [150, 150], project, 10)).toBeNull();
  });
});

describe('areaAt', () => {
  const west: [number, number][] = [[12.9, 48.8], [12.95, 48.8], [12.95, 48.85], [12.9, 48.85]];
  const east: [number, number][] = [[13.0, 48.8], [13.05, 48.8], [13.0, 48.85]];

  it('gives the index of the area holding the point', () => {
    expect(areaAt([west, east], [12.92, 48.82])).toBe(0);
    expect(areaAt([west, east], [13.01, 48.81])).toBe(1);
  });

  it('gives -1 between the areas', () => {
    expect(areaAt([west, east], [12.97, 48.82])).toBe(-1);
  });
});
