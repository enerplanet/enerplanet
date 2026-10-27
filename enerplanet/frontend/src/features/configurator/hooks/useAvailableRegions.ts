import { useQuery } from "@tanstack/react-query";

import { pylovoService } from "@/features/configurator/services/pylovoService";

/**
 * The regions PyLovo holds grids for, shared by every screen that lists them.
 *
 * A failed request is retried, and while it keeps failing it is asked again
 * every 30 s, so one failure at page load does not leave the list empty until
 * the page is reloaded. data stays undefined until a successful answer.
 */
export function useAvailableRegions(enabled = true) {
  return useQuery({
    queryKey: ["pylovo", "available-regions"],
    queryFn: async () => {
      const response = await pylovoService.getAvailableRegions();
      if (response.status !== "success") throw new Error(`region list answered status '${response.status}'`);
      return response;
    },
    enabled,
    retry: 3,
    refetchInterval: (query) => (query.state.status === "error" ? 30_000 : false),
  });
}
