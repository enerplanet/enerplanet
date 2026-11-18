/**
 * The weather source the frame installs: `GET /weather/years`, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/weather/index.tsx`) and never learns which source it has; this is the
 * implementation a host provides. It lives in the shell beside the grid engine and for the same reason: a
 * module may only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's.
 * The module is told about this one at startup (`setWeatherSource`).
 *
 * **One call, and it is only a list.** No weather data is fetched here — the config *references* a dataset and
 * the backend retrieves the series when the model runs. The years exist so the picker is honest about what the
 * backend can actually serve; the legacy reads them from the same route (`useWeatherYears`).
 *
 * **Bodies are wrapped**, as they are for the grid: the Go proxy returns `{ success, data }`, so the payload
 * is at `response.data.data`. And as in the legacy, an archive with no years is not offered — an empty year
 * list is not a choice a user can make.
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

    // `default_provider` absent means the backend did not say; `null` is the module's word for "leave it to
    // the server", which is exactly what an unanswered default is.
    return { defaultProvider: body.default_provider ?? null, archives };
  },
};
