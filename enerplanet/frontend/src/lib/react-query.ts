import { QueryClient } from "@tanstack/react-query";

export const query = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5 * 60 * 1000,
			retry: 1,
		},
	},
});
