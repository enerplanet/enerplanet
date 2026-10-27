import { pylovoService, CustomBuilding } from '@/features/configurator/services/pylovoService';

type FClass = string;

export interface CustomLocation {
  id: number;
  user_id: string;
  osm_id: string;
  title: string;
  f_class: FClass;
  area: number;
  demand_energy: number;
  geometry: GeoJSON.Point;
  geometry_area: GeoJSON.Polygon;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CustomLocationCreateRequest {
  title: string;
  f_class: FClass;
  area: number;
  demand_energy: number;
  geometry: GeoJSON.Point;
  geometry_area: GeoJSON.Polygon;
  tags?: string[];
}

export interface CustomLocationUpdateRequest {
  title?: string;
  f_class?: string;
  area?: number;
  demand_energy?: number;
  geometry?: GeoJSON.Point;
  geometry_area?: GeoJSON.Polygon;
  tags?: string[];
}

interface CustomLocationListResponse {
  data: CustomLocation[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Convert PyLovo CustomBuilding to our CustomLocation format
function convertToCustomLocation(building: CustomBuilding): CustomLocation {
  return {
    id: building.id,
    user_id: building.user_id,
    osm_id: `custom_${building.id}`,
    title: building.title,
    f_class: building.f_class,
    area: building.area,
    demand_energy: building.demand_energy,
    geometry: building.geometry,
    geometry_area: building.geometry_area,
    tags: [],
    status: 'active',
    created_at: building.created_at,
    updated_at: building.created_at,
  };
}

class CustomLocationService {
  private _buildingsCache: { data: CustomBuilding[]; timestamp: number } | null = null;
  private _pendingFetch: Promise<CustomBuilding[]> | null = null;
  private readonly CACHE_TTL = 5000; // 5 seconds

  /** Get buildings with short-lived cache to avoid redundant calls */
  private async getCachedBuildings(): Promise<CustomBuilding[]> {
    if (this._buildingsCache && Date.now() - this._buildingsCache.timestamp < this.CACHE_TTL) {
      return this._buildingsCache.data;
    }

    if (this._pendingFetch) return this._pendingFetch;

    this._pendingFetch = (async () => {
      try {
        const data = await pylovoService.getCustomBuildings();
        this._buildingsCache = { data, timestamp: Date.now() };
        return data;
      } finally {
        this._pendingFetch = null;
      }
    })();

    return this._pendingFetch;
  }

  invalidateCache(): void {
    this._buildingsCache = null;
  }

  /**
   * Get all locations for the current user (from PyLovo)
   */
  async getUserLocations(_options?: { per_page?: number; page?: number }): Promise<CustomLocationListResponse> {
    const buildings = await this.getCachedBuildings();
    // Only return buildings owned by the current user
    const locations = buildings
      .filter(b => b.is_owner)
      .map(convertToCustomLocation);

    return {
      data: locations,
      total: locations.length,
      page: 1,
      per_page: locations.length,
      total_pages: 1,
    };
  }

  /**
   * Get user locations as GeoJSON FeatureCollection
   */
  async getLocationsAsGeoJSON(): Promise<GeoJSON.FeatureCollection> {
    const buildings = await this.getCachedBuildings();

    const features: GeoJSON.Feature[] = buildings.map(building => ({
      type: 'Feature',
      geometry: building.geometry_area,
      properties: {
        id: building.id,
        osm_id: `custom_${building.id}`,
        title: building.title,
        feature_type: 'CustomLocation',
        f_class: building.f_class,
        area: building.area,
        demand_energy: building.demand_energy,
        created_at: building.created_at,
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  /**
   * Get a single location by ID
   */
  async getLocation(id: number): Promise<CustomLocation> {
    const buildings = await this.getCachedBuildings();
    const building = buildings.find(b => b.id === id);

    if (!building) {
      throw new Error('Location not found');
    }

    return convertToCustomLocation(building);
  }

  /**
   * Create a new custom location (saves to PyLovo database)
   */
  async createLocation(location: CustomLocationCreateRequest): Promise<CustomLocation> {
    const result = await pylovoService.addCustomBuilding({
      title: location.title,
      f_class: location.f_class,
      area: location.area,
      demand_energy: location.demand_energy,
      geometry: location.geometry,
      geometry_area: location.geometry_area,
    });

    this.invalidateCache();

    // Return a partial location with the new ID
    return {
      id: result.building_id,
      user_id: '',
      osm_id: `custom_${result.building_id}`,
      title: location.title,
      f_class: location.f_class,
      area: location.area,
      demand_energy: location.demand_energy,
      geometry: location.geometry,
      geometry_area: location.geometry_area,
      tags: location.tags || [],
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async updateLocation(id: number, updates: CustomLocationUpdateRequest): Promise<CustomLocation> {
    // Get existing location
    const existing = await this.getLocation(id);

    // Delete old one
    await pylovoService.deleteCustomBuilding(id);
    this.invalidateCache();

    // Create new one with updates
    const newLocation: CustomLocationCreateRequest = {
      title: updates.title || existing.title,
      f_class: updates.f_class || existing.f_class,
      area: updates.area ?? existing.area,
      demand_energy: updates.demand_energy ?? existing.demand_energy,
      geometry: updates.geometry || existing.geometry,
      geometry_area: updates.geometry_area || existing.geometry_area,
      tags: updates.tags || existing.tags,
    };

    return this.createLocation(newLocation);
  }

  /**
   * Delete a location
   */
  async deleteLocation(id: number): Promise<void> {
    await pylovoService.deleteCustomBuilding(id);
    this.invalidateCache();
  }

  /**
   * Copy a location
   */
  async copyLocation(id: number): Promise<CustomLocation> {
    const existing = await this.getLocation(id);

    return this.createLocation({
      title: `${existing.title} (Copy)`,
      f_class: existing.f_class,
      area: existing.area,
      demand_energy: existing.demand_energy,
      geometry: existing.geometry,
      geometry_area: existing.geometry_area,
      tags: existing.tags,
    });
  }

}

export const customLocationService = new CustomLocationService();
