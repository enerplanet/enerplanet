import axios from '@/lib/axios';
import { AxiosResponse, isAxiosError } from 'axios';

/**
 * Base API service class that provides common HTTP methods and error handling
 * All service classes should extend this to maintain consistency
 */
export abstract class BaseApiService {
	protected baseUrl: string;

	constructor(baseUrl: string = '') {
		this.baseUrl = baseUrl;
	}

	/**
	 * Generic GET request
	*/
	protected async get<T, TParams extends Record<string, unknown> = Record<string, unknown>>(
		endpoint: string,
		params?: TParams
	): Promise<T> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const response: AxiosResponse<T> = await axios.get(url, { params });
			return response.data;
		} catch (error) {
			this.handleError('GET', endpoint, error);
			throw error;
		}
	}

	/**
	 * Generic POST request
	 */
	protected async post<T, TBody = unknown>(endpoint: string, data?: TBody): Promise<T> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const response: AxiosResponse<T> = await axios.post(url, data);
			return response.data;
		} catch (error) {
			this.handleError('POST', endpoint, error);
			throw error;
		}
	}

	/**
	 * Generic PUT request
	 */
	protected async put<T, TBody = unknown>(endpoint: string, data?: TBody): Promise<T> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const response: AxiosResponse<T> = await axios.put(url, data);
			return response.data;
		} catch (error) {
			this.handleError('PUT', endpoint, error);
			throw error;
		}
	}

	/**
	 * Generic PATCH request
	 */
	protected async patch<T, TBody = unknown>(endpoint: string, data?: TBody): Promise<T> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const response: AxiosResponse<T> = await axios.patch(url, data);
			return response.data;
		} catch (error) {
			this.handleError('PATCH', endpoint, error);
			throw error;
		}
	}

	/**
	 * Generic DELETE request
	 */
	protected async delete<T>(endpoint: string): Promise<T> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const response: AxiosResponse<T> = await axios.delete(url);
			return response.data;
		} catch (error) {
			this.handleError('DELETE', endpoint, error);
			throw error;
		}
	}

	/**
	 * Centralized error handling
	 */
	private handleError(method: string, endpoint: string, error: unknown): void {
		const prefix = `${method} ${this.baseUrl}${endpoint} failed:`;
		if (isAxiosError(error)) {
			if (import.meta.env.DEV) console.error(prefix, error.response?.data ?? error.message);
			return;
		}
		if (typeof error === 'object' && error !== null) {
			const maybe = error as { message?: string };
			if (import.meta.env.DEV) console.error(prefix, maybe.message ?? error);
			return;
		}
		if (import.meta.env.DEV) console.error(prefix, error);
	}

	/**
	 * Convert a parameter value to string format
	 */
	private convertValueToString(value: unknown): string {
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		if (Array.isArray(value)) return value.join(',');
		return JSON.stringify(value);
	}

	/**
	 * Build query string from parameters
	 */
	protected buildQueryString<TParams extends Record<string, unknown>>(params: TParams): string {
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				searchParams.append(key, this.convertValueToString(value));
			}
		}
		return searchParams.toString();
	}
}