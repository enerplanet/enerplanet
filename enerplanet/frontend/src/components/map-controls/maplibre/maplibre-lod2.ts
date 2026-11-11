import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';

import type { TechMarker } from './techMarkers';
import type { Lod2Surface } from './useLod2Surfaces';

export const LOD2_LAYER_ID = 'lod2-buildings';

const ROOF_COLOR = 0xb4664a;
const WALL_COLOR = 0xe6e0d6;
const EDGE_COLOR = 0x4b4b4b;
const HOVER_COLOR = 0x3b82f6;
export const PV_COLOR = 0x1f3a5f;
export const MARKER_COLOR: Record<TechMarker, number> = { heat: 0xea580c, storage: 0x7c3aed };
// Metres: the stem above the roof, the ball on it, and the gap between two balls.
const MARKER_STEM = 4;
const MARKER_RADIUS = 2;
const MARKER_GAP = 5;

/** A point in the layer's frame: metres east, north and up from the origin. */
type Local = [number, number, number];

/** Triangle positions for one merged mesh, with the osm_id of the building each triangle belongs to. */
interface MeshBuffer { positions: number[]; owners: string[] }

/** Appends one building's triangles, nine numbers each, to a mesh buffer. */
function addTriangles(buffer: MeshBuffer, positions: number[], osmId: string): void {
  buffer.positions.push(...positions);
  for (let i = 0; i < positions.length; i += 9) buffer.owners.push(osmId);
}

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
  /** Each building's triangle positions, for its hover highlight. */
  private readonly triangles = new Map<string, number[]>();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private highlight: THREE.Mesh | null = null;
  private hovered: string | null = null;

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

  /**
   * Replaces the drawn buildings with these, by osm_id; the surfaces in
   * pvByOsmId are drawn as PV panels, and markersByOsmId puts a marker above
   * the roof for each kind of technology.
   */
  setBuildings(
    byOsmId: Map<string, Lod2Surface[]>,
    pvByOsmId: Map<string, Set<string>> = new Map(),
    markersByOsmId: Map<string, TechMarker[]> = new Map(),
  ): void {
    this.clear();
    const first = byOsmId.values().next().value?.[0]?.rings[0]?.[0];
    if (!first) {
      this.map?.triggerRepaint();
      return;
    }
    this.origin = maplibregl.MercatorCoordinate.fromLngLat([first[0], first[1]], 0);
    const metre = this.origin.meterInMercatorCoordinateUnits();
    const roofs: MeshBuffer = { positions: [], owners: [] };
    const walls: MeshBuffer = { positions: [], owners: [] };
    const panels: MeshBuffer = { positions: [], owners: [] };
    for (const [osmId, surfaces] of byOsmId) {
      const pv = pvByOsmId.get(osmId);
      const base = Math.min(...surfaces.flatMap((s) => s.rings.flatMap((r) => r.map((p) => p[2] ?? 0))));
      const points: Local[] = [];
      const own: number[] = [];
      for (const surface of surfaces) {
        const rings = surface.rings.map((ring) => ring.map((p): Local => {
          const m = maplibregl.MercatorCoordinate.fromLngLat([p[0], p[1]], 0);
          // Mercator y grows southwards; the local frame's y points north.
          return [(m.x - this.origin!.x) / metre, (this.origin!.y - m.y) / metre, (p[2] ?? base) - base];
        }));
        points.push(...rings.flat());
        const target = pv?.has(surface.id) ? panels : surface.roof ? roofs : walls;
        const tris = triangulatePlanar(rings).flat();
        addTriangles(target, tris, osmId);
        own.push(...tris);
      }
      this.triangles.set(osmId, own);
      const markers = markersByOsmId.get(osmId);
      if (markers) this.addMarkers(points, markers);
    }
    this.addMesh(roofs, ROOF_COLOR);
    this.addMesh(walls, WALL_COLOR);
    this.addMesh(panels, PV_COLOR);
    this.showHighlight();
    this.map?.triggerRepaint();
  }

  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, args: maplibregl.CustomRenderMethodInput): void {
    if (!this.origin) return;
    const metre = this.origin.meterInMercatorCoordinateUnits();
    const toMercator = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(metre, -metre, metre));
    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
      .multiply(toMercator);
    if (!this.renderer || this.buildings.children.length === 0) return;
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The osm_id of the building drawn at a point of the map canvas, given in
   * clip coordinates (-1 to 1, y up), or null over no building. Uses the
   * projection of the last frame drawn.
   */
  pick(x: number, y: number): string | null {
    if (!this.origin || this.meshes.length === 0) return null;
    const toLocal = this.camera.projectionMatrix.clone().invert();
    const near = new THREE.Vector3(x, y, -1).applyMatrix4(toLocal);
    const far = new THREE.Vector3(x, y, 1).applyMatrix4(toLocal);
    this.raycaster.set(near, far.sub(near).normalize());
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit?.faceIndex == null ? null : (hit.object.userData.owners as string[])[hit.faceIndex] ?? null;
  }

  /** Tints the building with this osm_id, or none for null. */
  setHovered(osmId: string | null): void {
    if (osmId === this.hovered) return;
    this.hovered = osmId;
    this.showHighlight();
    this.map?.triggerRepaint();
  }

  private showHighlight(): void {
    if (this.highlight) {
      this.buildings.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    const positions = this.hovered ? this.triangles.get(this.hovered) : undefined;
    if (!positions?.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // The polygon offset draws the tint over the building's own faces instead of fighting them for depth.
    const material = new THREE.MeshBasicMaterial({
      color: HOVER_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.highlight = new THREE.Mesh(geometry, material);
    this.buildings.add(this.highlight);
  }

  private addMesh(buffer: MeshBuffer, color: number): void {
    if (buffer.positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    mesh.userData.owners = buffer.owners;
    this.meshes.push(mesh);
    this.buildings.add(mesh);
    this.buildings.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: EDGE_COLOR })));
  }

  /** One stem and ball per marker above the highest point of a building, side by side over its centre. */
  private addMarkers(points: Local[], markers: TechMarker[]): void {
    const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const y = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const top = Math.max(...points.map((p) => p[2]));
    markers.forEach((marker, i) => {
      const material = new THREE.MeshLambertMaterial({ color: MARKER_COLOR[marker] });
      const offset = (i - (markers.length - 1) / 2) * MARKER_GAP;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, MARKER_STEM), material);
      // Cylinders stand along y; the local frame's up is z.
      stem.rotation.x = Math.PI / 2;
      stem.position.set(x + offset, y, top + MARKER_STEM / 2);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 16, 12), material.clone());
      ball.position.set(x + offset, y, top + MARKER_STEM + MARKER_RADIUS);
      this.buildings.add(stem, ball);
    });
  }

  private clear(): void {
    this.triangles.clear();
    this.meshes.length = 0;
    this.highlight = null;
    for (const child of [...this.buildings.children]) {
      this.buildings.remove(child);
      const object = child as THREE.Mesh | THREE.LineSegments;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}
