/**
 * The 3D view, in two parts.
 *
 * **The city's own buildings** are the fallback: they come from the basemap's vector tiles, so a tilted map reads
 * as a city before anything has been modelled.
 *
 * **A module layer's volumes** are the buildings in hand — the grid's `buildings` are the ones inside the drawn
 * area — and they replace the city's the moment they have data.
 *
 * Exactly one of the two is ever drawn, and that is the whole reason this file exists. Two volumes on the same
 * footprint is a z-fight, and the faint one under the solid one reads as a rendering bug; showing the city's
 * buildings everywhere *and* the area's on top is the thing that looked broken.
 *
 * Masking the basemap to the area instead is not expressible: MapLibre has no polygon-to-polygon spatial filter
 * (`["within", …]` evaluates points and lines only), so "show the tiles, but not outside this polygon" has no
 * style-level answer. A separate layer with its own visibility does.
 *
 * The specs are built here rather than in the canvas so they can be tested without a map, which is the same reason
 * `capture.ts` holds the drawing arithmetic.
 */

import type { FilterSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { LayerExtrusion, MapStack } from "@model-builder/core";

/** The city's own buildings, as one layer the canvas can show and hide. */
export const CITY_3D_LAYER_ID = "mb-buildings-3d";

/** The extrusion layer that follows a module layer's fill, line and circle. */
export const extrusionIdOf = (layerId: string): string => `mb-layer-${layerId}-extrusion`;

/**
 * The opacity a volume reaches once the map is properly tilted.
 *
 * Solid, not merely visible: these are buildings, and anything faint reads as one more translucent thing on a map
 * that already has several.
 */
export const FULL_EXTRUSION_OPACITY = 1;

/**
 * The pitch, in degrees, at which a volume reaches that opacity.
 *
 * Deliberately shallow: tilting is how a user asks for the volumes, so a modest right-drag has to be enough and a
 * map tilted only slightly should not still look flat.
 */
export const FULL_EXTRUSION_PITCH = 12;

/** The source-layer MapLibre's own building layer is drawn from; the city's volumes read the same geometry. */
const BUILDING_SOURCE_LAYER = "building";

/**
 * Height in metres for a building whose tile carries none.
 *
 * OpenMapTiles buildings carry `render_height`, but a style may draw from a source that does not, and a uniform
 * volume reads better than a map that looks unchanged when tilted.
 */
export const DEFAULT_BUILDING_HEIGHT_M = 8;

/** The colour the legacy map gives a building wall, so the city's volumes read the same in both maps. */
const WALL_COLOR = "#e6e0d6";

/**
 * How visible a volume is at this pitch: **nothing at all when flat**, then linear to full.
 *
 * The zero at pitch 0 is a contract, not a taste: it is what makes the 2D map identical to a map built without
 * these layers, and it keeps the drawing flows — which are 2D — on a flat surface.
 */
export function extrusionOpacityAt(pitch: number, fullOpacity: number = FULL_EXTRUSION_OPACITY): number {
  if (!Number.isFinite(pitch) || pitch <= 0) return 0;
  if (pitch >= FULL_EXTRUSION_PITCH) return fullOpacity;
  return (pitch / FULL_EXTRUSION_PITCH) * fullOpacity;
}

/**
 * The polygons of a layer, with points and lines left out.
 *
 * **Not `["==", ["geometry-type"], "Polygon"]`** — which is what this started as. MapLibre validates that
 * comparison against the JSON geometry types, so naming `Polygon` there *excludes every `MultiPolygon`* without a
 * word: a building whose footprint is an outer ring plus a courtyard is a MultiPolygon, so only the plain-polygon
 * buildings ever stood up — one solid building on a street of them. Comparing against `LineString` instead keeps
 * both polygon types and still drops the lines a grid puts on the same source, which is why the filter exists.
 */
export const POLYGON_FILTER: FilterSpecification = ["!=", ["geometry-type"], "LineString"];

/**
 * Whether any module layer stands up volumes of its own — which is what retires the city's buildings.
 *
 * A layer that *declares* an extrusion but holds no features does not count. The grid declares its buildings
 * before it has any, and the city's own 3D must not blink out while the area is still empty; it is the arrival of
 * features, not the declaration, that means there is something to look at.
 */
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

/**
 * The city's own buildings as volumes, and where in the stack they belong.
 *
 * `beforeId` is the layer directly above the style's building polygons, so the volumes sit where the flat
 * footprints were and roads, labels and every module layer stay on top of them. `undefined` means the buildings
 * are the last thing in the style, which means the same thing to `addLayer`.
 */
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

/**
 * The volume for one module layer.
 *
 * Height comes from a feature property where the data has one, and from `fallback` where it does not — so a module
 * can extrude a layer before it knows any real heights, which is the case for the grid's buildings.
 */
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
