import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import { Polygon } from "ol/geom";
import { getCenter } from "ol/extent";
import GeoJSON from "ol/format/GeoJSON";
import { toLonLat } from "ol/proj";

import type { PylovoGridData } from "@/features/configurator/types/area-select";
import type { SiteStation } from "@/features/configurator/utils/siteStations";

/** Leaves a site building out of the grid, or takes it back in, by its osm_id in the site grid. */
export interface BuildingExclusion {
    osm_id: string;
    excluded: boolean;
}

type GridFeature = { type?: string; geometry?: unknown; properties?: Record<string, unknown> | null };

/** Properties that tie a building to a transformer or a site building of the grid it came from. */
const GRID_LINK_KEYS = ["grid_result_id", "transformer_id", "trafo_id", "building_id"];

const isDisabled = (feature: Feature<Geometry>): boolean => feature.get("activated") === false;

/**
 * The buildings whose disabled state on the map differs from the one the shown
 * grid was generated with; generated holds the grid's building features, which
 * record a building disabled at generation as activated: false.
 */
export const exclusionChanges = (generated: GridFeature[], current: Feature<Geometry>[]): BuildingExclusion[] => {
    const wasDisabled = new Map(generated.map((f) => [String(f.properties?.osm_id), f.properties?.activated === false]));
    const changes: BuildingExclusion[] = [];
    for (const feature of current) {
        const osmId = String(feature.get("osm_id"));
        const disabled = isDisabled(feature);
        if (wasDisabled.has(osmId) && wasDisabled.get(osmId) !== disabled) changes.push({ osm_id: osmId, excluded: disabled });
    }
    return changes;
};

/** The osm ids of the disabled buildings on the map. */
export const disabledOsmIds = (current: Feature<Geometry>[]): Set<string> =>
    new Set(current.filter(isDisabled).map((f) => String(f.get("osm_id"))));

/** Takes the buildings off the stations they are fixed to, or returns null when none was. */
export const withoutAssignments = (stations: SiteStation[], buildingIds: number[]): SiteStation[] | null => {
    const freed = new Set(buildingIds);
    if (!stations.some((s) => s.assigned_building_ids.some((b) => freed.has(b)))) return null;
    return stations.map((s) => ({ ...s, assigned_building_ids: s.assigned_building_ids.filter((b) => !freed.has(b)) }));
};

/**
 * Adds to next the disabled buildings of previous that it leaves out, as a
 * site grid does with excluded buildings, so they stay on the map and can be
 * enabled again. They are unlinked from previous's transformers.
 */
export const keepDisabledBuildings = (
    previous: PylovoGridData | undefined,
    next: PylovoGridData,
    disabled: Set<string>,
    inArea: (feature: GridFeature) => boolean = () => true,
): PylovoGridData => {
    const shown = new Set((next.buildings?.features ?? []).map((f) => String(f.properties?.osm_id)));
    const kept = (previous?.buildings?.features ?? [])
        .filter((f) => {
            const osmId = String(f.properties?.osm_id);
            return disabled.has(osmId) && !shown.has(osmId) && inArea(f);
        })
        .map((f) => {
            const properties: Record<string, unknown> = { ...f.properties, activated: false };
            GRID_LINK_KEYS.forEach((key) => delete properties[key]);
            // Feature ids are per-response indices; OpenLayers skips a feature whose id is already in the source.
            const { id: _id, ...feature } = f as GridFeature & { id?: unknown };
            return { ...feature, properties };
        });
    if (kept.length === 0) return next;
    return {
        ...next,
        buildings: { type: "FeatureCollection", ...next.buildings, features: [...(next.buildings?.features ?? []), ...kept] },
    } as PylovoGridData;
};

/**
 * Tests whether a building of a grid in dataProjection lies in the drawn lon/lat
 * area, by the centre of its outline.
 */
export const insideArea = (polygons: [number, number][][], dataProjection: "EPSG:4326" | "EPSG:3857") => {
    const area = polygons.filter((p) => p.length >= 3).map((p) => new Polygon([[...p, p[0]]]));
    const format = new GeoJSON();
    return (feature: GridFeature): boolean => {
        if (!feature.geometry) return false;
        const centre = getCenter(format.readGeometry(feature.geometry).getExtent());
        const lonLat = dataProjection === "EPSG:3857" ? toLonLat(centre) : centre;
        return area.some((p) => p.intersectsCoordinate(lonLat));
    };
};
