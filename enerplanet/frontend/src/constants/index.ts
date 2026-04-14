/**
 * Application-wide constants consolidated for better maintainability
 */

// API Configuration
export const API_CONFIG = {
	BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',
	TIMEOUT: 10000,
	RETRY_ATTEMPTS: 3,
} as const;

