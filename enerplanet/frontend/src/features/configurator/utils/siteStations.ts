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

/** A position to about 1 cm; pylovo stores stations in EPSG:3035, so a stored position comes back slightly rounded. */
const positionKey = (coordinates: number[]): string => coordinates.map(c => c.toFixed(7)).join(",");

/**
 * Returns every station of the shown site grid as a site station, keyed by its
 * grid_result_id, so an edit keeps the layout the user sees. A station the
 * generator placed has no site transformer yet and becomes a user station at
 * its position and rating. Stored stations missing from the grid are kept too.
 *
 * A shown station the stored list no longer holds is left out: an edit since
 * generation moved or deleted it, and the generator places stations again where
 * buildings are left without one.
 */
export const stationsFromGrid = (stored: SiteStation[], grid: PylovoGridData, editedSinceGeneration = false): Map<string, SiteStation> => {
    const byId = new Map(stored.map(s => [s.transformer_id, s]));
    // A generated station an earlier edit already stored, before the site was
    // regenerated, is found by its position, so it is not stored twice.
    const byPosition = new Map(stored.map(s => [positionKey(s.geom.coordinates), s]));
    const stations = new Map<string, SiteStation>();
    for (const feature of grid.transformers?.features ?? []) {
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const position = positionKey((feature.geometry as unknown as GeoJSON.Point).coordinates ?? []);
        const storedStation = byId.get(props.site_transformer_id as number)
            ?? (props.site_transformer_id == null ? byPosition.get(position) : undefined);
        if (storedStation) {
            byId.delete(storedStation.transformer_id);
            stations.set(String(props.grid_result_id), { ...storedStation, assigned_building_ids: [...storedStation.assigned_building_ids] });
            continue;
        }
        if (props.site_transformer_id != null || editedSinceGeneration) continue;
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
    const target = stationShownAs(stations, targetGridId);
    const moving = new Set(buildingIds);
    stations.forEach(s => { s.assigned_building_ids = s.assigned_building_ids.filter(b => !moving.has(b)); });
    target.assigned_building_ids.push(...buildingIds);
    return [...stations.values()];
};

/** Returns the station shown as gridId; one already moved or deleted since generation throws. */
const stationShownAs = (stations: Map<string, SiteStation>, gridId: number): SiteStation => {
    const station = stations.get(String(gridId));
    if (!station) throw new Error(`Transformer ${gridId} is not part of this site`);
    return station;
};

/** Reads the site's stations as the next edit starts from them. */
const loadStations = async (siteId: number, grid: PylovoGridData): Promise<Map<string, SiteStation>> => {
    const [stored, site] = await Promise.all([pylovoService.getSiteTransformers(siteId), pylovoService.getSite(siteId)]);
    return stationsFromGrid(stored, grid, site.revision !== site.generated_revision);
};

/** Adds a user station at [lon, lat] to the site, keeping the shown stations; the site needs regenerating afterwards. */
export const addSiteStation = async (siteId: number, grid: PylovoGridData, coordinates: [number, number], kva: number): Promise<void> => {
    const stations = await loadStations(siteId, grid);
    await pylovoService.putSiteTransformers(siteId, [...stations.values(), {
        transformer_id: null, geom: { type: "Point", coordinates }, rated_kva: kva, cost_eur: null, assigned_building_ids: [],
    }]);
};

/** Fixes the buildings to a shown station of the site; the site needs regenerating afterwards. */
export const assignSiteBuildings = async (siteId: number, grid: PylovoGridData, osmIds: string[], targetGridId: number): Promise<void> => {
    const stations = await loadStations(siteId, grid);
    await pylovoService.putSiteTransformers(siteId, assignToStation(stations, siteBuildingIds(grid, osmIds), targetGridId));
};

/** Moves a shown station of the site to [lon, lat], keeping its rating and buildings; the site needs regenerating afterwards. */
export const moveSiteStation = async (siteId: number, grid: PylovoGridData, gridId: number, coordinates: [number, number]): Promise<void> => {
    const stations = await loadStations(siteId, grid);
    stationShownAs(stations, gridId).geom = { type: "Point", coordinates };
    await pylovoService.putSiteTransformers(siteId, [...stations.values()]);
};

/** Removes a shown station from the site; its fixed buildings are assigned again when the site is regenerated. */
export const removeSiteStation = async (siteId: number, grid: PylovoGridData, gridId: number): Promise<void> => {
    const stations = await loadStations(siteId, grid);
    stationShownAs(stations, gridId);
    stations.delete(String(gridId));
    await pylovoService.putSiteTransformers(siteId, [...stations.values()]);
};
