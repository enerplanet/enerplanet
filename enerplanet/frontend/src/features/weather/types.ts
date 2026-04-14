export interface CurrentWeatherData {
  temperature: number;
  weather_code: number;
  description: string;
  wind_speed: number;
  humidity: number;
  uv_index?: number;
}

export interface CurrentWeatherResponse {
  location: string;
  current: CurrentWeatherData;
}

interface WeatherData {
  date: string;
  max_temperature: number;
  min_temperature: number;
  weather_code: number;
  precipitation: number;
  description: string;
}

export interface WeatherResponse {
  location: string;
  forecast: WeatherData[];
}

export interface WeatherError {
  error: string;
}
