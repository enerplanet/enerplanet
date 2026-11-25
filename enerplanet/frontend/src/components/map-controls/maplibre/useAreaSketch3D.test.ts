import { describe, expect, it } from 'vitest';

import { editHandleAt } from './useAreaSketch3D';

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
