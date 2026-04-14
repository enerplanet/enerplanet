import Axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

import { config } from "@/configuration/app";
import { resetAuthState, clearAllCookies } from "@/utils/auth-utils";
import { getCSRFToken } from "@/utils/csrf";
import { useAuthStore } from "@/store/auth-store";

const axios = Axios.create({
	baseURL: config.api.baseUrl,
	headers: {
		"Content-Type": "application/json",
		"Accept": "application/json",
	},
	withCredentials: true,
	timeout: 0, // no timeout; large models (750+ buildings) need unlimited time
});

let isRefreshing = false;
let isSessionExpired = false;
let failedQueue: Array<{
	resolve: (value?: unknown) => void;
	reject: (reason?: unknown) => void;
}> = [];

/** Reset module-level session state. Call on successful login. */
export function resetAxiosSessionState() {
	isSessionExpired = false;
	isRefreshing = false;
	failedQueue = [];
}

const AUTH_REFRESH_ENDPOINT = '/auth/refresh-token';

const processQueue = (error: Error | null) => {
	for (const prom of failedQueue) {
		if (error) {
			prom.reject(error);
		} else {
			prom.resolve();
		}
	}
	failedQueue = [];
};

const clearCookiesAndRedirect = (redirect: boolean) => {
	// Set session-expired flag so beforeunload handlers can skip the browser prompt
	useAuthStore.setState({ isSessionExpired: true });
	resetAuthState();
	clearAllCookies();
	if (redirect && typeof globalThis !== "undefined" && globalThis.location) {
		globalThis.location.replace("/login");
	}
};

axios.interceptors.request.use(
	(config) => {
		const method = config.method?.toLowerCase();
		
		if (method && ['post', 'put', 'patch', 'delete'].includes(method)) {
			const csrfToken = getCSRFToken();
			if (csrfToken) {
				config.headers['X-CSRF-Token'] = csrfToken;
			}
		}
		
		return config;
	},
	(error) => {
		throw error instanceof Error ? error : new Error(String(error));
	}
);

axios.interceptors.response.use(
	(response) => {
		// CSRF token rotation
		return response;
	},
	async (error: AxiosError) => {
		const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean, _csrfRetry?: boolean });
		const status = error.response?.status;
		const errorData = error.response?.data as { code?: string } | undefined;

		// Handle CSRF token errors
		if (shouldRetryWithCSRF(status, errorData, originalRequest)) {
			return retryWithNewCSRFToken(originalRequest, error);
		}

		// Handle session expired
		if (isSessionExpiredError(status, errorData)) {
			handleSessionExpired();
			throw error;
		}

		// Handle auth endpoints differently
		if (isAuthEndpoint(originalRequest.url)) {
			return handleAuthEndpointError(originalRequest, error);
		}

		// Handle 401 with token refresh
		if (shouldAttemptTokenRefresh(status, originalRequest)) {
			return handleTokenRefresh(originalRequest);
		}

		// Final 401 handling - only redirect if user was logged in
		const user = useAuthStore.getState().user;
		if (status === 401 && !isSessionExpired && user) {
			handleSessionExpired();
		}

		throw error;
	}
);

// Helper functions for response interceptor

function shouldRetryWithCSRF(
	status: number | undefined,
	errorData: { code?: string } | undefined,
	request: InternalAxiosRequestConfig & { _csrfRetry?: boolean }
): boolean {
	return status === 403 &&
		(errorData?.code === 'CSRF_TOKEN_MISSING' || errorData?.code === 'CSRF_TOKEN_INVALID') &&
		!request._csrfRetry;
}

async function retryWithNewCSRFToken(
	originalRequest: InternalAxiosRequestConfig & { _csrfRetry?: boolean },
	originalError: AxiosError
) {
	originalRequest._csrfRetry = true;
	try {
		const response = await axios.get('/csrf-token');
		if (response.data?.csrf_token) {
			const csrfToken = getCSRFToken();
			if (csrfToken && originalRequest.headers) {
				originalRequest.headers['X-CSRF-Token'] = csrfToken;
			}
			return axios(originalRequest);
		}
	} catch (csrfError) {
		if (import.meta.env.DEV) console.error('Failed to refresh CSRF token:', csrfError);
	}
	throw originalError;
}

function isSessionExpiredError(
	status: number | undefined,
	errorData: { code?: string } | undefined
): boolean {
	return status === 401 && errorData?.code === 'SESSION_EXPIRED';
}

function handleSessionExpired() {
	if (!isSessionExpired) {
		isSessionExpired = true;
		clearCookiesAndRedirect(true);
	}
}

function isAuthEndpoint(url: string | undefined): boolean {
	return url?.includes('/login') ||
		url?.includes('/register') ||
		url?.includes(AUTH_REFRESH_ENDPOINT) ||
		false;
}

function handleAuthEndpointError(
	originalRequest: InternalAxiosRequestConfig,
	originalError: AxiosError
) {
	if (originalRequest.url?.includes(AUTH_REFRESH_ENDPOINT) && !isSessionExpired) {
		isSessionExpired = true;
		clearCookiesAndRedirect(true);
	}
	throw originalError;
}

function shouldAttemptTokenRefresh(
	status: number | undefined,
	request: InternalAxiosRequestConfig & { _retry?: boolean }
): boolean {
	// Don't attempt refresh if user is not logged in (already logged out)
	const user = useAuthStore.getState().user;
	if (!user) {
		return false;
	}
	return status === 401 && !request._retry;
}

async function handleTokenRefresh(
	originalRequest: InternalAxiosRequestConfig & { _retry?: boolean }
) {
	if (isRefreshing) {
		return queueRequest(originalRequest);
	}

	originalRequest._retry = true;
	isRefreshing = true;

	try {
		await axios.post(AUTH_REFRESH_ENDPOINT);
		processQueue(null);
		return axios(originalRequest);
	} catch (refreshError) {
		processQueue(new Error("Token refresh failed"));
		handleSessionExpired();
		throw refreshError;
	} finally {
		isRefreshing = false;
	}
}

function queueRequest(originalRequest: InternalAxiosRequestConfig) {
	return new Promise((resolve, reject) => {
		failedQueue.push({ resolve, reject });
	})
		.then(() => axios(originalRequest))
		.catch((err) => {
			throw err;
		});
}

export default axios;