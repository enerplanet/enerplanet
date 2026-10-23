import { useQuery } from "@tanstack/react-query";

import axios from "@/lib/axios";

interface WeatherYearsResponse {
  data: {
    default_provider: string;
    providers: Record<string, number[]>;
  };
}

// Offered while the weather service cannot list its years, so a period can still
// be set; a run in a year without weather data then fails at the weather step.
const FALLBACK_YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i);

/** Weather archives with their years, as GET /weather/years lists them. */
export interface WeatherArchives {
  /** The archive runs use when a model chooses none; null until known. */
  defaultProvider: string | null;
  /** Archives that have at least one year, each with its years ascending. */
  archives: Record<string, number[]>;
}

/**
 * The weather archives and their years. Empty until the backend answers; a failed
 * request is retried every 30 s.
 */
export function useWeatherArchives(): WeatherArchives & { failed: boolean } {
  const { data, isError } = useQuery({
    queryKey: ["weather", "years"],
    queryFn: async () => (await axios.get<WeatherYearsResponse>("/weather/years")).data.data,
    staleTime: 60 * 60 * 1000,
    retry: 3,
    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : false),
  });
  const archives: Record<string, number[]> = {};
  for (const [name, years] of Object.entries(data?.providers ?? {})) {
    if (years.length > 0) archives[name] = [...years].sort((a, b) => a - b);
  }
  return { defaultProvider: data?.default_provider ?? null, archives, failed: isError };
}

/**
 * The years with weather data in provider, or in the default archive when provider
 * is null, ascending. Falls back to FALLBACK_YEARS while the list cannot be loaded.
 */
export function useWeatherYears(provider: string | null): number[] {
  const { defaultProvider, archives, failed } = useWeatherArchives();
  if (failed) {
    console.warn("[configurator] weather years unavailable; offering", FALLBACK_YEARS[0], "to", FALLBACK_YEARS.at(-1));
    return FALLBACK_YEARS;
  }
  const name = provider ?? defaultProvider;
  return name ? archives[name] ?? [] : [];
}
