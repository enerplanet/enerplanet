import axios from '@/lib/axios';

interface UserSettings {
  [key: string]: string;
}

interface WeatherLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  source?: string;
}

interface WeatherLocationData {
  location: WeatherLocation;
  customLocations: WeatherLocation[];
}

interface MapLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  zoom?: number;
  source?: string;
}

interface MapLocationData {
  location: MapLocation;
  savedLocations: MapLocation[];
}

class SettingsService {
  private readonly BASE_PATH = '/settings';
  private _settingsCache: { data: UserSettings; timestamp: number } | null = null;
  private _pendingFetch: Promise<UserSettings> | null = null;
  private readonly CACHE_TTL = 5000; // 5 seconds

  /**
   * Get all user settings as a key-value map
   */
  async getAllSettings(): Promise<UserSettings> {
    // Return cached data if fresh
    if (this._settingsCache && Date.now() - this._settingsCache.timestamp < this.CACHE_TTL) {
      return this._settingsCache.data;
    }

    // Deduplicate concurrent requests
    if (this._pendingFetch) return this._pendingFetch;

    this._pendingFetch = (async () => {
      try {
        const response = await axios.get<{ success: boolean; data: UserSettings }>(this.BASE_PATH);
        const data = response.data.data || {};
        this._settingsCache = { data, timestamp: Date.now() };
        return data;
      } catch {
        if (import.meta.env.DEV) console.error('Failed to fetch user settings');
        return {};
      } finally {
        this._pendingFetch = null;
      }
    })();

    return this._pendingFetch;
  }

  /** Invalidate settings cache (call after writing settings) */
  invalidateCache(): void {
    this._settingsCache = null;
  }

