/**
 * The 3D view, in two parts: the basemap's own buildings (the fallback) and a module layer's volumes (the
 * buildings in hand). Exactly one of the two is ever drawn, to avoid a z-fight. Specs are built here so they
 * can be tested without a map.
 */

import type { FilterSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerExtrusion, MapStack } from "@model-builder/core";

/** The city's own buildings, as one layer the canvas can show and hide. */
export const CITY_3D_LAYER_ID = "mb-buildings-3d";

/** The extrusion layer that follows a module layer's fill, line and circle. */
export const extrusionIdOf = (layerId: string): string => `mb-layer-${layerId}-extrusion`;

/** The opacity a volume reaches once the map is properly tilted — solid, not merely visible. */
export const FULL_EXTRUSION_OPACITY = 1;

/** The pitch, in degrees, at which a volume reaches that opacity — deliberately shallow. */
export const FULL_EXTRUSION_PITCH = 12;

/** The source-layer MapLibre's own building layer is drawn from; the city's volumes read the same geometry. */
const BUILDING_SOURCE_LAYER = "building";

/** Height in metres for a building whose tile carries none. */
export const DEFAULT_BUILDING_HEIGHT_M = 8;

/** The colour the legacy map gives a building wall, so the city's volumes read the same in both maps. */
const WALL_COLOR = "#e6e0d6";

/** How visible a volume is at this pitch: nothing when flat, then linear to full (zero at pitch 0 is a contract). */
export function extrusionOpacityAt(pitch: number, fullOpacity: number = FULL_EXTRUSION_OPACITY): number {
  if (!Number.isFinite(pitch) || pitch <= 0) return 0;
  if (pitch >= FULL_EXTRUSION_PITCH) return fullOpacity;
  return (pitch / FULL_EXTRUSION_PITCH) * fullOpacity;
}

/** The polygons of a layer, points and lines left out — `!= LineString` so `MultiPolygon` is not excluded. */
export const POLYGON_FILTER: FilterSpecification = ["!=", ["geometry-type"], "LineString"];

/** Whether any module layer stands up volumes of its own — a declared extrusion with no features does not count. */
export function hasOwnVolumes(stack: MapStack): boolean {
  return stack
    .getLayerOrder()
    .some((id) => stack.optionsOf(id)?.extrusion !== undefined && stack.featuresOf(id).length > 0);
}

/** The style's vector building source, or `undefined` when it draws buildings from something else. */
function buildingSource(style: StyleSpecification): { source: string; layerIndex: number } | undefined {
  const layers = style.layers ?? [];
  const layerIndex = layers.findIndex(
    (layer) => layer.type === "fill" && layer["source-layer"] === BUILDING_SOURCE_LAYER,
  );
  if (layerIndex === -1) return undefined;
  const drawn = layers[layerIndex];
  if (drawn.type !== "fill" || drawn.source === undefined) return undefined;
  if (style.sources?.[drawn.source]?.type !== "vector") return undefined;
  return { source: drawn.source, layerIndex };
}

/** The city's own buildings as volumes, and where in the stack they belong (`beforeId`, or last). */
export function cityBuildings3dLayer(
  style: StyleSpecification,
): { layer: LayerSpecification; beforeId?: string } | undefined {
  const found = buildingSource(style);
  if (found === undefined) return undefined;
  return {
    layer: {
      id: CITY_3D_LAYER_ID,
      type: "fill-extrusion",
      source: found.source,
      "source-layer": BUILDING_SOURCE_LAYER,
      paint: {
        "fill-extrusion-color": WALL_COLOR,
        "fill-extrusion-height": [
          "coalesce",
          ["get", "render_height"],
          ["get", "height"],
          DEFAULT_BUILDING_HEIGHT_M,
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": extrusionOpacityAt(0),
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeId: style.layers?.[found.layerIndex + 1]?.id,
  };
}

/** The volume for one module layer; height from a feature property where present, else `fallback`. */
export function extrusionLayer(id: string, source: string, extrusion: LayerExtrusion): LayerSpecification {
  return {
    id: extrusionIdOf(id),
    type: "fill-extrusion",
    source,
    filter: POLYGON_FILTER,
    paint: {
      "fill-extrusion-color": extrusion.color,
      "fill-extrusion-height":
        extrusion.heightFrom === undefined
          ? extrusion.fallback
          : ["coalesce", ["get", extrusion.heightFrom], extrusion.fallback],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": extrusionOpacityAt(0),
      "fill-extrusion-vertical-gradient": true,
    },
  };
}
