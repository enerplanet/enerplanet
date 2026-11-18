import { useQuery } from "@tanstack/react-query";
import { modelService } from "@/features/model-dashboard/services/modelService";

/** The set of ids the experimental builder has a session for. */
const experimentalSessionKeys = {
	ids: ["models", "experimental-session-ids"] as const,
};

/**
 * Model ids the experimental builder has a session for, fetched once. The set
 * only changes when someone saves in the builder, so a minute of staleness is
 * plenty and there is no polling.
 */
export const useExperimentalSessionModelIdsQuery = () => {
	return useQuery({
		queryKey: experimentalSessionKeys.ids,
		queryFn: () => modelService.getExperimentalSessionModelIds(),
		staleTime: 60 * 1000,
		refetchOnWindowFocus: false,
	});
};
