/**
 * The weather source the frame installs: `GET /weather/years`, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/weather/index.tsx`) and never learns which source it has. It lists
 * the years the backend can serve; no weather data is fetched here.
 */

import axios from "@/lib/axios";
import type { WeatherArchives, WeatherSource } from "../modules/weather";

/** Long enough for a cold backend, short enough that an unresponsive one is visible rather than a wait. */
const YEARS_TIMEOUT_MS = 15_000;

/** weather-serve's own spelling of the body: archives with their years, plus which one is the default. */
interface WeatherYearsBody {
  default_provider?: string;
  providers?: Record<string, number[]>;
}

export const backendWeatherSource: WeatherSource = {
  async listArchives(): Promise<WeatherArchives> {
    const response = await axios.get<{ success: boolean; data: WeatherYearsBody }>("/weather/years", {
      timeout: YEARS_TIMEOUT_MS,
    });

    const body = response.data.data;
    const archives: Record<string, number[]> = {};

    for (const [name, years] of Object.entries(body.providers ?? {})) {
      if (years.length > 0) archives[name] = [...years].sort((a, b) => a - b);
    }

    // `default_provider` absent means the backend did not say; `null` is the module's word for "leave it to the server".
    return { defaultProvider: body.default_provider ?? null, archives };
  },
};
