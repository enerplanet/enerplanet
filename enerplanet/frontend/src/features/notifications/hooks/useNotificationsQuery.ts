import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import axios from "@/lib/axios";
import { subscribeNotifications } from "@/features/notifications/notificationStream";

export interface Notification {
	id: number | string;
	notification_id?: number;
	title: string;
	message: string;
	type: "warning" | "error" | "success" | "info" | "maintenance";
	read: boolean;
	created_at: string;
	service?: string;
	scheduled_at?: string;
}

interface NotificationsResponse {
	success: boolean;
	notifications: Notification[];
}

interface ActionResponse {
	success: boolean;
	message?: string;
}

// React Query keys
const notificationKeys = {
	all: ["notifications"] as const,
	lists: () => [...notificationKeys.all, "list"] as const,
	list: (params?: { last30Days?: boolean }) =>
		[...notificationKeys.lists(), params] as const,
};

let unsubscribe: (() => void) | null = null;

// Stop this tab's notification updates (call on logout)
export function closeNotificationStream() {
	unsubscribe?.();
	unsubscribe = null;
}

export const useNotificationsQuery = (params?: { last30Days?: boolean }) => {
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: notificationKeys.list(params),
		queryFn: async () => {
			const queryParams = params?.last30Days ? "?last30Days=true" : "";
			const { data } = await axios.get<NotificationsResponse>(
				`/notifications${queryParams}`
			);
			return data;
		},
		staleTime: Infinity,
		refetchInterval: false,
		refetchOnWindowFocus: false,
	});

	// One subscription per tab, kept across hook mounts until logout.
	useEffect(() => {
		if (!unsubscribe) {
			unsubscribe = subscribeNotifications((ev) => handleIncomingNotification(ev, queryClient));
		}
	}, [queryClient]);

	return query;
};

// Handle incoming notification from SSE
function handleIncomingNotification(ev: MessageEvent, queryClient: QueryClient) {
	try {
		const incoming = JSON.parse(ev.data) as Notification;
		updateNotificationsList(incoming, queryClient);
		// If notification is about model completion/failure, refresh the models list
		if (incoming.type === "success" || incoming.type === "error") {
			queryClient.invalidateQueries({ queryKey: ["models"] });
		}
	} catch {
		// Ignore parse errors
	}
}

// Update notifications list with new notification
function updateNotificationsList(incoming: Notification, queryClient: QueryClient) {
	queryClient.setQueriesData<NotificationsResponse>(
		{ queryKey: notificationKeys.lists() },
		(old: NotificationsResponse | undefined) => {
			if (!old) return old;
			
			const exists = old.notifications?.some(
				(n) => n.id === incoming.id
			);
			if (exists) return old;
			
			const next = [incoming, ...(old.notifications || [])];
			return { ...old, notifications: next.slice(0, 50) };
		}
	);
}

// Mark single notification as read
export const useMarkNotificationReadMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: number | string) => {
			const { data } = await axios.patch<ActionResponse>(
				`/notifications/${id}/read`
			);
			return data;
		},
		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: notificationKeys.lists() });

			const previousData = queryClient.getQueriesData({
				queryKey: notificationKeys.lists(),
			});

			queryClient.setQueriesData<NotificationsResponse>(
				{ queryKey: notificationKeys.lists() },
				(old) => {
					if (!old?.notifications) return old;
					return {
						...old,
						notifications: old.notifications.map((n) =>
							n.id === id ? { ...n, read: true } : n
						),
					};
				}
			);

			return { previousData };
		},
		onError: (_error, _id, context) => {
			if (context?.previousData) {
				for (const [queryKey, data] of context.previousData) {
					queryClient.setQueryData(queryKey, data);
				}
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
		},
	});
};

// Mark all notifications as read
export const useMarkAllNotificationsReadMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const { data } = await axios.post<ActionResponse>(
				"/notifications/read-all"
			);
			return data;
		},
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: notificationKeys.lists() });

			const previousData = queryClient.getQueriesData({
				queryKey: notificationKeys.lists(),
			});

			queryClient.setQueriesData<NotificationsResponse>(
				{ queryKey: notificationKeys.lists() },
				(old) => {
					if (!old?.notifications) return old;
					return {
						...old,
						notifications: old.notifications.map((n) => ({ ...n, read: true })),
					};
				}
			);

			return { previousData };
		},
		onError: (_error, _variables, context) => {
			if (context?.previousData) {
				for (const [queryKey, data] of context.previousData) {
					queryClient.setQueryData(queryKey, data);
				}
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
		},
	});
};

// Clear all notifications
export const useClearAllNotificationsMutation = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const { data } = await axios.delete<ActionResponse>(
				"/notifications/clear-all"
			);
			return data;
		},
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: notificationKeys.lists() });

			const previousData = queryClient.getQueriesData({
				queryKey: notificationKeys.lists(),
			});

			queryClient.setQueriesData<NotificationsResponse>(
				{ queryKey: notificationKeys.lists() },
				(old) => {
					if (!old) return old;
					return {
						...old,
						notifications: [],
					};
				}
			);

			return { previousData };
		},
		onError: (_error, _variables, context) => {
			if (context?.previousData) {
				for (const [queryKey, data] of context.previousData) {
					queryClient.setQueryData(queryKey, data);
				}
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
		},
	});
};
