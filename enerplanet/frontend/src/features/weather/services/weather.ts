import axios from '@/lib/axios';
import { isAxiosError } from 'axios';
import { WeatherResponse, WeatherError, CurrentWeatherResponse } from '@/features/weather/types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

type WeatherParams = { lat?: number; lon?: number };

class WeatherService {
  async getWeather(lat?: number, lon?: number): Promise<WeatherResponse> {
    try {
      const params: WeatherParams | undefined =
        typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : undefined;
      const response = await axios.get<ApiResponse<WeatherResponse>>('/weather', { params });
      return response.data.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        const data = error.response?.data as unknown;
        if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
          const errorData = data as WeatherError;
          throw new Error(errorData.error);
        }
      }
      throw new Error('Failed to fetch weather data');
    }
  }

  async getCurrentWeather(lat?: number, lon?: number): Promise<CurrentWeatherResponse> {
    try {
      const params: WeatherParams | undefined =
        typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : undefined;
      const response = await axios.get<ApiResponse<CurrentWeatherResponse>>('/weather/current', { params });
      return response.data.data;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        const data = error.response?.data as unknown;
        if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
          throw new Error((data as WeatherError).error);
        }
      }
      throw new Error('Failed to fetch current weather data');
    }
  }
}

export const weatherService = new WeatherService();
