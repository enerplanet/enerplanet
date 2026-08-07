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

export function resetAxiosSessionState() {
	isSessionExpired = false;
	isRefreshing = false;
	failedQueue = [];
}

const AUTH_REFRESH_ENDPOINT = '/auth/refresh-token';

const processQueue = (error: Error | null) => {
	for (const promise of failedQueue) {
		if (error) {
			promise.reject(error);
		} else {
			promise.resolve();
		}
	}
	failedQueue = [];
};

const clearCookiesAndRedirect = (redirect: boolean) => {
	useAuthStore.setState({ isSessionExpired: true });
	resetAuthState();
	clearAllCookies();
	if (redirect && typeof globalThis !== "undefined" && globalThis.location) {
		globalThis.location.replace("/login");
	}
};

// Authentication is carried entirely by the session_id cookie (both password
// and SSO logins produce one), so requests only need CSRF on writes.
axios.interceptors.request.use(
	(requestConfig) => {
		const method = requestConfig.method?.toLowerCase();

		if (method && ['post', 'put', 'patch', 'delete'].includes(method)) {
			const csrfToken = getCSRFToken();
			if (csrfToken) {
				requestConfig.headers['X-CSRF-Token'] = csrfToken;
			}
		}

		return requestConfig;
	},
	(error) => {
		throw error instanceof Error ? error : new Error(String(error));
	}
);

axios.interceptors.response.use(
	(response) => {
		return response;
	},
	async (error: AxiosError) => {
		const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean, _csrfRetry?: boolean });
		const status = error.response?.status;
		const errorData = error.response?.data as { code?: string } | undefined;

		if (shouldRetryWithCSRF(status, errorData, originalRequest)) {
			return retryWithNewCSRFToken(originalRequest, error);
		}

		if (isSessionExpiredError(status, errorData)) {
			handleSessionExpired();
			throw error;
		}

		if (isAuthEndpoint(originalRequest.url)) {
			return handleAuthEndpointError(originalRequest, error);
		}

		if (shouldAttemptTokenRefresh(status, originalRequest)) {
			return handleTokenRefresh(originalRequest);
		}

		const user = useAuthStore.getState().user;
		if (status === 401 && !isSessionExpired && !!user) {
			handleSessionExpired();
		}

		throw error;
	}
);

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
	return status === 401 && !!useAuthStore.getState().user && !request._retry;
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
		.catch((error) => {
			throw error;
		});
}

export default axios;
