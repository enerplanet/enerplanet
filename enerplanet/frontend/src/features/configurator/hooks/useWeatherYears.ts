import { useQuery } from "@tanstack/react-query";

import axios from "@/lib/axios";

interface WeatherYearsResponse {
  data: {
    default_provider: string;
    providers: Record<string, number[]>;
  };
}

/**
 * The years with weather data for the weather archive simulations use, ascending.
 * Empty until the backend answers; a failed request is retried every 30 s.
 */
export function useWeatherYears(): number[] {
  const { data } = useQuery({
    queryKey: ["weather", "years"],
    queryFn: async () => (await axios.get<WeatherYearsResponse>("/weather/years")).data.data,
    staleTime: 60 * 60 * 1000,
    retry: 3,
    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : false),
  });
  if (!data) return [];
  return [...(data.providers[data.default_provider] ?? [])].sort((a, b) => a - b);
}
