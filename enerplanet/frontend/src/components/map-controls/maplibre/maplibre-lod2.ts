import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';

import type { Lod2Surface } from './useLod2Surfaces';

export const LOD2_LAYER_ID = 'lod2-buildings';

const ROOF_COLOR = 0xb4664a;
const WALL_COLOR = 0xe6e0d6;
const EDGE_COLOR = 0x4b4b4b;

/** A point in the layer's frame: metres east, north and up from the origin. */
type Local = [number, number, number];

/**
 * Splits a planar polygon (outer ring then holes, in the local frame) into
 * triangles. The polygon is flattened onto the axis plane its normal is least
 * parallel to, which keeps the triangulation valid for walls as well as roofs.
 */
export function triangulatePlanar(rings: Local[][]): Local[] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  // Newell's method gives the polygon normal from any non-degenerate ring.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < outer.length; i++) {
    const [x1, y1, z1] = outer[i];
    const [x2, y2, z2] = outer[(i + 1) % outer.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const flat = (p: Local) => (az >= ax && az >= ay ? new THREE.Vector2(p[0], p[1]) : ax >= ay ? new THREE.Vector2(p[1], p[2]) : new THREE.Vector2(p[0], p[2]));
  // GeoJSON rings repeat their first point at the end; triangulation wants it once.
  const open = (ring: Local[]) => (ring.length > 1 && ring[0].every((v, i) => v === ring[ring.length - 1][i]) ? ring.slice(0, -1) : ring);
  const contour = open(outer);
  const holes = rings.slice(1).map(open);
  const points = [...contour, ...holes.flat()];
  const faces = THREE.ShapeUtils.triangulateShape(contour.map(flat), holes.map((h) => h.map(flat)));
  return faces.flatMap((face) => face.map((i) => points[i]));
}

/**
 * A MapLibre custom layer drawing buildings' LoD2 roofs and walls with
 * three.js. Each building stands on its lowest surface point, since the
 * surfaces' heights are above sea level and the map has no terrain.
 */
export class Lod2Layer implements maplibregl.CustomLayerInterface {
  id = LOD2_LAYER_ID;
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map: maplibregl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly buildings = new THREE.Group();
  private origin: maplibregl.MercatorCoordinate | null = null;

  constructor() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.5, -1, 1.2);
    this.scene.add(sun);
    this.scene.add(this.buildings);
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove(): void {
    this.clear();
    this.renderer = null;
    this.map = null;
  }

  /** Replaces the drawn buildings with these, by osm_id. */
  setBuildings(byOsmId: Map<string, Lod2Surface[]>): void {
    this.clear();
    const first = byOsmId.values().next().value?.[0]?.rings[0]?.[0];
    if (!first) {
      this.map?.triggerRepaint();
      return;
    }
    this.origin = maplibregl.MercatorCoordinate.fromLngLat([first[0], first[1]], 0);
    const metre = this.origin.meterInMercatorCoordinateUnits();
    const roofs: number[] = [];
    const walls: number[] = [];
    for (const surfaces of byOsmId.values()) {
      const base = Math.min(...surfaces.flatMap((s) => s.rings.flatMap((r) => r.map((p) => p[2] ?? 0))));
      for (const surface of surfaces) {
        const rings = surface.rings.map((ring) => ring.map((p): Local => {
          const m = maplibregl.MercatorCoordinate.fromLngLat([p[0], p[1]], 0);
          // Mercator y grows southwards; the local frame's y points north.
          return [(m.x - this.origin!.x) / metre, (this.origin!.y - m.y) / metre, (p[2] ?? base) - base];
        }));
        (surface.roof ? roofs : walls).push(...triangulatePlanar(rings).flat());
      }
    }
    this.addMesh(roofs, ROOF_COLOR);
    this.addMesh(walls, WALL_COLOR);
    this.map?.triggerRepaint();
  }

  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, args: maplibregl.CustomRenderMethodInput): void {
    if (!this.renderer || !this.origin || this.buildings.children.length === 0) return;
    const metre = this.origin.meterInMercatorCoordinateUnits();
    const toMercator = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(metre, -metre, metre));
    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
      .multiply(toMercator);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  private addMesh(positions: number[], color: number): void {
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    this.buildings.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
    this.buildings.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: EDGE_COLOR })));
  }

  private clear(): void {
    for (const child of [...this.buildings.children]) {
      this.buildings.remove(child);
      const object = child as THREE.Mesh | THREE.LineSegments;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}