  /**
   * Get a specific setting by key
   */
  async getSetting(key: string): Promise<string | null> {
    try {
      const response = await axios.get<{ success: boolean; data: { key: string; value: string } }>(
        `${this.BASE_PATH}/${key}`
      );
      return response.data.data?.value || null;
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } }).response?.status === 404) {
        return null;
      }
      if (import.meta.env.DEV) console.error(`Failed to fetch setting ${key}`);
      return null;
    }
  }

  /**
   * Set or update a setting
   */
  async setSetting(key: string, value: string): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(
        `${this.BASE_PATH}/${key}`,
        { value }
      );
      this.invalidateCache();
      return true;
    } catch {
      if (import.meta.env.DEV) console.error(`Failed to set setting ${key}`);
      return false;
    }
  }

  /**
   * Delete a specific setting
   */
  async deleteSetting(key: string): Promise<boolean> {
    try {
      await axios.delete<{ success: boolean }>(`${this.BASE_PATH}/${key}`);
      this.invalidateCache();
      return true;
    } catch {
      if (import.meta.env.DEV) console.error(`Failed to delete setting ${key}`);
      return false;
    }
  }

  /**
   * Delete all user settings
   */
  async deleteAllSettings(): Promise<boolean> {
    try {
      await axios.delete<{ success: boolean }>(this.BASE_PATH);
      this.invalidateCache();
      return true;
    } catch {
      if (import.meta.env.DEV) console.error('Failed to delete all settings');
      return false;
    }
  }

  async getWeatherLocation(): Promise<WeatherLocationData | null> {
    try {
      const settings = await this.getAllSettings();
      if (!settings.weather_location) return null;
      const parsed = JSON.parse(settings.weather_location) as unknown;
      return parsed as WeatherLocationData;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to parse weather location:', e);
      return null;
    }
  }

  async setWeatherLocation(location: WeatherLocationData): Promise<boolean> {
    try {
      const value = JSON.stringify(location);
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/weather-location`, { weather_location: value });
      this.invalidateCache();
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to save weather location:', e);
      return false;
    }
  }

  async getMapLocation(): Promise<MapLocationData | null> {
    try {
      const settings = await this.getAllSettings();
      if (!settings.map_location) return null;
      const parsed = JSON.parse(settings.map_location) as unknown;
      return parsed as MapLocationData;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to parse map location:', e);
      return null;
    }
  }

  async setMapLocation(location: MapLocationData): Promise<boolean> {
    try {
      const value = JSON.stringify(location);
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/map-location`, { map_location: value });
      this.invalidateCache();
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to save map location:', e);
      return false;
    }
  }

  async deleteWeatherLocation(): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/weather-location`, { weather_location: '' });
      this.invalidateCache();
      return true;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete weather location:', error);
      return false;
    }
  }

  async deleteMapLocation(): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/map-location`, { map_location: '' });
      this.invalidateCache();
      return true;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete map location:', error);
      return false;
    }
  }

  async getDefaultRegion(): Promise<{ name: string; gridCount: number; country?: string; bbox?: { west: number; south: number; east: number; north: number } } | null> {
    try {
      const settings = await this.getAllSettings();
      if (!settings.default_region) return null;
      return JSON.parse(settings.default_region) as { name: string; gridCount: number; country?: string; bbox?: { west: number; south: number; east: number; north: number } };
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to parse default region:', e);
      return null;
    }
  }

  async setDefaultRegion(region: { name: string; gridCount: number; country?: string; bbox?: { west: number; south: number; east: number; north: number } } | null): Promise<boolean> {
    try {
      const value = region ? JSON.stringify(region) : '';
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/default_region`, { value });
      this.invalidateCache();
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to save default region:', e);
      return false;
    }
  }

  async getNotificationPreferences(): Promise<{ email: boolean; browser: boolean }> {
    try {
      const settings = await this.getAllSettings();
      return {
        email: settings.email_notifications !== 'false',
        browser: settings.browser_notifications !== 'false',
      };
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to get notification preferences:', e);
      return { email: true, browser: true };
    }
  }

  async setNotificationPreferences(email: boolean, browser: boolean): Promise<boolean> {
    try {
      await axios.patch<{ success: boolean }>(this.BASE_PATH, {
        email_notifications: email,
        browser_notifications: browser,
      });
      this.invalidateCache();
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to save notification preferences:', e);
      return false;
    }
  }

  // Polygon Limits

  /**
   * Get all polygon limits for all access levels
   */
  async getPolygonLimits(): Promise<Record<string, number>> {
    try {
      const response = await axios.get<{ success: boolean; data: Record<string, number> }>(
        `${this.BASE_PATH}/polygon-limits`
      );
      return response.data.data || {};
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to fetch polygon limits:', e);
      // Return defaults
      return {
        very_low: 50,
        intermediate: 100,
        manager: 200,
        expert: 0,
      };
    }
  }

  /**
   * Get the polygon limit for the current user
   */
  async getMyPolygonLimit(): Promise<{ access_level: string; building_limit: number }> {
    try {
      const response = await axios.get<{ success: boolean; data: { access_level: string; building_limit: number } }>(
        `${this.BASE_PATH}/polygon-limits/me`
      );
      return response.data.data || { access_level: 'very_low', building_limit: 50 };
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to fetch my polygon limit:', e);
      return { access_level: 'very_low', building_limit: 50 };
    }
  }

  /**
   * Update polygon limits (experts only)
   */
  async updatePolygonLimits(limits: Record<string, number>): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/polygon-limits`, limits);
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to update polygon limits:', e);
      return false;
    }
  }

  /**
   * Update a single polygon limit (experts only)
   */
  async updatePolygonLimit(accessLevel: string, buildingLimit: number): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/polygon-limit`, {
        access_level: accessLevel,
        limit: buildingLimit,
      });
      return true;
    } catch (e) {
      console.error('Failed to update polygon limit:', e);
      return false;
    }
  }

  // Model Limits

  /**
   * Get all model limits for all access levels
   */
  async getModelLimits(): Promise<Record<string, number>> {
    try {
      const response = await axios.get<{ success: boolean; data: Record<string, number> }>(
        `${this.BASE_PATH}/model-limits`
      );
      return response.data.data || {};
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to fetch model limits:', e);
      // Return defaults
      return {
        very_low: 10,
        intermediate: 25,
        manager: 50,
        expert: 0,
      };
    }
  }

  /**
   * Get the model limit for the current user with usage info
   */
  async getMyModelLimit(): Promise<{
    access_level: string;
    model_limit: number;
    current_usage: number;
    remaining: number;
    is_unlimited: boolean;
  }> {
    try {
      const response = await axios.get<{
        success: boolean;
        data: {
          access_level: string;
          model_limit: number;
          current_usage: number;
          remaining: number;
          is_unlimited: boolean;
        };
      }>(`${this.BASE_PATH}/model-limits/me`);
      return response.data.data || {
        access_level: 'very_low',
        model_limit: 10,
        current_usage: 0,
        remaining: 10,
        is_unlimited: false,
      };
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to fetch my model limit:', e);
      return {
        access_level: 'very_low',
        model_limit: 10,
        current_usage: 0,
        remaining: 10,
        is_unlimited: false,
      };
    }
  }

  /**
   * Update model limits (experts only)
   */
  async updateModelLimits(limits: Record<string, number>): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/model-limits`, limits);
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to update model limits:', e);
      return false;
    }
  }

  /**
   * Update a single model limit (experts only)
   */
  async updateModelLimit(accessLevel: string, modelLimit: number): Promise<boolean> {
    try {
      await axios.put<{ success: boolean }>(`${this.BASE_PATH}/model-limit`, {
        access_level: accessLevel,
        model_limit: modelLimit,
      });
      return true;
    } catch (e) {
      console.error('Failed to update model limit:', e);
      return false;
    }
  }
}

export const settingsService = new SettingsService();
