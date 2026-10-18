import type { PylovoGridData } from "@/features/configurator/types/area-select";
import { pylovoService } from "@/features/configurator/services/pylovoService";

/** One station of a pylovo site, as GET and PUT /sites/{id}/transformers carry it. */
export interface SiteStation {
    /** null adds a new user station. */
    transformer_id: number | null;
    geom: GeoJSON.Point;
    rated_kva: number | null;
    cost_eur: number | null;
    assigned_building_ids: number[];
}

/**
 * Returns every station of the shown site grid as a site station, keyed by its
 * grid_result_id, so an edit keeps the layout the user sees. A station the
 * generator placed has no site transformer yet and becomes a user station at
 * its position and rating. Stored stations missing from the grid are kept too.
 */
export const stationsFromGrid = (stored: SiteStation[], grid: PylovoGridData): Map<string, SiteStation> => {
    const byId = new Map(stored.map(s => [s.transformer_id, s]));
    const stations = new Map<string, SiteStation>();
    for (const feature of grid.transformers?.features ?? []) {
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const storedStation = byId.get(props.site_transformer_id as number);
        if (storedStation) {
            byId.delete(storedStation.transformer_id);
            stations.set(String(props.grid_result_id), { ...storedStation, assigned_building_ids: [...storedStation.assigned_building_ids] });
            continue;
        }
        stations.set(String(props.grid_result_id), {
            transformer_id: null,
            geom: feature.geometry as unknown as GeoJSON.Point,
            rated_kva: typeof props.rated_power_kva === "number" ? props.rated_power_kva : null,
            cost_eur: null,
            assigned_building_ids: [],
        });
    }
    byId.forEach((s, id) => stations.set(`stored:${id}`, s));
    return stations;
};

/** Returns the site building ids of the given osm ids in the shown grid; an unknown osm id throws. */
export const siteBuildingIds = (grid: PylovoGridData, osmIds: string[]): number[] => {
    const byOsm = new Map<string, number>();
    for (const feature of grid.buildings?.features ?? []) {
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        if (typeof props.building_id === "number") byOsm.set(String(props.osm_id), props.building_id);
    }
    return osmIds.map(osm => {
        const id = byOsm.get(osm);
        if (id === undefined) throw new Error(`Building ${osm} is not part of this site`);
        return id;
    });
};

/** Fixes the buildings to the station shown as targetGridId, taking them off any other station. */
export const assignToStation = (stations: Map<string, SiteStation>, buildingIds: number[], targetGridId: number): SiteStation[] => {
    const target = stations.get(String(targetGridId));
    if (!target) throw new Error(`Transformer ${targetGridId} is not part of this site`);
    const moving = new Set(buildingIds);
    stations.forEach(s => { s.assigned_building_ids = s.assigned_building_ids.filter(b => !moving.has(b)); });
    target.assigned_building_ids.push(...buildingIds);
    return [...stations.values()];
};

/** Adds a user station at [lon, lat] to the site, keeping the shown stations; the site needs regenerating afterwards. */
export const addSiteStation = async (siteId: number, grid: PylovoGridData, coordinates: [number, number], kva: number): Promise<void> => {
    const stations = stationsFromGrid(await pylovoService.getSiteTransformers(siteId), grid);
    await pylovoService.putSiteTransformers(siteId, [...stations.values(), {
        transformer_id: null, geom: { type: "Point", coordinates }, rated_kva: kva, cost_eur: null, assigned_building_ids: [],
    }]);
};

/** Fixes the buildings to a shown station of the site; the site needs regenerating afterwards. */
export const assignSiteBuildings = async (siteId: number, grid: PylovoGridData, osmIds: string[], targetGridId: number): Promise<void> => {
    const stations = stationsFromGrid(await pylovoService.getSiteTransformers(siteId), grid);
    await pylovoService.putSiteTransformers(siteId, assignToStation(stations, siteBuildingIds(grid, osmIds), targetGridId));
};
