import type { Feature } from "ol";
import type { Geometry } from "ol/geom";

import type { PylovoGridData } from "@/features/configurator/types/area-select";

/** Building properties the user sets in the configurator, rather than pylovo. */
const USER_BUILDING_KEYS = ["techs", "heat_supplier", "buem", "activated"] as const;

/**
 * Copies the user's per-building edits from the buildings on the map onto a
 * regenerated grid, matched by osm_id. A grid is regenerated for every polygon
 * at once, so without this, editing one polygon drops the edits in all of them.
 */
export function carryOverBuildingEdits(previous: Feature<Geometry>[], next: PylovoGridData): PylovoGridData {
    const edits = new Map<string, Record<string, unknown>>();
    for (const feature of previous) {
        const kept: Record<string, unknown> = {};
        for (const key of USER_BUILDING_KEYS) {
            const value = feature.get(key);
            if (value !== undefined) kept[key] = value;
        }
        if (Object.keys(kept).length > 0) edits.set(String(feature.get("osm_id")), kept);
    }
    if (edits.size === 0 || !next.buildings?.features) return next;
    return {
        ...next,
        buildings: {
            ...next.buildings,
            features: next.buildings.features.map((f) => {
                const kept = edits.get(String(f.properties?.osm_id));
                return kept ? { ...f, properties: { ...f.properties, ...kept } } : f;
            }),
        },
    };
}
