import { point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
// Ensure this path matches your minified GeoJSON file location
import countryData from './geocodes.json';

export interface GeocodingResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  source: string;
  geojson?: GeoJSON.GeoJsonObject;
}

/**
 * Geocoding service using Nominatim (OpenStreetMap)
 * This replaces the backend Go geocoding service
 */
class GeocodingService {
  private readonly baseUrl = 'https://nominatim.openstreetmap.org';
  private readonly userAgent = 'StorcitApp/1.0';

  /**
   * Helper to get country code from local GeoJSON backup
   */
  private getLocalCountry(latitude: number, longitude: number): string {
    try {
      const pt = point([longitude, latitude]);
      for (const item of (countryData as any)) {
        if (item.area && booleanPointInPolygon(pt, item.area)) {
          return item.cc.toUpperCase();
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Local geocoding lookup failed:', error);
    }
    return 'Unknown';
  }

  /**
   * Search for locations using Nominatim geocoding
   * @param query - Search query string
   * @returns Promise with array of geocoding results
   */
  async search(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return [];

    try {
      const url = `${this.baseUrl}/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1&polygon_geojson=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      const data: unknown = await response.json();

      type NominatimItem = {
        place_id?: number;
        display_name?: string;
        lat: string;
        lon: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          country?: string;
        };
        geojson?: GeoJSON.GeoJsonObject;
      };

      if (!Array.isArray(data) || data.length === 0) {
        return [{
          id: `fallback-${Date.now()}`,
          name: query,
          latitude: 0,
          longitude: 0,
          source: 'fallback',
        }];
      }

      return (data as NominatimItem[]).map((item, index: number) => {
        const displayParts = [];

        if (item.address?.city) displayParts.push(item.address.city);
        else if (item.address?.town) displayParts.push(item.address.town);
        else if (item.address?.village) displayParts.push(item.address.village);

        if (item.address?.state) displayParts.push(item.address.state);
        if (item.address?.country) displayParts.push(item.address.country);

        let name = displayParts.length > 0
          ? displayParts.join(', ')
          : (item.display_name || "");

        if (!name) name = `Location ${item.lat}, ${item.lon}`;

        return {
          id: `nominatim-${item.place_id || index}`,
          name: name,
          latitude: Number.parseFloat(item.lat),
          longitude: Number.parseFloat(item.lon),
          source: 'nominatim',
          geojson: item.geojson,
        };
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Geocoding search failed:', error);
      return [{
        id: `error-fallback-${Date.now()}`,
        name: query,
        latitude: 0,
        longitude: 0,
        source: 'error-fallback',
      }];
    }
  }

  /**
   * Reverse geocode: get location name from coordinates
   * @param latitude - Latitude coordinate
   * @param longitude - Longitude coordinate
   * @returns Promise with location name
   */
  async reverse(latitude: number, longitude: number): Promise<string> {
    try {
      const url = `${this.baseUrl}/reverse?format=json&lat=${latitude}&lon=${longitude}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return this.getLocalCountry(latitude, longitude);
      }

      const data = await response.json();
      return data.display_name || this.getLocalCountry(latitude, longitude);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Reverse geocoding failed:', error);
      return this.getLocalCountry(latitude, longitude);
    }
  }

  /**
   * Reverse geocode: get region and country from coordinates
   * @param latitude - Latitude coordinate
   * @param longitude - Longitude coordinate
   * @returns Promise with region (formatted as "City, State, Country") and country info
   */
  async reverseRegion(latitude: number, longitude: number): Promise<{ region: string; country: string }> {
    try {
      const url = `${this.baseUrl}/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        const country = this.getLocalCountry(latitude, longitude);
        return { region: country, country };
      }

      const data = await response.json();
      const address = data.address || {};

      // Build a detailed location string: "City, State, Country"
      const parts: string[] = [];

      // Add city/town/village
      const city = address.city || address.town || address.village || address.municipality || '';
      if (city) parts.push(city);

      // Add state/region (if different from city)
      const state = address.state || address.county || '';
      if (state && state !== city) parts.push(state);

      // Add country
      let country = address.country || '';
      if (!country) {
        country = this.getLocalCountry(latitude, longitude);
      }
      if (country) parts.push(country);

      // Join with comma and space
      const region = parts.length > 0 ? parts.join(', ') : this.getLocalCountry(latitude, longitude);

      return { region, country: country || 'Unknown' };
    } catch (error) {
      if (import.meta.env.DEV) console.error('Reverse geocoding for region failed:', error);
      const country = this.getLocalCountry(latitude, longitude);
      return { region: country, country };
    }
  }
}

export const geocodingService = new GeocodingService();

