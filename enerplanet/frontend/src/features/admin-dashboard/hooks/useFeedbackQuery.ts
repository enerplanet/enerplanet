import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/lib/axios';

// Types
export interface FeedbackItem {
	id: number;
	user_id: string;
	category: string;
	subject: string;
	message: string;
	rating: number;
	status: "pending" | "in_progress" | "resolved" | "closed";
	priority: "low" | "medium" | "high" | "critical";
	admin_response: string | null;
	responded_at: string | null;
	responded_by: string | null;
	image_path?: string | null;
	image_mime_type?: string | null;
	image_size?: number | null;
	images?: string | null;
	created_at: string;
	updated_at: string;
	user?: {
		id: string;
		name: string;
		email: string;
	};
	user_name?: string;
	user_email?: string;
	responded_by_user?: {
		id: string;
		name: string;
	};
}

interface FeedbackFilters {
	page?: number;
	per_page?: number;
	status?: string;
	category?: string;
	priority?: string;
}

interface UpdateFeedbackData {
	status?: "pending" | "in_progress" | "resolved" | "closed";
	priority?: "low" | "medium" | "high" | "critical";
	admin_response?: string;
}

interface FeedbackListResponse {
	success: boolean;
	data: {
		data: FeedbackItem[];
		total: number;
		page: number;
		per_page: number;
	};
}

interface FeedbackResponse {
	success: boolean;
	data: FeedbackItem;
	message?: string;
}

// Query Keys
const feedbackKeys = {
	all: ['feedback'] as const,
	lists: () => [...feedbackKeys.all, 'list'] as const,
	list: (filters: FeedbackFilters) => [...feedbackKeys.lists(), filters] as const,
	details: () => [...feedbackKeys.all, 'detail'] as const,
	detail: (id: number) => [...feedbackKeys.details(), id] as const,
	user: () => [...feedbackKeys.all, 'user'] as const,
};

// Hooks

/**
 * Fetch all feedback with filters (Admin)
 */
export const useFeedbackList = (filters: FeedbackFilters = {}) => {
	return useQuery({
		queryKey: feedbackKeys.list(filters),
		queryFn: async () => {
			const queryParams = new URLSearchParams();
			
			if (filters.page !== undefined) queryParams.append('page', String(filters.page + 1));
			if (filters.per_page) queryParams.append('per_page', String(filters.per_page));
			if (filters.status && filters.status !== 'all') queryParams.append('status', filters.status);
			if (filters.category && filters.category !== 'all') queryParams.append('category', filters.category);
			if (filters.priority && filters.priority !== 'all') queryParams.append('priority', filters.priority);

			const { data } = await axios.get<FeedbackListResponse>(`/feedback?${queryParams.toString()}`);
			return data.data;
		},
		staleTime: 30000, // 30 seconds
	});
};

/**
 * Update feedback (Admin)
 */
export const useUpdateFeedback = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, updates }: { id: number; updates: UpdateFeedbackData }) => {
			const { data } = await axios.put<FeedbackResponse>(`/feedback/${id}`, updates);
			return data.data;
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: feedbackKeys.detail(variables.id) });
			queryClient.invalidateQueries({ queryKey: feedbackKeys.lists() });
		},
	});
};

/**
 * Delete feedback (Admin)
 */
export const useDeleteFeedback = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: number) => {
			const { data } = await axios.delete<{ success: boolean; message: string }>(`/feedback/${id}`);
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: feedbackKeys.lists() });
		},
	});
};
