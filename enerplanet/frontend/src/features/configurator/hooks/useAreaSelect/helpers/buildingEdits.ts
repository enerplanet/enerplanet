import type { Feature } from "ol";
import { containsCoordinate } from "ol/extent";
import GeoJSON from "ol/format/GeoJSON";
import { MultiPolygon, Polygon, type Geometry } from "ol/geom";
import type { Coordinate } from "ol/coordinate";

import type { PylovoGridData } from "@/features/configurator/types/area-select";
import { getDataProjection } from "@/features/configurator/utils/gridLayerUtils";

type GridBuilding = NonNullable<PylovoGridData["buildings"]>["features"][number];
type Edits = Record<string, unknown>;

/** Building properties the user sets in the configurator, rather than pylovo. */
const USER_BUILDING_KEYS = ["techs", "heat_supplier", "buem", "activated"] as const;

// The configurator map keeps OpenLayers' default view projection.
const MAP_PROJECTION = "EPSG:3857";

/**
 * Copies the user's per-building edits from the buildings on the map onto a
 * regenerated grid. A grid is regenerated for every polygon at once, so without
 * this, editing one polygon drops the edits in all of them.
 *
 * Buildings match by osm_id. The default grid uses OSM ids and the custom grid
 * 3D building ids, so after a grid mode switch a building takes the edits of the
 * earlier building that contains its interior point. Heat links follow the
 * producer to its new id; BuEM edits describe a footprint and stay with the id.
 */
export function carryOverBuildingEdits(previous: Feature<Geometry>[], next: PylovoGridData): PylovoGridData {
    const edits = editsById(previous);
    const features = next.buildings?.features;
    if (edits.size === 0 || !features) return next;

    const donors = previous.filter((f) => edits.has(idOf(f.get("osm_id"))));
    const projection = getDataProjection(next.buildings);
    const sources = features.map((f) => {
        const id = idOf(f.properties?.osm_id);
        return edits.has(id) ? id : containingBuilding(donors, f, projection);
    });
    const newIds = new Map<string, string>();
    sources.forEach((source, i) => {
        if (source && !newIds.has(source)) newIds.set(source, idOf(features[i].properties?.osm_id));
    });

    return {
        ...next,
        buildings: {
            ...next.buildings!,
            features: features.map((f, i) => {
                const source = sources[i];
                if (!source) return f;
                const kept = carried(edits.get(source)!, source === idOf(f.properties?.osm_id), newIds);
                return { ...f, properties: { ...f.properties, ...kept } };
            }),
        },
    };
}

const idOf = (osmId: unknown): string => String(osmId);

/** The user's edits per osm_id, for buildings that have any. */
function editsById(features: Feature<Geometry>[]): Map<string, Edits> {
    const edits = new Map<string, Edits>();
    for (const feature of features) {
        const kept: Edits = {};
        for (const key of USER_BUILDING_KEYS) {
            const value = feature.get(key);
            if (value !== undefined) kept[key] = value;
        }
        if (Object.keys(kept).length > 0) edits.set(idOf(feature.get("osm_id")), kept);
    }
    return edits;
}

/** The edits a building takes over; sameBuilding is false after a match by location. */
function carried(edits: Edits, sameBuilding: boolean, newIds: Map<string, string>): Edits {
    const { buem, heat_supplier, ...rest } = edits;
    const kept: Edits = { ...rest };
    if (sameBuilding && buem !== undefined) kept.buem = buem;
    if (heat_supplier !== undefined) kept.heat_supplier = newIds.get(idOf(heat_supplier)) ?? heat_supplier;
    return kept;
}

/** The osm_id of the map building containing the grid building's interior point. */
function containingBuilding(donors: Feature<Geometry>[], building: GridBuilding, dataProjection: string): string | undefined {
    const point = interiorPoint(building, dataProjection);
    if (!point) return undefined;
    const donor = donors.find((f) => {
        const geometry = f.getGeometry();
        return geometry !== undefined && containsCoordinate(geometry.getExtent(), point) && geometry.intersectsCoordinate(point);
    });
    return donor ? idOf(donor.get("osm_id")) : undefined;
}

/** A point inside the building's footprint, in the map projection. */
function interiorPoint(building: GridBuilding, dataProjection: string): Coordinate | undefined {
    if (!building.geometry) return undefined;
    const geometry = new GeoJSON().readGeometry(building.geometry, { dataProjection, featureProjection: MAP_PROJECTION });
    if (geometry instanceof Polygon) return geometry.getInteriorPoint().getCoordinates().slice(0, 2);
    if (geometry instanceof MultiPolygon) return geometry.getInteriorPoints().getFirstCoordinate().slice(0, 2);
    return undefined;
}
