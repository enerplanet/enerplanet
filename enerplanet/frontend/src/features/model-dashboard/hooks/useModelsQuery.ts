import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { modelService, Model, ModelListResponse, UpdateModelRequest, ModelResponse } from "@/features/model-dashboard/services/modelService";
import { isActiveStatus } from "@/features/model-dashboard/utils/statusHelpers";

const modelKeys = {
	all: ["models"] as const,
	lists: () => [...modelKeys.all, "list"] as const,
	list: (params?: { limit?: number; offset?: number; search?: string; workspace_id?: number; sort_by?: string; sort_order?: string }) =>
		[...modelKeys.lists(), params] as const,
	stats: () => [...modelKeys.all, "stats"] as const,
	detail: (id: number) => [...modelKeys.all, "detail", id] as const,
};

export const useModelsQuery = (params?: {
	limit?: number;
	offset?: number;
	search?: string;
	workspace_id?: number;
	sort_by?: string;
	sort_order?: string;
}, options?: { requireWorkspace?: boolean }) => {
	const requireWorkspace = options?.requireWorkspace ?? true;
	return useQuery({
		queryKey: modelKeys.list(params),
		queryFn: () => modelService.getModels(params),
		enabled: requireWorkspace ? params?.workspace_id !== undefined : params !== undefined,
		refetchOnWindowFocus: true,
		refetchIntervalInBackground: false,
		refetchInterval: (query) => {
			const res = query.state.data;
			if (!res) return 5000;

			const models = Array.isArray(res.data) ? res.data : [];
			const hasActive = models.some((m) => isActiveStatus(m.status));

			return hasActive ? 3000 : 30000;
		},
		staleTime: (query) => {
			const res = query.state.data as ModelListResponse | undefined;
			if (!res) return 0;

			const models = Array.isArray(res.data) ? res.data : [];
			const hasActive = models.some((m) => isActiveStatus(m.status));

			return hasActive ? 0 : 15000;
		},
	});
};

export const useMissingParentsQuery = (parentIds: number[]) => {
	return useQuery({
		queryKey: [...modelKeys.all, "missing-parents", parentIds],
		queryFn: async () => {
			const results = await Promise.all(
				parentIds.map(id => modelService.getModelById(id))
			);
			return results.filter(r => r.success).map(r => r.data);
		},
		enabled: parentIds.length > 0,
		staleTime: 60 * 1000,
	});
};

export const useModelStatsQuery = () => {
	return useQuery({
		queryKey: modelKeys.stats(),
		queryFn: () => modelService.getModelStats(),
		staleTime: 10 * 1000,
		refetchOnWindowFocus: true,
		refetchIntervalInBackground: false,
		refetchInterval: (q) => {
			const statsResponse = q.state.data as { success: boolean; data: { queue?: number; running?: number } } | undefined;
			if (!statsResponse) return 5000;
			const active = (statsResponse?.data?.queue ?? 0) + (statsResponse?.data?.running ?? 0);
			return active > 0 ? 5000 : false;
		},
	});
};

export const useDuplicateModelMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => {
			// Pass cached models to avoid a redundant API call
			const cachedQueries = queryClient.getQueriesData<ModelListResponse>({ queryKey: modelKeys.lists() });
			const cachedModels = cachedQueries.flatMap(([, data]) => (data && Array.isArray(data.data) ? data.data : []));
			return modelService.duplicateModel(id, cachedModels.length > 0 ? cachedModels : undefined);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
	});
};

export const useDeleteModelMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => modelService.deleteModel(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
	});
};

export const useUpdateModelMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ id, data }: { id: number; data: UpdateModelRequest }) =>
			modelService.updateModel(id, data),
		onSuccess: (response: ModelResponse, variables) => {
			queryClient.setQueryData(
				modelKeys.detail(variables.id),
				response
			);
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
		},
	});
};

export const useStartCalculationMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => modelService.startCalculation(id),
		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: modelKeys.lists() });
			const previousModels = queryClient.getQueriesData({ queryKey: modelKeys.lists() });

			queryClient.setQueriesData(
				{ queryKey: modelKeys.lists() },
				(old: ModelListResponse | undefined) => {
					if (!old || !Array.isArray(old.data)) return old;
					return {
						...old,
						data: old.data.map((model: Model) =>
							model.id === id ? { ...model, status: "queue" as const } : model
						),
					} as ModelListResponse;
				}
			);

			return { previousModels };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
		onError: (_error, _id, context) => {
			if (context?.previousModels) {
				for (const [queryKey, data] of context.previousModels) {
					queryClient.setQueryData(queryKey, data);
				}
			}
		},
	});
};

export const useBulkDeleteModelsMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (ids: number[]) => {
			await Promise.all(ids.map((id) => modelService.deleteModel(id)));
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
	});
};

export const useCreateModelMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (modelData: {
			title: string;
			from_date: string;
			to_date: string;
			resolution: number;
			workspace_id?: number;
			coordinates?: Record<string, unknown>;
			region: string;
			country: string;
		}) => {
			return modelService.createModel(modelData);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
	});
};

export const useUpdateModelMutation2 = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (params: {
			id: number;
			data: UpdateModelRequest;
		}) => {
			return modelService.updateModel(params.id, params.data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: modelKeys.lists() });
			queryClient.invalidateQueries({ queryKey: modelKeys.stats() });
		},
	});
};
