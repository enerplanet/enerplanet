/**
 * Application-wide constants consolidated for better maintainability
 */

import { runtimeConfig } from "@/configuration/runtime";

// API Configuration
export const API_CONFIG = {
	BASE_URL: runtimeConfig.api.baseUrl,
	TIMEOUT: 10000,
	RETRY_ATTEMPTS: 3,
} as const;

