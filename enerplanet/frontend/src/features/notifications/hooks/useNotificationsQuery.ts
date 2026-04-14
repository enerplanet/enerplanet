import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import axios from "@/lib/axios";
import { config } from "@/configuration/app";
import { useAuthStore } from "@/store/auth-store";

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

let eventSource: EventSource | null = null;

// Close the event source connection (call on logout)
export function closeNotificationStream() {
	if (eventSource) {
		try {
			eventSource.close();
		} catch {
			// Ignore close errors
		}
		eventSource = null;
	}
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

	// SSE subscription (singleton per tab)
	const mountedRef = useRef(false);
	useEffect(() => {
		if (mountedRef.current) return;
		mountedRef.current = true;

		if (!eventSource) {
			initializeEventSource(queryClient);
		}

		return () => {
			// Do not close eventSource to keep singleton across hook mounts
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return query;
};

// Helper function to build SSE stream URL
function buildStreamUrl(): string {
	const base = config.api.baseUrl || '/api';
	const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
	return `${normalizedBase}/notifications/stream`;
}

// Helper function to initialize SSE connection
function initializeEventSource(queryClient: QueryClient) {
	if (eventSource) {
		return;
	}
	
	// Don't connect if user is not authenticated
	const user = useAuthStore.getState().user;
	if (!user) {
		return;
	}
	
	try {
		const streamUrl = buildStreamUrl();
		const options: EventSourceInit = { withCredentials: true };
		eventSource = new EventSource(streamUrl, options);

		eventSource.onopen = () => {
		};

		eventSource.addEventListener("notification", (ev: MessageEvent) => {
			handleIncomingNotification(ev, queryClient);
		});

		eventSource.onerror = () => {
			handleEventSourceError(queryClient);
		};
	} catch {
		// Ignore connection errors
	}
}

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

// Handle SSE error with reconnection
function handleEventSourceError(queryClient: QueryClient) {
	try {
		eventSource?.close();
	} catch {
		// Ignore close errors
	}
	eventSource = null;
	
	// Only attempt to reconnect if user is still authenticated
	const user = useAuthStore.getState().user;
	if (!user) {
		return;
	}
	
	// Attempt to reconnect after 5 seconds
	setTimeout(() => {
		// Double-check user is still authenticated before reconnecting
		const currentUser = useAuthStore.getState().user;
		if (currentUser) {
			initializeEventSource(queryClient);
		}
	}, 5000);
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
