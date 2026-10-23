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

/**
 * The years with weather data for the weather archive simulations use, ascending.
 * Empty until the backend answers; a failed request is retried every 30 s and
 * falls back to FALLBACK_YEARS.
 */
export function useWeatherYears(): number[] {
  const { data, isError } = useQuery({
    queryKey: ["weather", "years"],
    queryFn: async () => (await axios.get<WeatherYearsResponse>("/weather/years")).data.data,
    staleTime: 60 * 60 * 1000,
    retry: 3,
    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : false),
  });
  if (isError) {
    console.warn("[configurator] weather years unavailable; offering", FALLBACK_YEARS[0], "to", FALLBACK_YEARS.at(-1));
    return FALLBACK_YEARS;
  }
  if (!data) return [];
  return [...(data.providers[data.default_provider] ?? [])].sort((a, b) => a - b);
}
